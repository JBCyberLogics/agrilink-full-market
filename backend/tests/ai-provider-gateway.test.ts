import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AI_CAPABILITIES, decryptSecret, encryptSecret, loadAiConfig } from '../src/services/ai-provider.js';
import { AI_PROVIDER_DEFINITIONS, providerCompletionUrl, validateProviderBaseUrl, type AiProviderId } from '../src/services/ai-provider-registry.js';
import { buildProviderRequest, callProvider, getEligibleProviderOrder, providerAdminView, readAiGatewayConfig, routeAiGeneration, runProviderConnectivityDiagnostic, runProviderInferenceDiagnostic, saveProviderConfiguration, type GatewayConfig, type ProviderConfig } from '../src/services/ai-gateway.js';
import type { AiCapability } from '../src/services/ai-provider.js';
import { AiUsage, Setting } from '../src/database/models.js';

const capability: AiCapability = 'shared/agricultural-assistant';
const initialEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
function fingerprint(provider:{id:AiProviderId;baseUrl:string;model:string;apiKey:string;capabilities:AiCapability[]}){
  return createHash('sha256').update(JSON.stringify({id:provider.id,baseUrl:provider.baseUrl,model:provider.model,apiKey:provider.apiKey,capabilities:[...provider.capabilities].sort()})).digest('hex');
}
const baseProvider = (id: AiProviderId, overrides: Partial<ProviderConfig> = {}): ProviderConfig => {
  const provider:ProviderConfig={
    id, enabled: true, baseUrl: AI_PROVIDER_DEFINITIONS[id].defaultBaseUrl, model: `${id}-model`,
    apiKey: 'test-credential-never-a-real-key', priority: 10, isPrimary: false, fallbackEligible: true,
    timeoutMs: 5_000, temperature: 0.2, topP: 0.9, maxTokens: 256,
    capabilities: [...AI_CAPABILITIES], source: 'admin', ...overrides,
  };
  const verified={stage:'inference',inferenceSucceeded:true,requestedModel:provider.model,configurationFingerprint:fingerprint(provider)};
  provider.lastInferenceDiagnostic??=verified;
  provider.lastSuccessfulInference??=verified;
  return provider;
};

function routingConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  const providers = {
    nvidia: baseProvider('nvidia', { priority: 10 }),
    openai: baseProvider('openai', { priority: 20 }),
    deepseek: baseProvider('deepseek', { priority: 30 }),
  };
  return {
    storedValue: {}, providers,
    capabilityRouting: Object.fromEntries([
      'shared/agricultural-assistant','shared/market-advisor','shared/recommendations-center',
      'farmer/crop-advisor','farmer/price-advisor','farmer/listing-assistant','farmer/matching-assistant',
      'farmer/harvest-advisor','farmer/net-profit-advisor','buyer/produce-finder','buyer/supplier-advisor','buyer/purchase-assistant',
    ].map((key) => [key, { preferredProvider: 'nvidia', preferredModel: null, fallbackProviders: ['openai','deepseek'], explanationsEnabled: false }])),
    primaryProvider: 'nvidia', maxFallbackAttempts: 2, requestDeadlineMs: 10_000, ...overrides,
  } as GatewayConfig;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (initialEncryptionKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
  else process.env.CONFIG_ENCRYPTION_KEY = initialEncryptionKey;
});

function persistedGatewayConfiguration() {
  const encrypted = encryptSecret('test-provider-credential-only');
  const apiKey = 'test-provider-credential-only';
  const capabilities = [...AI_CAPABILITIES];
  return {
    schemaVersion: 2, primaryProvider: 'nvidia', maxFallbackAttempts: 2, requestDeadlineMs: 10_000,
    providers: Object.fromEntries((['nvidia','openai','deepseek'] as AiProviderId[]).map((id,index)=>{
      const provider={id,baseUrl:AI_PROVIDER_DEFINITIONS[id].defaultBaseUrl,model:`${id}-model`,apiKey,capabilities};
      const verified={stage:'inference',inferenceSucceeded:true,requestedModel:provider.model,configurationFingerprint:fingerprint(provider)};
      return[id,{
        enabled: true, baseUrl: provider.baseUrl, model: provider.model, encryptedApiKey: encrypted,
        priority: (index+1)*10, isPrimary: id==='nvidia', fallbackEligible: true, timeoutMs: 5_000,
        temperature: 0.2, topP: 0.9, maxTokens: 256, capabilities: [...capabilities],
        lastInferenceDiagnostic:verified,lastSuccessfulInference:verified,
      }];
    })),
    capabilityRouting: { [capability]: { preferredProvider: 'nvidia', preferredModel: null, fallbackProviders: ['openai','deepseek'], explanationsEnabled: false } },
  };
}

