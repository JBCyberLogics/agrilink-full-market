import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getConfig } from '../config/env.js';
import { RefreshToken, User } from '../database/models.js';
import { HttpError } from './http.js';
import { normalizeRole, permissionsForRole, permissionsForUser } from './identity.js';

declare global { namespace Express { interface Request { user?: any; sessionRecord?: any } } }
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createCsrfValue(secret: string) {
  const nonce = randomBytes(32).toString('base64url');
  return nonce + '.' + createHmac('sha256', secret).update(nonce).digest('base64url');
}
export function validateCsrfValue(value: string | undefined, secret: string) {
  if (!value) return false;
  const [nonce, signature] = value.split('.');
  if (!nonce || !signature) return false;
  return safeEqual(signature, createHmac('sha256', secret).update(nonce).digest('base64url'));
}
export function issueCsrfCookie(res: Response) {
  const config = getConfig(); const token = createCsrfValue(config.sessionSecret);
  res.cookie('agrilink.csrf', token, { httpOnly: false, secure: config.COOKIE_SECURE, sameSite: config.COOKIE_SAME_SITE, path: '/', maxAge: 7200000 });
  return token;
}
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) return next();
  if (req.path.startsWith('/payments/mpesa/callback/') || req.path === '/payments/paypal/webhook') return next();
  const config = getConfig(); const origin = req.get('origin');
  if (origin && !config.origins.includes(origin)) return next(new HttpError(403, 'This browser origin is not allowed.', 'ORIGIN_NOT_ALLOWED'));
  const cookieValue = req.cookies?.['agrilink.csrf']; const headerValue = req.get('x-csrf-token');
  if (!cookieValue || !headerValue || !safeEqual(cookieValue, headerValue) || !validateCsrfValue(cookieValue, config.sessionSecret)) {
    return next(new HttpError(403, 'Refresh the page and retry the request.', 'CSRF_VALIDATION_FAILED'));
  }
  return next();
}
export async function createSession(user: any, res: Response) {
  const config = getConfig(); const rawToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600000);
  await RefreshToken.create({
    user: user._id ?? user.id, tokenHash: hashToken(rawToken), family: randomBytes(18).toString('base64url'),
    refreshTokenVersion: Number(user.refreshTokenVersion ?? 0), createdAt: new Date(), expiresAt, revokedAt: null,
  });
  res.cookie(config.COOKIE_NAME, rawToken, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: config.COOKIE_SAME_SITE, path: '/', expires: expiresAt });
  return expiresAt;
}
export function clearSessionCookie(res: Response) {
  const c = getConfig();
  res.clearCookie(c.COOKIE_NAME, { httpOnly: true, secure: c.COOKIE_SECURE, sameSite: c.COOKIE_SAME_SITE, path: '/' });
}
export async function authenticateRequest(req: Request) {
  const c = getConfig(); const cookieToken = req.cookies?.[c.COOKIE_NAME];
  const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]; const token = cookieToken || bearer;
  if (!token || token.length < 32) throw new HttpError(401, 'Sign in to continue.', 'UNAUTHENTICATED');
  const session = await RefreshToken.findOne({ tokenHash: hashToken(token), revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session) throw new HttpError(401, 'Your session has expired. Sign in again.', 'SESSION_EXPIRED');
  const user = await User.findById(session.user ?? session.userId).select('+refreshTokenVersion');
  if (!user || user.isActive === false || user.isDeleted === true) throw new HttpError(401, 'This account is unavailable.', 'ACCOUNT_UNAVAILABLE');
  if (session.refreshTokenVersion !== undefined && Number(session.refreshTokenVersion) !== Number(user.refreshTokenVersion ?? 0)) {
    throw new HttpError(401, 'Your session has been revoked. Sign in again.', 'SESSION_REVOKED');
  }
  req.user = user; req.sessionRecord = session; return user;
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  void authenticateRequest(req).then(() => next()).catch(next);
}
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  void authenticateRequest(req).then((user) => {
    if (!['admin', 'super_admin'].includes(normalizeRole(user.role) ?? '')) throw new HttpError(403, 'Administrator access is required.', 'ADMIN_REQUIRED');
    next();
  }).catch(next);
}
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    void authenticateRequest(req).then(async (user) => {
      const permissions=await permissionsForUser(user);
      if (!permissions.includes(permission)) throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
      next();
    }).catch(next);
  };
}
export async function revokeCurrentSession(req: Request) {
  if (req.sessionRecord?._id) await RefreshToken.updateOne({ _id: req.sessionRecord._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
export async function revokeUserSessions(userId: unknown) {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
export async function rotateCurrentSession(req: Request, res: Response) {
  if (!req.user || !req.sessionRecord?._id) throw new HttpError(401, 'Your session has expired. Sign in again.', 'SESSION_EXPIRED');
  await revokeCurrentSession(req); return createSession(req.user, res);
}
