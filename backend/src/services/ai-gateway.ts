import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { getConfig } from '../config/env.js';
import { HttpError } from '../common/http.js';
import { AI_CAPABILITIES, decryptSecret, encryptSecret, validateAiResponse, type AiCapability } from './ai-provider.js';
import { AI_PROVIDER_DEFINITIONS, AI_PROVIDER_IDS, providerCompletionUrl, validateProviderBaseUrl, type AiProviderId } from './ai-provider-registry.js';
import { assertAiDomain, buildAgriLinkSystemInstruction } from './ai-domain-policy.js';
import { AiUsage, Setting } from '../database/models.js';
import { runNvidiaTransport, type NvidiaTransportConfig } from './nvidia-transport.js';

const SETTING_SCOPE = 'ai.provider';
const MAX_FALLBACKS = 2;
const DEFAULT_DEADLINE_MS = 60_000;
const PROVIDER_JSON_LIMIT = 256_000;
const deterministicCapabilities = new Set<AiCapability>([
  'shared/market-advisor', 'farmer/price-advisor', 'farmer/net-profit-advisor',
  'farmer/matching-assistant', 'buyer/produce-finder',
]);

type EncryptedSecret = { iv: string; tag: string; data: string };
export type ProviderConfig = {
  id: AiProviderId; enabled: boolean; baseUrl: string; model: string; encryptedApiKey?: EncryptedSecret;
  apiKey: string; priority: number; isPrimary: boolean; fallbackEligible: boolean; timeoutMs: number;
  temperature: number; topP: number; maxTokens: number; capabilities: AiCapability[];
  lastDiagnostic?: Record<string, unknown>; lastInferenceDiagnostic?: Record<string, unknown>;
  lastSuccessfulInference?: Record<string, unknown>; lastConnectivityDiagnostic?: Record<string, unknown>;
  verifiedModels?: Record<string, unknown>[];
  source: 'admin' | 'environment' | 'not-configured'; configurationError?: string;
};
export type CapabilityRoute = {
  preferredProvider: AiProviderId | null; preferredModel: string | null;
  fallbackProviders: AiProviderId[]; explanationsEnabled: boolean;
};
export type GatewayConfig = {
  storedValue: Record<string, any>; providers: Record<AiProviderId, ProviderConfig>;
  capabilityRouting: Record<AiCapability, CapabilityRoute>; maxFallbackAttempts: number;
  requestDeadlineMs: number; primaryProvider: AiProviderId | null;
};

const capabilityList = AI_CAPABILITIES as readonly AiCapability[];
const validProvider = (value: unknown): value is AiProviderId => AI_PROVIDER_IDS.includes(value as AiProviderId);
const validCapability = (value: unknown): value is AiCapability => capabilityList.includes(value as AiCapability);
const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: unknown, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, finite(value, fallback)));
const list = (value: unknown): AiCapability[] => Array.isArray(value) ? [...new Set(value.filter(validCapability))] : [...capabilityList];

function newProvider(id: AiProviderId, raw: any, storedValue: any, env: ReturnType<typeof getConfig>): ProviderConfig {
  // NVIDIA's older configuration lived at the setting root. Merge it first so
  // a sparse nested record (for example, one containing only a diagnostic)
  // cannot hide the encrypted credential and model. Explicit canonical values
  // always win, including intentional empty/disabled values.
  const legacy = id === 'nvidia' ? {
    baseUrl: storedValue.baseUrl, model: storedValue.model, encryptedApiKey: storedValue.encryptedApiKey,
    enabled: storedValue.enabled, timeoutMs: storedValue.timeoutMs, temperature: storedValue.temperature,
    topP: storedValue.topP, maxTokens: storedValue.maxTokens, capabilities: storedValue.capabilities,
    lastDiagnostic: storedValue.lastDiagnostic,
  } : {};
  const record = { ...legacy, ...(raw ?? {}) };
  const legacyConfigPresent = id === 'nvidia' && Boolean(storedValue.baseUrl || storedValue.model || storedValue.encryptedApiKey);
  const adminConfigPresent = Boolean(raw && ['enabled','baseUrl','model','encryptedApiKey','capabilities'].some((key) => Object.hasOwn(raw, key))) || legacyConfigPresent;
  const legacyNvidia = id === 'nvidia' && !raw;
  let encryptedApiKey: EncryptedSecret | undefined = record.encryptedApiKey;
  let apiKey = '';
  let configurationError: string | undefined;
  try {
    if (encryptedApiKey) apiKey = decryptSecret(encryptedApiKey);
  } catch {
    configurationError = 'credential_decryption_failed';
  }
  // Environment compatibility is bootstrap-only. Once an administrator has
  // saved provider configuration, an empty canonical credential/model must
  // not be silently replaced by stale environment values.
  const environmentBootstrap = id === 'nvidia' && !adminConfigPresent;
  if (environmentBootstrap && !apiKey) { apiKey = env.NVIDIA_API_KEY ?? ''; if (apiKey && configurationError === 'credential_decryption_failed') configurationError = undefined; }
  const defaultModel = environmentBootstrap && id === 'nvidia' ? env.NVIDIA_DEFAULT_MODEL ?? '' : '';
  const defaultTimeout = id === 'nvidia' ? env.NVIDIA_REQUEST_TIMEOUT_MS : 30_000;
  const model = String(record.model ?? defaultModel).trim();
  let baseUrl = String(record.baseUrl ?? (environmentBootstrap ? env.NVIDIA_API_BASE_URL : '') ?? AI_PROVIDER_DEFINITIONS[id].defaultBaseUrl).trim();
  if (!baseUrl) baseUrl = AI_PROVIDER_DEFINITIONS[id].defaultBaseUrl;
  // Configuration reads remain possible if a legacy value is invalid; no
  // request is sent until a supported public provider URL is saved.
  try { baseUrl = validateProviderBaseUrl(id, baseUrl); } catch { configurationError ??= 'provider_url_invalid'; }
  const hasPersisted = adminConfigPresent;
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : hasPersisted || Boolean(apiKey && model);
  if (enabled && !apiKey) configurationError ??= 'credential_not_configured';
  if (enabled && !model) configurationError ??= 'model_not_configured';
  const legacyPrimary = id === 'nvidia' && legacyConfigPresent && storedValue.primaryProvider !== 'openai' && storedValue.primaryProvider !== 'deepseek';
  const lastDiagnostic = record.lastDiagnostic && typeof record.lastDiagnostic === 'object' ? record.lastDiagnostic : undefined;
  const lastInferenceDiagnostic = record.lastInferenceDiagnostic && typeof record.lastInferenceDiagnostic === 'object'
    ? record.lastInferenceDiagnostic
    : lastDiagnostic?.stage === 'inference' ? lastDiagnostic : undefined;
  return {
    id, enabled, baseUrl, model, encryptedApiKey, apiKey,
    priority: Math.round(clamp(record.priority, id === 'nvidia' ? 10 : id === 'openai' ? 20 : 30, 1, 1000)),
    isPrimary: record.isPrimary === true || (record.isPrimary !== false && legacyPrimary),
    fallbackEligible: record.fallbackEligible !== false,
    timeoutMs: Math.round(clamp(record.timeoutMs, legacyNvidia ? defaultTimeout : 30_000, 1_000, 120_000)),
    temperature: clamp(record.temperature, legacyNvidia ? env.NVIDIA_TEMPERATURE : 0.2, 0, 2),
    topP: clamp(record.topP, legacyNvidia ? env.NVIDIA_TOP_P : 0.9, 0, 1),
    maxTokens: Math.round(clamp(record.maxTokens, legacyNvidia ? env.NVIDIA_MAX_TOKENS : 1200, 1, 8192)),
    capabilities: list(record.capabilities), lastDiagnostic, lastInferenceDiagnostic,
    lastSuccessfulInference: record.lastSuccessfulInference && typeof record.lastSuccessfulInference === 'object'
      ? record.lastSuccessfulInference : lastInferenceDiagnostic?.inferenceSucceeded === true ? lastInferenceDiagnostic : undefined,
    verifiedModels: Array.isArray(record.verifiedModels) ? record.verifiedModels.filter((item: unknown) => item && typeof item === 'object')
      : lastInferenceDiagnostic?.inferenceSucceeded === true ? [lastInferenceDiagnostic] : [],
    lastConnectivityDiagnostic: record.lastConnectivityDiagnostic && typeof record.lastConnectivityDiagnostic === 'object'
      ? record.lastConnectivityDiagnostic : lastDiagnostic?.stage === 'connectivity' ? lastDiagnostic : undefined,
    configurationError,
    source: adminConfigPresent ? 'admin' : apiKey || defaultModel ? 'environment' : 'not-configured',
  };
}