beforeEach(() => {
  process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  vi.spyOn(Setting, 'findOne').mockResolvedValue({ value: persistedGatewayConfiguration() } as never);
});

describe('provider registry and adapters', () => {
  it('restricts configured API URLs to each provider public HTTPS host', () => {
    expect(validateProviderBaseUrl('nvidia', 'https://integrate.api.nvidia.com/v1')).toBe('https://integrate.api.nvidia.com/v1');
    expect(validateProviderBaseUrl('openai', 'https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
    expect(validateProviderBaseUrl('deepseek', 'https://api.deepseek.com')).toBe('https://api.deepseek.com');
    expect(() => validateProviderBaseUrl('openai', 'http://127.0.0.1:8080/v1')).toThrow();
    expect(() => validateProviderBaseUrl('deepseek', 'https://example.com/v1')).toThrow();
    expect(() => validateProviderBaseUrl('nvidia', 'https://integrate.api.nvidia.com.evil.test/v1')).toThrow();
  });

  it('uses the provider-specific completion path', () => {
    expect(providerCompletionUrl('nvidia', AI_PROVIDER_DEFINITIONS.nvidia.defaultBaseUrl)).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(providerCompletionUrl('openai', AI_PROVIDER_DEFINITIONS.openai.defaultBaseUrl)).toBe('https://api.openai.com/v1/chat/completions');
    expect(providerCompletionUrl('deepseek', AI_PROVIDER_DEFINITIONS.deepseek.defaultBaseUrl)).toBe('https://api.deepseek.com/chat/completions');
  });

  it('formats OpenAI reasoning-model requests without unsupported sampling parameters', () => {
    const request = buildProviderRequest(baseProvider('openai'), 'o3-mini', [{ role: 'user', content: 'Explain verified crop evidence.' }]);
    expect(request).toMatchObject({ model: 'o3-mini', max_completion_tokens: 256, response_format: { type: 'json_object' } });
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('top_p');
  });

  it('formats DeepSeek reasoner requests without JSON mode or sampling parameters', () => {
    const request = buildProviderRequest(baseProvider('deepseek'), 'deepseek-reasoner', [{ role: 'user', content: 'Explain verified crop evidence.' }]);
    expect(request).toMatchObject({ model: 'deepseek-reasoner', max_tokens: 256, stream: false });
    expect(request).not.toHaveProperty('response_format');
    expect(request).not.toHaveProperty('temperature');
  });

  it('uses NVIDIA GLM-5.3-Flash low reasoning and clears reasoning output', () => {
    const messages = [{ role: 'user', content: 'Explain verified crop evidence.' }];
    const request = buildProviderRequest(baseProvider('nvidia'), 'z-ai/glm-5.3-flash', messages);
    expect(request).toMatchObject({
      model: 'z-ai/glm-5.3-flash', max_tokens: 256, stream: false,
      reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true },
      response_format: { type: 'json_object' },
    });
    expect(request).not.toHaveProperty('top_p');

    const otherProvider = buildProviderRequest(baseProvider('openai'), 'gpt-4o-mini', messages);
    expect(otherProvider).not.toHaveProperty('reasoning_effort');
    expect(otherProvider).not.toHaveProperty('chat_template_kwargs');
  });

  it('normalizes a mocked provider response and observed token usage', async () => {
    const transport = vi.fn(async () => ({ ok: true, response: {
      model: 'nvidia-model', choices: [{ message: { content: JSON.stringify({ content: 'Use soil moisture checks before irrigation.' }) } }],
      usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
    } }));
    const result = await callProvider(baseProvider('nvidia'), 'nvidia-model', [{ role: 'user', content: 'How should I irrigate maize?' }], 1000, undefined, transport as never);
    expect(result.data).toEqual({ content: 'Use soil moisture checks before irrigation.' });
    expect(result.usage).toEqual({ inputTokens: 17, outputTokens: 9, totalTokens: 26 });
    expect(transport).toHaveBeenCalledOnce();
  });
});

describe('gateway routing and credential protection', () => {
  it('uses the Python SDK models-list transport for the NVIDIA connectivity diagnostic', async () => {
    const update = vi.spyOn(Setting, 'updateOne').mockResolvedValue({} as never);
    const bridge = vi.fn(async (operation, provider, timeoutMs) => {
      expect(operation).toBe('connectivity');
      expect(provider.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
      expect(provider.model).toBe('nvidia-model');
      expect(provider.apiKey).toBe('test-provider-credential-only');
      expect(timeoutMs).toBeLessThanOrEqual(12_000);
      return { ok: true, diagnostic: { dnsReachable: true, reachable: true, tlsVerified: true, authenticated: true, modelAvailable: true, modelsCount: 2, httpStatus: 200, latencyMs: 42, errorCategory: null } };
    });
    const diagnostic = await runProviderConnectivityDiagnostic('nvidia', bridge as never);
    expect(diagnostic).toMatchObject({ transport: 'python-openai-sdk', dnsReachable: true, reachable: true, tlsVerified: true, authenticated: true, modelAvailable: true, requestedModel: 'nvidia-model' });
    expect(diagnostic).not.toHaveProperty('apiKey');
    expect(update).toHaveBeenCalled();
  });

  it('routes NVIDIA generation through the injected Python transport with freshly read Admin config', async () => {
    const bridge = vi.fn(async (operation, provider, _timeoutMs, request) => {
      expect(operation).toBe('complete');
      expect(provider.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
      expect(provider.model).toBe('nvidia-model');
      expect(provider.apiKey).toBe('test-provider-credential-only');
      expect(request).toMatchObject({ model: 'nvidia-model', stream: false });
      return { ok: true, response: { model: 'nvidia-model', choices: [{ message: { content: JSON.stringify({ content: 'Use soil moisture observations to guide irrigation.' }) } }] } };
    });
    const result = await routeAiGeneration(capability, { message: 'How do I irrigate maize?' }, { role: 'farmer', nvidiaTransport: bridge as never });
    expect(result.provider).toBe('nvidia');
    expect(result.data).toEqual({ content: 'Use soil moisture observations to guide irrigation.' });
    expect(bridge).toHaveBeenCalledOnce();
  });

  it('does not present missing or disabled providers as default fallbacks', async () => {
    vi.spyOn(Setting, 'findOne').mockResolvedValue({ value: {} } as never);
    const config = await readAiGatewayConfig();
    expect(config.primaryProvider).toBeNull();
    expect(config.capabilityRouting[capability].fallbackProviders).toEqual([]);
    expect(getEligibleProviderOrder(config, capability)).toEqual([]);
  });

  it('reads legacy NVIDIA credentials through a sparse canonical diagnostic entry without allowing stale legacy values to override explicit fields', async () => {
    const encryptedApiKey=encryptSecret('legacy-encrypted-provider-credential');
    vi.spyOn(Setting, 'findOne').mockResolvedValue({value:{
      enabled:true,baseUrl:AI_PROVIDER_DEFINITIONS.nvidia.defaultBaseUrl,model:'legacy-model',encryptedApiKey,
      providers:{nvidia:{lastDiagnostic:{stage:'connectivity',reachable:true}}},
    }} as never);
    const config=await readAiGatewayConfig();
    expect(config.providers.nvidia.apiKey).toBe('legacy-encrypted-provider-credential');
    expect(config.providers.nvidia.model).toBe('legacy-model');
    expect(config.providers.nvidia.configurationError).toBeUndefined();

    vi.spyOn(Setting, 'findOne').mockResolvedValue({value:{
      enabled:true,baseUrl:AI_PROVIDER_DEFINITIONS.nvidia.defaultBaseUrl,model:'legacy-model',encryptedApiKey,
      providers:{nvidia:{enabled:true,baseUrl:AI_PROVIDER_DEFINITIONS.nvidia.defaultBaseUrl,model:'',encryptedApiKey:null,capabilities:[capability]}},
    }} as never);
    const explicitEmpty=await readAiGatewayConfig();
    expect(explicitEmpty.providers.nvidia.apiKey).toBe('');
    expect(explicitEmpty.providers.nvidia.model).toBe('');
    expect(explicitEmpty.providers.nvidia.configurationError).toBe('credential_not_configured');
    const compatibilityView=await loadAiConfig();
    expect(compatibilityView.model).toBe('');
    expect(compatibilityView.apiKey).toBe('');
  });

  it('does not let NVIDIA environment values replace an explicitly saved canonical provider configuration', async () => {
    const previousKey=process.env.NVIDIA_API_KEY;const previousModel=process.env.NVIDIA_DEFAULT_MODEL;
    process.env.NVIDIA_API_KEY='environment-credential-must-not-win';process.env.NVIDIA_DEFAULT_MODEL='environment-model-must-not-win';
    try{
      vi.spyOn(Setting,'findOne').mockResolvedValue({value:{providers:{nvidia:{enabled:true,baseUrl:AI_PROVIDER_DEFINITIONS.nvidia.defaultBaseUrl,model:'',capabilities:[capability]}}}} as never);
      const config=await readAiGatewayConfig();
      expect(config.providers.nvidia.apiKey).toBe('');
      expect(config.providers.nvidia.model).toBe('');
    }finally{
      if(previousKey===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=previousKey;
      if(previousModel===undefined)delete process.env.NVIDIA_DEFAULT_MODEL;else process.env.NVIDIA_DEFAULT_MODEL=previousModel;
    }
  });

  it('selects the configured preferred provider and only configured eligible fallbacks', () => {
    const config = routingConfig();
    expect(getEligibleProviderOrder(config, capability)).toEqual(['nvidia','openai','deepseek']);
    config.providers.openai.enabled = false;
    config.capabilityRouting[capability].fallbackProviders = ['openai'];
    expect(getEligibleProviderOrder(config, capability)).toEqual(['nvidia']);
  });

  it('uses the shared gateway configuration for all twelve capability routes', () => {
    const config=routingConfig();
    for(const item of AI_CAPABILITIES){
      expect(getEligibleProviderOrder(config,item)[0],item).toBe('nvidia');
    }
  });

  it('never routes to a provider whose current model has not passed inference verification', () => {
    const config=routingConfig();
    config.providers.openai.lastSuccessfulInference=undefined;
    config.providers.openai.lastInferenceDiagnostic=undefined;
    expect(getEligibleProviderOrder(config,capability)).toEqual(['nvidia','deepseek']);
    config.providers.nvidia.model='changed-model';
    expect(getEligibleProviderOrder(config,capability)).toEqual(['deepseek']);
  });

  it('requires successful inference for each configured capability model override', () => {
    const config=routingConfig();
    config.capabilityRouting[capability].preferredModel='capability-specific-model';
    expect(getEligibleProviderOrder(config,capability)).not.toContain('nvidia');
    const provider=config.providers.nvidia;
    provider.verifiedModels=[...(provider.verifiedModels??[]),{
      stage:'inference',inferenceSucceeded:true,requestedModel:'capability-specific-model',
      configurationFingerprint:fingerprint(provider),
    }];
    expect(getEligibleProviderOrder(config,capability)[0]).toBe('nvidia');
  });

  it('uses only the saved fallback order when an explicit capability provider is unverified', () => {
    const config=routingConfig();
    config.primaryProvider='openai';
    config.capabilityRouting[capability].preferredProvider='nvidia';
    config.capabilityRouting[capability].fallbackProviders=['deepseek'];
    config.providers.nvidia.lastSuccessfulInference=undefined;
    config.providers.nvidia.lastInferenceDiagnostic=undefined;
    expect(getEligibleProviderOrder(config,capability)).toEqual(['deepseek']);
  });

  it('uses the saved automatic fallback list when the primary model is not verified', () => {
    const config=routingConfig();
    config.capabilityRouting[capability].preferredProvider=null;
    config.providers.nvidia.lastSuccessfulInference=undefined;
    config.providers.nvidia.lastInferenceDiagnostic=undefined;
    config.providers.openai.lastSuccessfulInference=undefined;
    config.providers.openai.lastInferenceDiagnostic=undefined;
    expect(getEligibleProviderOrder(config,capability)).toEqual(['deepseek']);
  });

  it('excludes providers without the requested capability and refuses forced ineligible providers', () => {
    const config = routingConfig();
    config.providers.deepseek.capabilities = [];
    expect(getEligibleProviderOrder(config, capability)).not.toContain('deepseek');
    expect(getEligibleProviderOrder(config, capability, 'deepseek')).toEqual([]);
  });

  it('encrypts provider credentials and decrypts them only on the backend', () => {
    const original = process.env.CONFIG_ENCRYPTION_KEY;
    process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const credential = 'test-provider-credential-only';
      const encrypted = encryptSecret(credential);
      expect(JSON.stringify(encrypted)).not.toContain(credential);
      expect(decryptSecret(encrypted)).toBe(credential);
    } finally {
      if (original === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
      else process.env.CONFIG_ENCRYPTION_KEY = original;
    }
  });

  it('returns masked provider metadata without credential material', async () => {
    const view = providerAdminView(await readAiGatewayConfig());
    const openAi = view.providers.find((provider) => provider.id === 'openai');
    expect(openAi?.hasCredential).toBe(true);
    expect(openAi).not.toHaveProperty('apiKey');
    expect(openAi).not.toHaveProperty('encryptedApiKey');
    expect(JSON.stringify(view)).not.toContain('test-provider-credential-only');
  });

  it('persists replacement credentials only as encrypted provider settings', async () => {
    const update = vi.spyOn(Setting, 'updateOne').mockResolvedValue({} as never);
    const secret = 'replacement-provider-key-never-returned';
    await saveProviderConfiguration('openai', {
      enabled: true, baseUrl: AI_PROVIDER_DEFINITIONS.openai.defaultBaseUrl, model: 'gpt-test-model', apiKey: secret,
      priority: 20, isPrimary: false, fallbackEligible: true, timeoutMs: 5_000, temperature: 0.2, topP: 0.9,
      maxTokens: 256, capabilities: [capability],
    });
    const updateCall = update.mock.calls.at(-1)?.[1] as { $set?: Record<string, any> } | undefined;
    const savedCredential = updateCall?.$set?.['value.providers.openai']?.encryptedApiKey;
    expect(savedCredential).toMatchObject({ iv: expect.any(String), tag: expect.any(String), data: expect.any(String) });
    expect(JSON.stringify(savedCredential)).not.toContain(secret);
    expect(updateCall?.$set?.['value.providers.openai']).not.toHaveProperty('apiKey');
  });

  it('falls back only across configured providers after transient failures', async () => {
    const mockFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: 'openai-model', choices: [{ message: { content: JSON.stringify({ content: 'Check field moisture before irrigation.' }) } }], usage: { input_tokens: 12, output_tokens: 8 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const bridge = vi.fn(async () => ({ ok: false, error: { category: 'provider_unavailable', transient: true, httpStatus: 503, retryAfterMs: 0 } }));
    const result = await routeAiGeneration(capability, { message: 'How should I irrigate maize?' }, { role: 'farmer', fetcher: mockFetch, nvidiaTransport: bridge as never });
    expect(result.provider).toBe('openai');
    expect(result.fallbackAttempts).toBe(1);
    expect(bridge).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('does not fall back on provider authentication failures', async () => {
    const mockFetch = vi.fn<typeof fetch>();
    const bridge = vi.fn(async () => ({ ok: false, error: { category: 'authentication', transient: false, httpStatus: 401 } }));
    await expect(routeAiGeneration(capability, { message: 'How should I irrigate maize?' }, { role: 'farmer', fetcher: mockFetch, nvidiaTransport: bridge as never })).rejects.toMatchObject({ code: 'AI_PROVIDER_AUTH_FAILED' });
    expect(bridge).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('treats a Python transport timeout as transient and falls back once', async () => {
    const mockFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: 'openai-model',
        choices: [{ message: { content: JSON.stringify({ content: 'Check soil moisture before irrigation.' }) } }],
      }), { status: 200 }));
    const bridge = vi.fn(async () => ({ ok: false, error: { category: 'timeout', transient: true } }));
    const result = await routeAiGeneration(capability, { message: 'How should I irrigate maize?' }, { role: 'farmer', fetcher: mockFetch, nvidiaTransport: bridge as never });
    expect(result.provider).toBe('openai');
    expect(result.fallbackAttempts).toBe(1);
  });

  it('keeps transient Python transport failures within the gateway request deadline', async () => {
    const mockFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: 'openai-model',
        choices: [{ message: { content: JSON.stringify({ content: 'Use field moisture to guide irrigation.' }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const bridge = vi.fn(async () => ({ ok: false, error: { category: 'connection', transient: true } }));
    const result = await routeAiGeneration(capability, { message: 'How should I irrigate maize?' }, { role: 'farmer', requestDeadlineMs: 2_000, fetcher: mockFetch, nvidiaTransport: bridge as never });
    expect(result.provider).toBe('openai');
    expect(result.fallbackAttempts).toBe(1);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('rejects an unrelated prompt before any provider call', async () => {
    const mockFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', mockFetch);
    const bridge = vi.fn();
    await expect(routeAiGeneration(capability, { message: 'Write a JavaScript program to sort a list.' }, { role: 'farmer', fetcher: mockFetch, nvidiaTransport: bridge as never })).rejects.toMatchObject({ code: 'AI_DOMAIN_NOT_SUPPORTED' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it('records explicit provider inference diagnostics as actual provider usage', async () => {
    const actor = '507f1f77bcf86cd799439011';
    const usageCreate = vi.spyOn(AiUsage, 'create').mockResolvedValue({} as never);
    vi.spyOn(Setting, 'updateOne').mockResolvedValue({} as never);
    const bridge = vi.fn(async () => ({ ok: true, response: {
      model: 'nvidia-model',
      choices: [{ message: { content: JSON.stringify({ explanation: 'Maize is an agricultural crop.' }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    } }));
    const result = await runProviderInferenceDiagnostic('nvidia', actor, capability, { nvidiaTransport: bridge as never });
    expect(result.inferenceSucceeded).toBe(true);
    expect(result.requestedModel).toBe('nvidia-model');
    expect(result).not.toHaveProperty('configurationFingerprint');
    expect(usageCreate).toHaveBeenCalledWith(expect.objectContaining({
      user: actor, capability, provider: 'nvidia', model: 'nvidia-model',
      operation: 'provider-diagnostic', status: 'success',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    }));
  });

  it('propagates an Admin provider/model change to subsequent requests across multiple capabilities', async () => {
    let persistedValue:any=persistedGatewayConfiguration();
    vi.spyOn(Setting,'findOne').mockImplementation((async()=>({value:structuredClone(persistedValue)})) as never);
    vi.spyOn(Setting,'updateOne').mockImplementation((async(_filter:any,update:any)=>{
      for(const [path,value] of Object.entries(update?.$set??{})){
        if(!path.startsWith('value.'))continue;
        const keys=path.slice('value.'.length).split('.');let target=persistedValue;
        for(const key of keys.slice(0,-1))target=target[key]??(target[key]={});
        target[keys.at(-1)!]=value;
      }
      return{};
    }) as never);
    vi.spyOn(AiUsage,'create').mockResolvedValue({} as never);
    const apiKey='openai-replacement-credential-for-isolated-test';
    await saveProviderConfiguration('openai',{
      enabled:true,baseUrl:AI_PROVIDER_DEFINITIONS.openai.defaultBaseUrl,model:'openai-updated-model',apiKey,
      priority:1,isPrimary:true,fallbackEligible:true,timeoutMs:5_000,temperature:0.2,topP:0.9,maxTokens:256,
      capabilities:[...AI_CAPABILITIES],
    });
    expect(persistedValue.providers.openai.encryptedApiKey).toMatchObject({iv:expect.any(String),tag:expect.any(String),data:expect.any(String)});
    expect(JSON.stringify(persistedValue.providers.openai)).not.toContain(apiKey);

    const mockFetch=vi.fn<typeof fetch>().mockImplementation(async(_input,init)=>{
      const request=JSON.parse(String(init?.body));
      const input=JSON.parse(request.messages.at(-1).content);
      const isDiagnostic=request.messages[0].content.includes('short "explanation" string');
      const content=isDiagnostic?{explanation:'The model is reachable through the AgriLink gateway.'}
        :input.capability==='farmer/crop-advisor'?{summary:'Use verified local soil and weather observations to guide crop care.'}
        :{timeline:'Use the supplied harvest timing and logistics inputs.'};
      return new Response(JSON.stringify({model:request.model,choices:[{message:{content:JSON.stringify(content)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
    });
    vi.stubGlobal('fetch',mockFetch);
    const diagnostic=await runProviderInferenceDiagnostic('openai','507f1f77bcf86cd799439011','farmer/crop-advisor',{fetcher:fetch});
    expect(diagnostic.inferenceSucceeded).toBe(true);
    const crop=await routeAiGeneration('farmer/crop-advisor',{produceType:'maize',growingStage:'vegetative',location:'user supplied location',expectedQuantity:10},{role:'farmer',fetcher:mockFetch});
    const harvest=await routeAiGeneration('farmer/harvest-advisor',{produceType:'maize',expectedHarvestDate:'2026-12-15',expectedQuantity:10,location:'user supplied location'},{role:'farmer',fetcher:mockFetch});
    expect(crop.provider).toBe('openai');
    expect(harvest.provider).toBe('openai');
    expect(crop.requestedModel).toBe('openai-updated-model');
    expect(harvest.requestedModel).toBe('openai-updated-model');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
