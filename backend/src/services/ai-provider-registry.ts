import { HttpError } from '../common/http.js';

export const AI_PROVIDER_DEFINITIONS = {
  nvidia: {
    id: 'nvidia', label: 'NVIDIA', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    allowedHost: 'integrate.api.nvidia.com', adapter: 'nvidia',
  },
  openai: {
    id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1',
    allowedHost: 'api.openai.com', adapter: 'openai',
  },
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com',
    allowedHost: 'api.deepseek.com', adapter: 'deepseek',
  },
} as const;

export type AiProviderId = keyof typeof AI_PROVIDER_DEFINITIONS;
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDER_DEFINITIONS) as AiProviderId[];

/** Restrict configurable URLs to the provider's public HTTPS API host. */
export function validateProviderBaseUrl(provider: AiProviderId, value: string) {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new HttpError(422, 'Enter a valid provider API base URL.', 'AI_PROVIDER_URL_INVALID', 'baseUrl');
  }
  const definition = AI_PROVIDER_DEFINITIONS[provider];
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== definition.allowedHost
    || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) {
    throw new HttpError(422, 'Use the configured provider’s public HTTPS API host without credentials or query parameters.', 'AI_PROVIDER_URL_NOT_ALLOWED', 'baseUrl');
  }
  if (!['', '/', '/v1'].includes(url.pathname.replace(/\/$/, ''))) throw new HttpError(422, 'Use the provider API root or its /v1 base path.', 'AI_PROVIDER_URL_INVALID', 'baseUrl');
  return url.toString().replace(/\/$/, '');
}

export function providerCompletionUrl(provider: AiProviderId, baseUrl: string) {
  const normalized = validateProviderBaseUrl(provider, baseUrl);
  const url = new URL(normalized);
  const prefix = url.pathname.replace(/\/$/, '') || (provider === 'deepseek' ? '' : '/v1');
  return `${url.origin}${prefix}/chat/completions`;
}