function providerConfigurationFingerprint(provider: ProviderConfig) {
  // The fingerprint is an internal comparison value only. It contains no
  // credential material and is never included in Admin API responses.
  return createHash('sha256').update(JSON.stringify({
    id: provider.id, baseUrl: provider.baseUrl, model: provider.model,
    apiKey: provider.apiKey, capabilities: [...provider.capabilities].sort(),
  })).digest('hex');
}

function modelForCapability(config: GatewayConfig, capability: AiCapability, providerId: AiProviderId) {
  const route = config.capabilityRouting[capability];
  const provider = config.providers[providerId];
  return route.preferredProvider === providerId && route.preferredModel ? route.preferredModel : provider.model;
}

function providerHasVerifiedModel(provider: ProviderConfig, model: string) {
  const fingerprint = providerConfigurationFingerprint(provider);
  const diagnostics = [...(provider.verifiedModels ?? []), provider.lastSuccessfulInference ?? provider.lastInferenceDiagnostic].filter(Boolean);
  return diagnostics.some((diagnostic) => diagnostic?.stage === 'inference' && diagnostic.inferenceSucceeded === true
    && diagnostic.configurationFingerprint === fingerprint && diagnostic.requestedModel === model);
}

function defaultRoute(capability: AiCapability, providers: Record<AiProviderId, ProviderConfig>, primary: AiProviderId | null, storedValue: any): CapabilityRoute {
  const existing = storedValue.capabilityRouting?.[capability];
  if (existing && typeof existing === 'object') return {
    preferredProvider: validProvider(existing.preferredProvider) ? existing.preferredProvider : null,
    preferredModel: typeof existing.preferredModel === 'string' && existing.preferredModel.trim() ? existing.preferredModel.trim() : null,
    fallbackProviders: Array.isArray(existing.fallbackProviders) ? [...new Set<AiProviderId>((existing.fallbackProviders as unknown[]).filter(validProvider))].slice(0, MAX_FALLBACKS) : [],
    explanationsEnabled: existing.explanationsEnabled === true,
  };
  const fallbackProviders = AI_PROVIDER_IDS.filter((id) => {
    const provider = providers[id];
    return id !== primary && provider.enabled && !provider.configurationError && Boolean(provider.apiKey && provider.model)
      && provider.capabilities.includes(capability) && provider.fallbackEligible;
  }).sort((a, b) => providers[a].priority - providers[b].priority).slice(0, MAX_FALLBACKS);
  const legacyModel = storedValue.capabilityModels?.[capability];
  return {
    // An absent route means automatic primary/priority selection. Returning the
    // current primary here would turn every default route into a persisted
    // NVIDIA-only assignment when Control round-trips the configuration.
    preferredProvider: null,
    preferredModel: typeof legacyModel === 'string' && legacyModel.trim() ? legacyModel.trim() : null,
    fallbackProviders,
    explanationsEnabled: !deterministicCapabilities.has(capability),
  };
}

