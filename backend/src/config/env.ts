import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const booleanValue = z.preprocess((value) => {
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return value;
}, z.boolean());
// Empty variables are common in .env files and deployment environments. Treat
// them as unset so optional settings use their documented defaults instead of
// coercing an empty string to numeric zero.
const numberValue = <T extends z.ZodType>(schema: T) => z.preprocess((value) => value === '' ? undefined : value, schema);

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: numberValue(z.coerce.number().int().min(1).max(65535).default(4300)),
  PUBLIC_API_URL: z.string().url().optional(),
  MONGODB_URI: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  CONFIG_ENCRYPTION_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5199,http://localhost:5173,http://localhost:4173'),
  MARKETPLACE_APP_ORIGINS: z.string().default('http://localhost:5199'),
  ADMIN_APP_ORIGINS: z.string().default('http://localhost:5173'),
  // COOKIE_NAME remains a compatibility fallback for older environment files.
  // New deployments should configure USER_COOKIE_NAME and ADMIN_COOKIE_NAME.
  COOKIE_NAME: z.string().min(1).default('agrilink.sid'),
  USER_COOKIE_NAME: z.string().trim().min(1).optional(),
  ADMIN_COOKIE_NAME: z.string().trim().min(1).default('agrilink.admin.sid'),
  COOKIE_SECURE: booleanValue.default(false),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  SESSION_TTL_HOURS: numberValue(z.coerce.number().int().min(1).max(720).default(168)),
  TRUST_PROXY: numberValue(z.coerce.number().int().min(0).max(5).default(0)),
  UPLOAD_DIRECTORY: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: numberValue(z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024)),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: numberValue(z.coerce.number().int().min(1).max(65535).default(587)),
  SMTP_SECURE: booleanValue.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  NVIDIA_API_BASE_URL: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_DEFAULT_MODEL: z.string().optional(),
  NVIDIA_REQUEST_TIMEOUT_MS: numberValue(z.coerce.number().int().min(1000).max(120000).default(30000)),
  NVIDIA_MAX_RETRIES: numberValue(z.coerce.number().int().min(0).max(3).default(1)),
  NVIDIA_TEMPERATURE: numberValue(z.coerce.number().min(0).max(2).default(0.2)),
  NVIDIA_TOP_P: numberValue(z.coerce.number().min(0).max(1).default(0.9)),
  NVIDIA_MAX_TOKENS: numberValue(z.coerce.number().int().min(1).max(8192).default(1200)),
  // Executable for the short-lived NVIDIA transport worker. Provider settings
  // remain in the encrypted MongoDB AI configuration and are sent per request.
  AI_PYTHON_EXECUTABLE: z.string().trim().min(1).default('python3'),
  MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().optional(),
  MPESA_CALLBACK_TOKEN: z.string().optional(),
  PAYPAL_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_KES_PER_USD: numberValue(z.coerce.number().positive().optional()),
  PAYPAL_RATE_SOURCE: z.string().optional(),
  WEATHER_API_BASE_URL: z.string().optional(),
  WEATHER_API_KEY: z.string().optional(),
  MARKET_DATA_PROVIDER_URL: z.string().optional(),
  MARKET_DATA_PROVIDER_KEY: z.string().optional(),
});

let developmentSecret: string | undefined;

export function getConfig() {
  const parsed = rawSchema.parse(process.env);
  const origins = parsed.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  const marketplaceOrigins = parsed.MARKETPLACE_APP_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  const adminOrigins = parsed.ADMIN_APP_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  if (!marketplaceOrigins.length || !marketplaceOrigins.every((origin) => origins.includes(origin))) {
    throw new Error('MARKETPLACE_APP_ORIGINS must be non-empty and contained in CORS_ORIGINS.');
  }
  if (!adminOrigins.length || !adminOrigins.every((origin) => origins.includes(origin))) {
    throw new Error('ADMIN_APP_ORIGINS must be non-empty and contained in CORS_ORIGINS.');
  }
  if (adminOrigins.some((origin) => marketplaceOrigins.includes(origin))) {
    throw new Error('MARKETPLACE_APP_ORIGINS and ADMIN_APP_ORIGINS must not overlap.');
  }
  const userCookieName = parsed.USER_COOKIE_NAME || parsed.COOKIE_NAME;
  if (userCookieName === parsed.ADMIN_COOKIE_NAME) {
    throw new Error('USER_COOKIE_NAME and ADMIN_COOKIE_NAME must be different.');
  }
  const sessionSecret = parsed.SESSION_SECRET || (developmentSecret ??= randomBytes(48).toString('base64url'));
  if (parsed.NODE_ENV === 'production') {
    if (!parsed.MONGODB_URI) throw new Error('MONGODB_URI is required in production.');
    if (!parsed.SESSION_SECRET || parsed.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
    if (origins.length === 0 || origins.includes('*')) throw new Error('CORS_ORIGINS must contain explicit browser origins in production.');
    if ([...marketplaceOrigins, ...adminOrigins].some((origin) => new URL(origin).protocol !== 'https:')) throw new Error('Production MARKETPLACE_APP_ORIGINS and ADMIN_APP_ORIGINS must use deployed HTTPS origins.');
    if (!parsed.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production.');
    if (parsed.COOKIE_SAME_SITE === 'none' && !parsed.COOKIE_SECURE) throw new Error('SameSite=None cookies require Secure.');
    if (!parsed.PUBLIC_API_URL || new URL(parsed.PUBLIC_API_URL).protocol !== 'https:') throw new Error('PUBLIC_API_URL must be an HTTPS API origin in production.');
  }

  return {
    ...parsed,
    USER_COOKIE_NAME: userCookieName,
    origins,
    marketplaceOrigins,
    adminOrigins,
    sessionSecret,
    encryptionKey: parsed.CONFIG_ENCRYPTION_KEY,
    mongoUri: parsed.MONGODB_URI,
    uploadDirectory: parsed.UPLOAD_DIRECTORY,
    publicApiUrl: parsed.PUBLIC_API_URL?.replace(/\/$/, '') ?? (parsed.NODE_ENV === 'development' ? `http://localhost:${parsed.PORT}` : ''),
  };
}

export function assertRuntimeConfig() {
  const config = getConfig();
  if (!config.mongoUri) throw new Error('MONGODB_URI is required to start the backend.');
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  return config;
}
