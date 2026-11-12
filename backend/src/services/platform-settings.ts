import { Setting } from '../database/models.js';
import { HttpError } from '../common/http.js';

const cached = new Map<string, { value: unknown; expiresAt: number }>();

export async function platformSetting(key: string): Promise<unknown> {
  const known = cached.get(key);
  if (known && known.expiresAt > Date.now()) return known.value;
  const saved: any = await Setting.findOne({ scope: 'platform', key }).select('value').lean();
  const value = saved?.value;
  cached.set(key, { value, expiresAt: Date.now() + 1000 });
  return value;
}

export function invalidatePlatformSettingsCache() { cached.clear(); }

export async function requirePlatformFeature(key: 'registrationEnabled' | 'marketplaceEnabled') {
  if (await platformSetting(key) === false) {
    const feature = key === 'registrationEnabled' ? 'Registration' : 'The marketplace';
    const code = key === 'registrationEnabled' ? 'REGISTRATION_DISABLED' : 'MARKETPLACE_DISABLED';
    throw new HttpError(503, `${feature} is currently disabled by platform settings.`, code);
  }
}