export async function readAiGatewayConfig(): Promise<GatewayConfig> {
  const row: any = await Setting.findOne({ scope: SETTING_SCOPE });
  const storedValue = row?.value && typeof row.value === 'object' ? row.value : {};
  const env = getConfig();
  const providers = Object.fromEntries(AI_PROVIDER_IDS.map((id) => [id, newProvider(id, storedValue.providers?.[id], storedValue, env)])) as Record<AiProviderId, ProviderConfig>;
  const storedPrimary: unknown = storedValue.primaryProvider;
  const chosenPrimary = validProvider(storedPrimary) && providers[storedPrimary].enabled ? storedPrimary : null;
  const primaryProvider = chosenPrimary ?? AI_PROVIDER_IDS.find((id) => providers[id].isPrimary && providers[id].enabled) ?? AI_PROVIDER_IDS.filter((id) => providers[id].enabled).sort((a, b) => providers[a].priority - providers[b].priority)[0] ?? null;
  const capabilityRouting = Object.fromEntries(capabilityList.map((capability) => [capability, defaultRoute(capability, providers, primaryProvider, storedValue)])) as Record<AiCapability, CapabilityRoute>;
  return {
    storedValue, providers, capabilityRouting,
    maxFallbackAttempts: Math.round(clamp(storedValue.maxFallbackAttempts, MAX_FALLBACKS, 0, MAX_FALLBACKS)),
    requestDeadlineMs: Math.round(clamp(storedValue.requestDeadlineMs, DEFAULT_DEADLINE_MS, 1_000, 120_000)),
    primaryProvider,
  };
}

export function providerAdminView(config: GatewayConfig) {
  const diagnosticFields = ['checkedAt','stage','transport','dnsReachable','reachable','tlsVerified','httpStatus','latencyMs','errorCategory','authenticated','modelAvailable','modelsCount','inferenceSucceeded','model','requestedModel'];
  const safeDiagnostic = (diagnostic?: Record<string, unknown>) => diagnostic
    ? Object.fromEntries(diagnosticFields.filter((key) => Object.hasOwn(diagnostic, key)).map((key) => [key, diagnostic[key]]))
    : null;
  return {
    providers: AI_PROVIDER_IDS.map((id) => {
      const provider = config.providers[id];
      const defaultModelVerified = providerHasVerifiedModel(provider, provider.model);
      return {
        id, label: AI_PROVIDER_DEFINITIONS[id].label, enabled: provider.enabled, baseUrl: provider.baseUrl,
        model: provider.model, priority: provider.priority, isPrimary: config.primaryProvider === id,
        fallbackEligible: provider.fallbackEligible, timeoutMs: provider.timeoutMs,
        temperature: provider.temperature, topP: provider.topP, maxTokens: provider.maxTokens,
        capabilities: provider.capabilities, hasCredential: Boolean(provider.apiKey), source: provider.source,
        operational: defaultModelVerified && provider.enabled && Boolean(provider.apiKey) && !provider.configurationError,
        verificationStatus: defaultModelVerified ? 'verified' : provider.enabled && provider.apiKey && provider.model ? 'inference_verification_required' : 'unavailable',
        lastDiagnostic: safeDiagnostic(provider.lastDiagnostic),
        lastConnectivityDiagnostic: safeDiagnostic(provider.lastConnectivityDiagnostic),
        lastInferenceDiagnostic: safeDiagnostic(provider.lastInferenceDiagnostic),
        lastSuccessfulInference: safeDiagnostic(provider.lastSuccessfulInference),
        verifiedModelCount: (provider.verifiedModels ?? []).filter((item) => item.configurationFingerprint === providerConfigurationFingerprint(provider)).length,
        configurationError: provider.configurationError ?? null,
      };
    }),
    capabilityRouting: capabilityList.map((capability) => {
      const route = config.capabilityRouting[capability];
      const ordered = getEligibleProviderOrder(config, capability);
      const configured = AI_PROVIDER_IDS.filter((id) => {
        const provider = config.providers[id];
        const isAllowedByRoute = route.preferredProvider === null
          ? true
          : id === route.preferredProvider || route.fallbackProviders.includes(id);
        return isAllowedByRoute && provider.enabled && !provider.configurationError && Boolean(provider.apiKey)
          && Boolean(modelForCapability(config, capability, id)) && provider.capabilities.includes(capability);
      });
      const execution = deterministicCapabilities.has(capability) ? route.explanationsEnabled ? 'hybrid' : 'deterministic' : 'provider';
      const status = execution === 'deterministic'
        ? 'deterministic'
        : ordered.length ? 'ready' : configured.length ? 'inference_verification_required' : 'unavailable';
      const effectiveProvider = execution === 'deterministic' ? null : ordered[0] ?? null;
      return {
        capability, ...route, execution, status, effectiveProvider,
        effectiveModel: effectiveProvider ? modelForCapability(config, capability, effectiveProvider) : null,
      };
    }),
    primaryProvider: config.primaryProvider, maxFallbackAttempts: config.maxFallbackAttempts,
    requestDeadlineMs: config.requestDeadlineMs,
  };
}

async function setSettingPaths(paths: Record<string, unknown>) {
  await Setting.updateOne({ scope: SETTING_SCOPE }, {
    $set: { scope: SETTING_SCOPE, ...paths, updatedAt: new Date() },
    $setOnInsert: { createdAt: new Date() },
  }, { upsert: true });
}

export function getEligibleProviderOrder(
  config: GatewayConfig, capability: AiCapability, forceProvider?: AiProviderId,
  options: { allowUnverified?: boolean } = {},
) {
  const route = config.capabilityRouting[capability];
  const eligible = AI_PROVIDER_IDS.filter((id) => {
    const provider = config.providers[id];
    const model = modelForCapability(config, capability, id);
    return provider.enabled && !provider.configurationError && Boolean(provider.apiKey) && Boolean(model)
      && provider.capabilities.includes(capability) && (options.allowUnverified === true || providerHasVerifiedModel(provider, model));
  });
  if (forceProvider) return eligible.includes(forceProvider) ? [forceProvider] : [];
  const sorted = [...eligible].sort((a, b) => config.providers[a].priority - config.providers[b].priority);
  const explicitPreference = route.preferredProvider !== null;
  const first = explicitPreference
    ? (eligible.includes(route.preferredProvider!) ? route.preferredProvider
      : route.fallbackProviders.find((id) => eligible.includes(id) && config.providers[id].fallbackEligible))
    : config.primaryProvider
      ? (eligible.includes(config.primaryProvider) ? config.primaryProvider
        : route.fallbackProviders.find((id) => eligible.includes(id) && config.providers[id].fallbackEligible))
      : sorted[0];
  if (!first) return [];
  // Only an administrator-configured fallback list may receive another request.
  return [first, ...route.fallbackProviders.filter((id) => id !== first && eligible.includes(id) && config.providers[id].fallbackEligible).slice(0, MAX_FALLBACKS)];
}

