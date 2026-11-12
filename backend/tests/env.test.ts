import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '../src/config/env.js';

describe('environment defaults', () => {
  const keys = ['NODE_ENV', 'PORT', 'SESSION_TTL_HOURS', 'TRUST_PROXY', 'MAX_UPLOAD_BYTES', 'SMTP_PORT', 'NVIDIA_REQUEST_TIMEOUT_MS', 'NVIDIA_MAX_RETRIES', 'NVIDIA_TEMPERATURE', 'NVIDIA_TOP_P', 'NVIDIA_MAX_TOKENS', 'PAYPAL_KES_PER_USD', 'COOKIE_NAME', 'USER_COOKIE_NAME', 'ADMIN_COOKIE_NAME', 'CORS_ORIGINS', 'MARKETPLACE_APP_ORIGINS', 'ADMIN_APP_ORIGINS'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('uses documented defaults when numeric environment entries are blank', () => {
    process.env.NODE_ENV = 'test';
    for (const key of ['PORT', 'SESSION_TTL_HOURS', 'TRUST_PROXY', 'MAX_UPLOAD_BYTES', 'SMTP_PORT', 'NVIDIA_REQUEST_TIMEOUT_MS', 'NVIDIA_MAX_RETRIES', 'NVIDIA_TEMPERATURE', 'NVIDIA_TOP_P', 'NVIDIA_MAX_TOKENS', 'PAYPAL_KES_PER_USD']) process.env[key] = '';
    const config = getConfig();
    expect(config.PORT).toBe(4300);
    expect(config.SESSION_TTL_HOURS).toBe(168);
    expect(config.TRUST_PROXY).toBe(0);
    expect(config.MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    expect(config.SMTP_PORT).toBe(587);
    expect(config.NVIDIA_REQUEST_TIMEOUT_MS).toBe(30000);
    expect(config.NVIDIA_MAX_RETRIES).toBe(1);
    expect(config.NVIDIA_TEMPERATURE).toBe(0.2);
    expect(config.NVIDIA_TOP_P).toBe(0.9);
    expect(config.NVIDIA_MAX_TOKENS).toBe(1200);
    expect(config.PAYPAL_KES_PER_USD).toBeUndefined();
  });

  it('uses separate marketplace and admin cookie names while preserving the legacy marketplace alias', () => {
    process.env.NODE_ENV = 'test';
    process.env.COOKIE_NAME = 'agrilink.legacy.sid';
    delete process.env.USER_COOKIE_NAME;
    delete process.env.ADMIN_COOKIE_NAME;
    const config = getConfig();
    expect(config.USER_COOKIE_NAME).toBe('agrilink.legacy.sid');
    expect(config.ADMIN_COOKIE_NAME).toBe('agrilink.admin.sid');
    expect(config.USER_COOKIE_NAME).not.toBe(config.ADMIN_COOKIE_NAME);
  });

  it('rejects equal marketplace and admin cookie names', () => {
    process.env.NODE_ENV = 'test';
    process.env.USER_COOKIE_NAME = 'agrilink.same.sid';
    process.env.ADMIN_COOKIE_NAME = 'agrilink.same.sid';
    expect(() => getConfig()).toThrow('must be different');
  });

  it('keeps each session realm on its own explicit frontend origin set', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = 'http://localhost:5199,http://localhost:5173';
    process.env.MARKETPLACE_APP_ORIGINS = 'http://localhost:5199';
    process.env.ADMIN_APP_ORIGINS = 'http://localhost:5173';
    const config = getConfig();
    expect(config.marketplaceOrigins).toEqual(['http://localhost:5199']);
    expect(config.adminOrigins).toEqual(['http://localhost:5173']);
  });

  it('rejects realm origins that overlap or are outside the explicit CORS allowlist', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = 'http://localhost:5199,http://localhost:5173';
    process.env.MARKETPLACE_APP_ORIGINS = 'http://localhost:5199';
    process.env.ADMIN_APP_ORIGINS = 'http://localhost:5199';
    expect(() => getConfig()).toThrow('must not overlap');
    process.env.ADMIN_APP_ORIGINS = 'http://localhost:4173';
    expect(() => getConfig()).toThrow('contained in CORS_ORIGINS');
  });
});
