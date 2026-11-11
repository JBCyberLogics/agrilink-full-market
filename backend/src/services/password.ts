import { pbkdf2 as pbkdf2Callback, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { User } from '../database/models.js';
import { HttpError } from '../common/http.js';

const scrypt = promisify(scryptCallback);
const pbkdf2 = promisify(pbkdf2Callback);
const compareRaw = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function verifyStoredHash(stored: string, password: string) {
  if (/^\$2[aby]\$/.test(stored)) {
    const valid = await bcrypt.compare(password, stored);
    const cost = Number(stored.split('$')[2]);
    return { valid, rehash: valid && cost < 12 };
  }
  const scryptParts = stored.match(/^scrypt\$([^$]+)\$([^$]+)$/);
  if (scryptParts) {
    const calculated = await scrypt(password, Buffer.from(scryptParts[1]!, 'base64'), 64) as Buffer;
    return { valid: compareRaw(calculated.toString('base64'), scryptParts[2]!), rehash: true };
  }
  const pbkdf2Parts = stored.match(/^pbkdf2\$([0-9]+)\$([^$]+)\$([^$]+)$/);
  if (pbkdf2Parts) {
    const iterations = Math.min(2_000_000, Number(pbkdf2Parts[1]));
    const expected = Buffer.from(pbkdf2Parts[3]!, 'base64');
    const calculated = await pbkdf2(password, Buffer.from(pbkdf2Parts[2]!, 'base64'), iterations, expected.length, 'sha256') as Buffer;
    return { valid: iterations > 0 && expected.length > 0 && compareRaw(calculated.toString('base64'), expected.toString('base64')), rehash: true };
  }
  if (/^\$argon2/i.test(stored)) return { valid: false, rehash: false };
  if (/^[a-f0-9]{32,128}$/i.test(stored) || /^[a-z0-9]{40,128}$/i.test(stored)) {
    return { valid: false, rehash: false };
  }
  return { valid: compareRaw(stored, password), rehash: true };
}

export async function verifyAndUpgradePassword(user: any, password: string) {
  const hasCanonicalHash = typeof user.passwordHash === 'string' && user.passwordHash.length > 0;
  const stored = hasCanonicalHash ? user.passwordHash as string : typeof user.password === 'string' ? user.password : '';
  if (!stored) return false;
  const isRecognizedHash = /^\$2[aby]\$/.test(stored) || /^scrypt\$/.test(stored) || /^pbkdf2\$/.test(stored) || /^\$argon2/i.test(stored) || /^[a-f0-9]{32,128}$/i.test(stored) || /^[a-z0-9]{40,128}$/i.test(stored);
  if (hasCanonicalHash && !isRecognizedHash) return false;
  const result = isRecognizedHash ? await verifyStoredHash(stored, password) : { valid: compareRaw(stored, password), rehash: true };
  if (!result.valid) return false;
  if (result.rehash || !user.passwordHash || user.password) {
    const passwordHash = await bcrypt.hash(password, 12);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash, passwordChangedAt: new Date() }, $unset: { password: '' } });
    user.passwordHash = passwordHash;
    delete user.password;
  }
  return true;
}

export async function hashPassword(password: string) {
  if (password.length < 10 || password.length > 128) throw new HttpError(422, 'Use a password between 10 and 128 characters.', 'INVALID_PASSWORD', 'password');
  return bcrypt.hash(password, 12);
}