export async function saveProviderConfiguration(id: AiProviderId, input: Record<string, unknown>, actorId?: unknown) {
  if (!validProvider(id)) throw new HttpError(404, 'AI provider not found.', 'AI_PROVIDER_NOT_FOUND');
  const current = await readAiGatewayConfig();
  const schema = (await import('zod')).z;
  const body = schema.object({
    enabled: schema.boolean(), baseUrl: schema.string().min(1).max(300), model: schema.string().trim().max(160),
    apiKey: schema.string().max(500).optional(), priority: schema.coerce.number().int().min(1).max(1000),
    isPrimary: schema.boolean(), fallbackEligible: schema.boolean(), timeoutMs: schema.coerce.number().int().min(1000).max(120000),
    temperature: schema.coerce.number().min(0).max(2), topP: schema.coerce.number().min(0).max(1),
    maxTokens: schema.coerce.number().int().min(1).max(8192), capabilities: schema.array(schema.enum(capabilityList)).max(capabilityList.length),
  }).strict().safeParse(input);
  if (!body.success) throw new HttpError(422, 'Check the provider configuration fields.', 'AI_PROVIDER_CONFIG_INVALID', body.error.issues[0]?.path.join('.'));
  const value = body.data;
  let baseUrl: string;
  try { baseUrl = validateProviderBaseUrl(id, value.baseUrl); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(422, 'Use the provider’s public HTTPS API base URL.', 'AI_PROVIDER_URL_INVALID', 'baseUrl'); }
  if (value.enabled && value.model.length < 2) throw new HttpError(422, 'Enter a model identifier before enabling this provider.', 'AI_MODEL_INVALID', 'model');
  if (value.apiKey && value.apiKey.trim().length < 12) throw new HttpError(422, 'Enter a valid provider credential.', 'AI_KEY_INVALID', 'apiKey');
  const prior = current.providers[id];
  const nextApiKey = value.apiKey?.trim() || prior.apiKey;
  // If an environment-configured NVIDIA instance is saved from Control, move
  // that credential into the canonical encrypted provider record. Subsequent
  // requests then use the saved Admin configuration rather than the env value.
  const encryptedApiKey = value.apiKey?.trim() ? encryptSecret(value.apiKey.trim())
    : prior.encryptedApiKey ?? (nextApiKey ? encryptSecret(nextApiKey) : undefined);
  if (value.enabled && !encryptedApiKey) throw new HttpError(422, 'A provider credential is required to enable this provider.', 'AI_KEY_REQUIRED', 'apiKey');
  if (value.enabled && !value.capabilities.length) throw new HttpError(422, 'Select at least one supported capability before enabling this provider.', 'AI_CAPABILITIES_REQUIRED', 'capabilities');
  const nextModel = value.model.trim();
  const nextCapabilities = [...new Set(value.capabilities)];
  const configurationChanged = prior.baseUrl !== baseUrl || prior.model !== nextModel || prior.apiKey !== nextApiKey
    || JSON.stringify([...prior.capabilities].sort()) !== JSON.stringify([...nextCapabilities].sort());
  const nextProvider = {
    enabled: value.enabled, baseUrl, model: nextModel, encryptedApiKey,
    priority: value.priority, isPrimary: value.isPrimary, fallbackEligible: value.fallbackEligible,
    timeoutMs: value.timeoutMs, temperature: value.temperature, topP: value.topP, maxTokens: value.maxTokens,
    capabilities: nextCapabilities,
    lastDiagnostic: configurationChanged ? null : prior.lastDiagnostic ?? null,
    lastInferenceDiagnostic: configurationChanged ? null : prior.lastInferenceDiagnostic ?? null,
    lastSuccessfulInference: configurationChanged ? null : prior.lastSuccessfulInference ?? null,
    verifiedModels: configurationChanged ? [] : prior.verifiedModels ?? [],
    lastConnectivityDiagnostic: prior.baseUrl === baseUrl ? prior.lastConnectivityDiagnostic ?? null : null,
  };
  const paths: Record<string, unknown> = {
    'value.schemaVersion': 2,
    [`value.providers.${id}`]: nextProvider,
    'value.updatedBy': actorId,
  };
  if (value.isPrimary) {
    paths['value.primaryProvider'] = id;
    for (const otherId of AI_PROVIDER_IDS) if (otherId !== id && current.providers[otherId].isPrimary) paths[`value.providers.${otherId}.isPrimary`] = false;
  } else if (current.primaryProvider === id) {
    const next = AI_PROVIDER_IDS.filter((candidate) => candidate !== id && current.providers[candidate].enabled).sort((a, b) => current.providers[a].priority - current.providers[b].priority)[0] ?? null;
    paths['value.primaryProvider'] = next;
    if (next) paths[`value.providers.${next}.isPrimary`] = true;
  }
  // Dual-write NVIDIA's legacy root fields so old runtime readers continue to
  // work. Existing encrypted settings are reused unless an administrator
  // explicitly replaces the key.
  if (id === 'nvidia') {
    paths['value.baseUrl'] = baseUrl; paths['value.model'] = value.model.trim();
    paths['value.enabled'] = value.enabled; paths['value.timeoutMs'] = value.timeoutMs;
    paths['value.temperature'] = value.temperature; paths['value.topP'] = value.topP; paths['value.maxTokens'] = value.maxTokens;
    if (encryptedApiKey) paths['value.encryptedApiKey'] = encryptedApiKey;
  }
  if (actorId) paths['value.updatedBy'] = String(actorId);
  await setSettingPaths(paths);
  return providerAdminView(await readAiGatewayConfig());
}

