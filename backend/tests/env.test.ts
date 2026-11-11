import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '../src/config/env.js';

describe('environment defaults', () => {
  const keys = ['NODE_ENV', 'PORT', 'SESSION_TTL_HOURS', 'TRUST_PROXY', 'MAX_UPLOAD_BYTES', 'SMTP_PORT', 'NVIDIA_REQUEST_TIMEOUT_MS', 'NVIDIA_MAX_RETRIES', 'NVIDIA_TEMPERATURE', 'NVIDIA_TOP_P', 'NVIDIA_MAX_TOKENS', 'PAYPAL_KES_PER_USD'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('uses documented defaults when numeric environment entries are blank', () => {
    process.env.NODE_ENV = 'test';
    for (const key of keys.filter((name) => name !== 'NODE_ENV')) process.env[key] = '';
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
});
