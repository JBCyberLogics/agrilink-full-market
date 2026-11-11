import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getConfig } from '../config/env.js';
import { HttpError } from './http.js';
function encryptionKey() {
  const value = getConfig().encryptionKey;
  if (!value) throw new HttpError(503, 'Secure provider configuration is unavailable until the backend encryption key is set.', 'CONFIG_ENCRYPTION_NOT_CONFIGURED');
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new HttpError(503, 'The backend encryption key is invalid.', 'CONFIG_ENCRYPTION_INVALID');
  return key;
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { algorithm: 'aes-256-gcm', iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}
export function decryptSecret(value: { iv: string; ciphertext: string; tag: string }) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