export async function removeProviderConfiguration(id: AiProviderId) {
  if (!validProvider(id)) throw new HttpError(404, 'AI provider not found.', 'AI_PROVIDER_NOT_FOUND');
  if (id === 'nvidia') throw new HttpError(409, 'The existing NVIDIA configuration is retained for compatibility. Disable it to stop routing requests.', 'AI_PROVIDER_PRESERVED');
  const current = await readAiGatewayConfig();
  const nextPrimary = current.primaryProvider === id
    ? AI_PROVIDER_IDS.filter((candidate) => candidate !== id && current.providers[candidate].enabled).sort((a, b) => current.providers[a].priority - current.providers[b].priority)[0] ?? null
    : current.primaryProvider;
  const routing = Object.fromEntries(capabilityList.map((capability) => {
    const route = current.capabilityRouting[capability];
    const preferredProvider = route.preferredProvider === id ? nextPrimary : route.preferredProvider;
    return [capability, { ...route, preferredProvider, fallbackProviders: route.fallbackProviders.filter((item) => item !== id) }];
  }));
  await setSettingPaths({ [`value.providers.${id}`]: { enabled: false, baseUrl: AI_PROVIDER_DEFINITIONS[id].defaultBaseUrl, model: '', priority: current.providers[id].priority, isPrimary: false, fallbackEligible: false, timeoutMs: 30_000, temperature: 0.2, topP: 0.9, maxTokens: 1200, capabilities: [], lastDiagnostic: current.providers[id].lastDiagnostic }, 'value.primaryProvider': nextPrimary, 'value.capabilityRouting': routing });
  return providerAdminView(await readAiGatewayConfig());
}

export async function saveCapabilityRouting(input: { capabilityRouting: unknown; maxFallbackAttempts: unknown; requestDeadlineMs: unknown }) {
  const z = (await import('zod')).z;
  const routeSchema = z.object({
    preferredProvider: z.enum(AI_PROVIDER_IDS).nullable(), preferredModel: z.string().trim().max(160).nullable(),
    fallbackProviders: z.array(z.enum(AI_PROVIDER_IDS)).max(MAX_FALLBACKS), explanationsEnabled: z.boolean(),
  }).strict();
  const schema = z.object({
    capabilityRouting: z.record(z.enum(capabilityList), routeSchema),
    maxFallbackAttempts: z.coerce.number().int().min(0).max(MAX_FALLBACKS),
    requestDeadlineMs: z.coerce.number().int().min(1000).max(120000),
  }).strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, 'Check the capability routing fields.', 'AI_ROUTING_INVALID', parsed.error.issues[0]?.path.join('.'));
  const current = await readAiGatewayConfig();
  const routing = Object.fromEntries(capabilityList.map((capability) => {
    const route = parsed.data.capabilityRouting[capability];
    const fallbacks = [...new Set(route.fallbackProviders)].filter((id) => id !== route.preferredProvider).slice(0, MAX_FALLBACKS);
    for (const id of [route.preferredProvider, ...fallbacks]) {
      if (!id) continue;
      const provider = current.providers[id];
      const isFallback = id !== route.preferredProvider;
      if (!provider.enabled || provider.configurationError || !provider.apiKey || !provider.model || !provider.capabilities.includes(capability) || (isFallback && !provider.fallbackEligible)) {
        throw new HttpError(422, `${AI_PROVIDER_DEFINITIONS[id].label} is not enabled and configured for this capability.`, 'AI_PROVIDER_CAPABILITY_UNAVAILABLE', `capabilityRouting.${capability}`);
      }
    }
    return [capability, { ...route, fallbackProviders: fallbacks }];
  }));
  await setSettingPaths({ 'value.schemaVersion': 2, 'value.capabilityRouting': routing, 'value.maxFallbackAttempts': parsed.data.maxFallbackAttempts, 'value.requestDeadlineMs': parsed.data.requestDeadlineMs });
  return providerAdminView(await readAiGatewayConfig());
}

export type ProviderAttempt = { provider: AiProviderId; model: string; status: 'success' | 'failed'; httpStatus?: number; latencyMs?: number; errorCategory?: string };
export type GatewayResult = { data: Record<string, unknown>; provider: AiProviderId; model: string; requestedModel: string; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null; latencyMs: number; fallbackAttempts: number; providerAttempts: ProviderAttempt[] };
export type GatewayOptions = { role?: string; priorUserMessages?: string[]; history?: Array<{ role: 'user' | 'assistant'; content: string }>; forceProvider?: AiProviderId; allowFallback?: boolean; allowUnverifiedProvider?: boolean; requestDeadlineMs?: number; outputMode?: 'capability' | 'explanation'; fetcher?: typeof fetch; nvidiaTransport?: typeof runNvidiaTransport };

class ProviderCallError extends Error {
  constructor(readonly provider: AiProviderId, readonly category: string, readonly transient: boolean, readonly status?: number, readonly retryAfterMs?: number, message = 'Provider request failed.') { super(message); }
}

function retryDelay(response: Response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 120_000) : undefined;
}

function extractUsage(value: any) {
  const usage = value?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Number.isFinite(Number(usage.prompt_tokens ?? usage.input_tokens)) ? Number(usage.prompt_tokens ?? usage.input_tokens) : null;
  const outputTokens = Number.isFinite(Number(usage.completion_tokens ?? usage.output_tokens)) ? Number(usage.completion_tokens ?? usage.output_tokens) : null;
  const totalTokens = Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null;
  return { inputTokens, outputTokens, totalTokens };
}

export function buildProviderRequest(provider: ProviderConfig, model: string, messages: Array<{ role: string; content: string }>) {
  const base = { model, messages, stream: false, response_format: { type: 'json_object' as const } };
  if (provider.id === 'nvidia' && model === 'z-ai/glm-5.3-flash') {
    // NVIDIA documents GLM-5.3-Flash as defaulting to maximum reasoning and
    // recommends clearing reasoning text for chat. Keep a short agricultural
    // response within the configured provider deadline and avoid sending both
    // temperature and top_p, which the model docs advise against.
    return {
      ...base, max_tokens: provider.maxTokens, temperature: provider.temperature,
      reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true },
    };
  }
  if (provider.id === 'openai') {
    const reasoningModel = /^(o[134]|gpt-5)/i.test(model);
    return { ...base, max_completion_tokens: provider.maxTokens, ...(reasoningModel ? {} : { temperature: provider.temperature, top_p: provider.topP }) };
  }
  if (provider.id === 'deepseek') {
    // DeepSeek's reasoning model does not support JSON mode or sampling settings.
    if (/reasoner/i.test(model)) return { model, messages, stream: false, max_tokens: provider.maxTokens };
    return { ...base, max_tokens: provider.maxTokens, temperature: provider.temperature, top_p: provider.topP };
  }
  return { ...base, max_tokens: provider.maxTokens, temperature: provider.temperature, top_p: provider.topP };
}

async function readBoundedResponse(response: Response, provider: AiProviderId, signal: AbortSignal) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PROVIDER_JSON_LIMIT) {
        await reader.cancel();
        throw new ProviderCallError(provider, 'response_too_large', false, response.status, undefined, 'Provider response was too large.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    if (signal.aborted || (error as { name?: string })?.name === 'AbortError' || (error as { name?: string })?.name === 'TimeoutError') {
      throw new ProviderCallError(provider, 'timeout', true, response.status, undefined, 'Provider request timed out.');
    }
    throw new ProviderCallError(provider, 'invalid_response', false, response.status, undefined, 'Provider response could not be read.');
  } finally { reader.releaseLock(); }
}

export async function callProvider(
  provider: ProviderConfig,
  model: string,
  messages: Array<{ role: string; content: string }>,
  timeoutMs: number,
  fetcher?: typeof fetch,
  nvidiaTransport: typeof runNvidiaTransport = runNvidiaTransport,
) {
  const startedAt = Date.now();
  if (!provider.enabled || !provider.apiKey || !model || !provider.capabilities.length) throw new ProviderCallError(provider.id, 'not_configured', false, undefined, undefined, 'Provider is not configured for this capability.');
  const requestBody = JSON.stringify(buildProviderRequest(provider, model, messages));
  if (Buffer.byteLength(requestBody, 'utf8') > 200_000) throw new ProviderCallError(provider.id, 'request_too_large', false, undefined, undefined, 'Provider request exceeded the configured size limit.');
  let envelope: any;
  let responseHttpStatus: number | undefined;
  if (provider.id === 'nvidia') {
    const config: NvidiaTransportConfig = { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model, timeoutMs };
    const result = await nvidiaTransport('complete', config, timeoutMs, JSON.parse(requestBody));
    if (!result.ok) {
      const failure = result.error;
      const category = failure?.category ?? 'transport_error';
      const status = typeof failure?.httpStatus === 'number' ? failure.httpStatus : undefined;
      const retryAfterMs = typeof failure?.retryAfterMs === 'number' ? failure.retryAfterMs : undefined;
      const transient = failure?.transient === true;
      const message = category === 'timeout' ? 'Provider request timed out.'
        : category === 'authentication' ? 'Provider rejected the configured credential.'
        : category === 'model_not_found' ? 'The configured provider model was not found.'
        : category === 'request_rejected' ? 'Provider rejected the configured request.'
        : transient ? 'Provider is temporarily unavailable.' : 'Provider request failed.';
      throw new ProviderCallError(provider.id, category, transient, status, retryAfterMs, message);
    }
    envelope = result.response;
    responseHttpStatus = 200;
  } else {
    let endpoint: string;
    try { endpoint = providerCompletionUrl(provider.id, provider.baseUrl); } catch { throw new ProviderCallError(provider.id, 'invalid_configuration', false, undefined, undefined, 'Provider URL is invalid.'); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await (fetcher ?? fetch)(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: requestBody,
      });
    } catch (error: any) {
      const timeout = error?.name === 'AbortError' || controller.signal.aborted;
      clearTimeout(timer);
      throw new ProviderCallError(provider.id, timeout ? 'timeout' : 'connection', true, undefined, undefined, timeout ? 'Provider request timed out.' : 'Provider could not be reached.');
    }
    try {
      if (!response.ok) {
        const status = response.status;
        const transient = status === 408 || status === 429 || status >= 500;
        const category = status === 401 || status === 403 ? 'authentication' : status === 404 ? 'model_not_found' : status === 400 || status === 422 ? 'request_rejected' : status === 408 ? 'timeout' : status === 429 ? 'rate_limited' : status >= 500 ? 'provider_unavailable' : 'provider_rejected';
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new ProviderCallError(provider.id, category, transient, status, retryDelay(response), transient ? 'Provider is temporarily unavailable.' : 'Provider rejected the request.');
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > PROVIDER_JSON_LIMIT) throw new ProviderCallError(provider.id, 'response_too_large', false, response.status, undefined, 'Provider response was too large.');
      const text = await readBoundedResponse(response, provider.id, controller.signal);
      try { envelope = JSON.parse(text); } catch { throw new ProviderCallError(provider.id, 'invalid_response', false, response.status, undefined, 'Provider response was not valid JSON.'); }
      responseHttpStatus = response.status;
    } finally { clearTimeout(timer); }
  }
  const choice = envelope?.choices?.[0];
  const message = choice?.message;
  if (message?.refusal || choice?.finish_reason === 'content_filter') throw new ProviderCallError(provider.id, 'policy_refusal', false, responseHttpStatus, undefined, 'Provider declined the request.');
  const content = message?.content;
  if (typeof content !== 'string' || !content.trim() || content.length > 50_000) throw new ProviderCallError(provider.id, 'invalid_response', false, responseHttpStatus, undefined, 'Provider returned an invalid response.');
  let data: any;
  try { data = JSON.parse(content); } catch { throw new ProviderCallError(provider.id, 'invalid_json', false, responseHttpStatus, undefined, 'Provider output did not match JSON mode.'); }
  return { data, provider: provider.id, model: String(envelope?.model ?? model), usage: extractUsage(envelope), latencyMs: Date.now() - startedAt, httpStatus: responseHttpStatus ?? 200 };
}

export async function routeAiGeneration(capability: AiCapability, payload: Record<string, unknown>, options: GatewayOptions = {}): Promise<GatewayResult> {
  if (!validCapability(capability)) throw new HttpError(404, 'AI capability not found.', 'AI_CAPABILITY_NOT_FOUND');
  const config = await readAiGatewayConfig();
  const route = config.capabilityRouting[capability];
  assertAiDomain(capability, payload, options.priorUserMessages ?? []);
  const ordered = getEligibleProviderOrder(config, capability, options.forceProvider, { allowUnverified: options.allowUnverifiedProvider === true });
  if (!ordered.length) throw new HttpError(503, options.forceProvider ? 'The selected provider is not configured for this capability.' : 'AgriLink AI is unavailable because no enabled provider supports this capability.', 'AI_PROVIDER_NOT_CONFIGURED');
  const maxFallbacks = options.allowFallback === false ? 0 : config.maxFallbackAttempts;
  const requestDeadlineMs = Math.round(clamp(options.requestDeadlineMs, config.requestDeadlineMs, 1_000, 120_000));
  const deadline = Date.now() + requestDeadlineMs;
  const userRole = options.role ?? 'unknown';
  const system = buildAgriLinkSystemInstruction(userRole, capability)
    + (options.outputMode === 'explanation' ? '\nFor this request return only JSON with one short "explanation" string. Explain, do not recalculate, rank, modify, or add records. Use only the supplied verified or deterministic context.' : '');
  const history = (options.history ?? []).slice(-24).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: JSON.stringify({ capability, input: payload }) },
  ];
  let lastFailure: ProviderCallError | null = null;
  let attempted = 0;
  const providerAttempts: ProviderAttempt[] = [];
  const maximumCalls = Math.min(ordered.length, maxFallbacks + 1);
  for (const id of ordered.slice(0, maximumCalls)) {
    const remaining = deadline - Date.now();
    if (remaining < 100) break;
    const provider = config.providers[id];
    const model = modelForCapability(config, capability, id);
    attempted += 1;
    let responseHttpStatus: number | undefined;
    try {
      const result = await callProvider(provider, model, messages, Math.min(provider.timeoutMs, remaining), options.fetcher, options.nvidiaTransport);
      responseHttpStatus = result.httpStatus;
      if (options.outputMode === 'explanation') {
        if (typeof result.data.explanation !== 'string' || !result.data.explanation.trim() || result.data.explanation.length > 4000) throw new ProviderCallError(id, 'invalid_response', false, undefined, undefined, 'Provider returned an invalid explanation.');
      } else validateAiResponse(capability, result.data);
      providerAttempts.push({ provider: id, model, status: 'success', httpStatus: result.httpStatus, latencyMs: result.latencyMs });
      return { ...result, requestedModel: model, fallbackAttempts: Math.max(0, attempted - 1), providerAttempts };
    } catch (error) {
      const failure = error instanceof ProviderCallError ? error : new ProviderCallError(id, 'invalid_response', false, undefined, undefined, 'Provider returned an invalid response.');
      lastFailure = failure;
      providerAttempts.push({ provider: id, model, status: 'failed', httpStatus: failure.status ?? responseHttpStatus, errorCategory: failure.category });
      if (!failure.transient) break;
    }
  }
  const details = {
    provider: lastFailure?.provider ?? ordered[Math.max(0, attempted - 1)] ?? null,
    category: lastFailure?.category ?? 'deadline_exceeded', latencyMs: requestDeadlineMs - Math.max(0, deadline - Date.now()),
    fallbackAttempts: Math.max(0, attempted - 1), retryAfterMs: lastFailure?.retryAfterMs ?? null, providerAttempts,
  };
  throw new HttpError(503, lastFailure?.message ?? 'The AgriLink AI request exceeded its configured deadline.', lastFailure?.category === 'authentication' ? 'AI_PROVIDER_AUTH_FAILED' : lastFailure?.category === 'model_not_found' ? 'AI_MODEL_UNAVAILABLE' : lastFailure?.category === 'policy_refusal' ? 'AI_PROVIDER_REFUSED' : 'AI_PROVIDER_UNAVAILABLE', undefined, details);
}

export async function runProviderConnectivityDiagnostic(
  id: AiProviderId,
  nvidiaTransport: typeof runNvidiaTransport = runNvidiaTransport,
) {
  if (!validProvider(id)) throw new HttpError(404, 'AI provider not found.', 'AI_PROVIDER_NOT_FOUND');
  const config = await readAiGatewayConfig();
  const provider = config.providers[id];
  if (id === 'nvidia') {
    const started = Date.now();
    const transportConfig: NvidiaTransportConfig = { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model: provider.model, timeoutMs: Math.min(provider.timeoutMs, 12_000) };
    const result = await nvidiaTransport('connectivity', transportConfig, transportConfig.timeoutMs);
    const received = result.ok && result.diagnostic && typeof result.diagnostic === 'object' ? result.diagnostic : null;
    const failure = result.error;
    const diagnostic = {
      checkedAt: new Date().toISOString(), stage: 'connectivity', transport: 'python-openai-sdk',
      dnsReachable: received?.dnsReachable ?? null,
      reachable: received?.reachable === true,
      tlsVerified: received?.tlsVerified ?? null,
      authenticated: received?.authenticated ?? (failure?.category === 'authentication' ? false : null),
      modelAvailable: received?.modelAvailable ?? null,
      requestedModel: provider.model,
      modelsCount: received?.modelsCount ?? null,
      httpStatus: received?.httpStatus ?? failure?.httpStatus ?? null,
      latencyMs: received?.latencyMs ?? Date.now() - started,
      errorCategory: received?.errorCategory ?? failure?.category ?? (received?.modelAvailable === false ? 'model_unavailable' : null),
    };
    await persistDiagnostic(id, 'connectivity', diagnostic);
    return diagnostic;
  }
  let url: URL;
  try { url = new URL(validateProviderBaseUrl(id, provider.baseUrl)); } catch { throw new HttpError(422, 'The configured provider URL is not allowed.', 'AI_PROVIDER_URL_INVALID'); }
  const started = Date.now();
  try {
    await lookup(url.hostname);
    const response = await fetch(url.toString(), { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(Math.min(provider.timeoutMs, 8_000)) });
    const diagnostic = { checkedAt: new Date().toISOString(), stage: 'connectivity', reachable: true, httpStatus: response.status, latencyMs: Date.now() - started, errorCategory: null };
    await persistDiagnostic(id, 'connectivity', diagnostic);
    return diagnostic;
  } catch (error: any) {
    const diagnostic = { checkedAt: new Date().toISOString(), stage: 'connectivity', reachable: false, httpStatus: null, latencyMs: Date.now() - started, errorCategory: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'connection' };
    await persistDiagnostic(id, 'connectivity', diagnostic);
    return diagnostic;
  }
}

export async function runProviderInferenceDiagnostic(
  id: AiProviderId,
  actorId?: unknown,
  capability: AiCapability = 'shared/agricultural-assistant',
  dependencies: Pick<GatewayOptions, 'fetcher' | 'nvidiaTransport'> = {},
) {
  if (!validProvider(id)) throw new HttpError(404, 'AI provider not found.', 'AI_PROVIDER_NOT_FOUND');
  if (!validCapability(capability)) throw new HttpError(422, 'Select a supported AI capability for the diagnostic.', 'AI_CAPABILITY_NOT_FOUND');
  const started = Date.now();
  const initialConfig = await readAiGatewayConfig();
  const initialProvider = initialConfig.providers[id];
  const initialFingerprint = providerConfigurationFingerprint(initialProvider);
  const requestedModel = modelForCapability(initialConfig, capability, id);
  let result: Awaited<ReturnType<typeof routeAiGeneration>>;
  let diagnosticAttempts: ProviderAttempt[] = [];
  try {
    result = await routeAiGeneration(capability, {
      message: 'For an agricultural readiness check, briefly explain whether maize is an agricultural crop.',
    }, { role: 'admin', forceProvider: id, allowFallback: false, allowUnverifiedProvider: true, requestDeadlineMs: 30_000, outputMode: 'explanation', ...dependencies });
    diagnosticAttempts = result.providerAttempts;
    const latestConfig = await readAiGatewayConfig();
    if (providerConfigurationFingerprint(latestConfig.providers[id]) !== initialFingerprint || result.requestedModel !== requestedModel) {
      throw new HttpError(409, 'Provider settings changed during the diagnostic. Run the diagnostic again for the saved configuration.', 'AI_PROVIDER_CONFIGURATION_CHANGED', undefined, { category: 'configuration_changed', providerAttempts: diagnosticAttempts });
    }
  } catch (error) {
    const details = error instanceof HttpError && error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {};
    const category = typeof details.category === 'string' ? details.category : error instanceof HttpError ? error.code : 'provider_error';
    const providerAttempts = Array.isArray(details.providerAttempts) ? details.providerAttempts as ProviderAttempt[] : diagnosticAttempts;
    const lastAttempt = providerAttempts.at(-1);
    const httpStatus = lastAttempt?.httpStatus;
    const successfulHttp = typeof httpStatus === 'number' && httpStatus >= 200 && httpStatus < 300;
    const diagnostic = {
      checkedAt: new Date().toISOString(), stage: 'inference',
      reachable: ['connection','timeout'].includes(category) ? false : typeof httpStatus === 'number' ? true : null,
      authenticated: category === 'authentication' ? false : successfulHttp ? true : null,
      modelAvailable: category === 'model_not_found' ? false : successfulHttp ? true : null,
      inferenceSucceeded: false, model: null, requestedModel, configurationFingerprint: initialFingerprint,
      httpStatus: httpStatus ?? null, latencyMs: Date.now() - started, errorCategory: category,
    };
    await persistDiagnostic(id, 'inference', diagnostic, actorId);
    await AiUsage.create({ user: actorId, capability, status: 'failed', provider: id, model: requestedModel, providerAttempts, errorCategory: category, latencyMs: diagnostic.latencyMs, fallbackAttempts: 0, operation: 'provider-diagnostic', createdAt: new Date() });
    throw error;
  }
  const diagnostic = { checkedAt: new Date().toISOString(), stage: 'inference', reachable: true, authenticated: true, modelAvailable: true, inferenceSucceeded: true, model: result.model, requestedModel: result.requestedModel, configurationFingerprint: initialFingerprint, latencyMs: Date.now() - started, errorCategory: null };
  await Promise.all([
    persistDiagnostic(id, 'inference', diagnostic, actorId),
    AiUsage.create({ user: actorId, capability, status: 'success', provider: id, model: result.model, providerAttempts: result.providerAttempts, usage: result.usage, latencyMs: result.latencyMs, fallbackAttempts: 0, operation: 'provider-diagnostic', createdAt: new Date() }),
  ]);
  const { configurationFingerprint: _configurationFingerprint, ...publicDiagnostic } = diagnostic;
  return { ...publicDiagnostic, provider: id, usage: result.usage };
}

async function persistDiagnostic(id: AiProviderId, stage: 'connectivity' | 'inference', diagnostic: Record<string, unknown>, actorId?: unknown) {
  const paths: Record<string, unknown> = {
    [`value.providers.${id}.lastDiagnostic`]: diagnostic,
    [`value.providers.${id}.last${stage === 'connectivity' ? 'Connectivity' : 'Inference'}Diagnostic`]: diagnostic,
    ...(actorId ? { 'value.updatedBy': String(actorId) } : {}),
  };
  if (stage === 'inference' && diagnostic.inferenceSucceeded === true) {
    const current = await readAiGatewayConfig();
    const provider = current.providers[id];
    const fingerprint = providerConfigurationFingerprint(provider);
    const verifiedModels = [...(provider.verifiedModels ?? [])]
      .filter((item) => item.configurationFingerprint === fingerprint && item.requestedModel !== diagnostic.requestedModel);
    verifiedModels.push(diagnostic);
    paths[`value.providers.${id}.lastSuccessfulInference`] = diagnostic;
    paths[`value.providers.${id}.verifiedModels`] = verifiedModels.slice(-capabilityList.length);
  }
  await setSettingPaths(paths);
}

export function transientAiFailure(error: unknown) { return error instanceof HttpError && ['AI_PROVIDER_UNAVAILABLE'].includes(error.code); }
