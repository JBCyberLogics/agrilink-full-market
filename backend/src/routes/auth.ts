import { createHash, createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { getConfig } from '../config/env.js';
import { createSession, clearSessionCookie, csrfProtection, issueCsrfCookie, requireAuth, requireAdmin, revokeCurrentSession, revokeUserSessions, rotateCurrentSession } from '../common/auth.js';
import { sendOtpEmail } from '../common/email.js';
import { HttpError, sendData } from '../common/http.js';
import { displayUser, normalizeRole, permissionsForUser } from '../common/identity.js';
import { parseBody } from '../common/validation.js';
import { Otp, User } from '../database/models.js';
import { hashPassword, verifyAndUpgradePassword } from '../services/password.js';

export const authRouter = Router();
const loginSchema = z.object({
  email: z.string().trim().max(254).optional(),
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1).max(128),
  role: z.enum(['farmer', 'buyer', 'seller', 'customer']).optional(),
}).refine((value) => Boolean(value.email || value.username), { message: 'Enter your email or username.', path: ['email'] });

function challengeHash(value: string) {
  return createHmac('sha256', getConfig().sessionSecret).update(value).digest('hex');
}
function otpHash(code: string, challengeId: string) {
  return createHmac('sha256', getConfig().sessionSecret).update(challengeId + ':' + code).digest('hex');
}
function constantEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function createOtp(to: string, purpose: 'signup' | 'password-reset', values: Record<string, unknown>) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const challengeId = randomBytes(32).toString('base64url');
  const challenge = await Otp.create({
    sentTo: to, purpose, status: 'pending', tokenHash: challengeHash(challengeId),
    otpHash: otpHash(code, challengeId), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    ...values, createdAt: new Date(), updatedAt: new Date(),
  });
  try {
    await sendOtpEmail(to, code, purpose);
  } catch (error) {
    await Otp.deleteOne({ _id: challenge._id });
    throw error;
  }
  return { challengeId };
}

async function signIn(input: unknown, adminOnly = false) {
  const values = parseBody(loginSchema, input);
  const identity = String(values.email ?? values.username ?? '').trim().toLowerCase();
  const user = await User.findOne({ $or: [{ email: identity }, { username: identity }] })
    .select('+password +passwordHash +refreshTokenVersion');
  if (!user || user.isActive === false || user.isDeleted === true || !(await verifyAndUpgradePassword(user, values.password))) {
    throw new HttpError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  }
  const role = normalizeRole(user.role);
  if (adminOnly && role !== 'admin' && role !== 'super_admin') throw new HttpError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  if (!adminOnly && values.role && role !== normalizeRole(values.role)) {
    const accountRole = role === 'farmer' ? 'Farmer' : role === 'buyer' ? 'Buyer' : null;
    throw new HttpError(403, accountRole ? `This account is registered as a ${accountRole}.` : 'This account cannot sign in to the selected marketplace role.', 'ACCOUNT_ROLE_MISMATCH', 'role', { accountRole });
  }
  if (!adminOnly && user.isEmailVerified === false) throw new HttpError(403, 'Verify your email before signing in.', 'EMAIL_NOT_VERIFIED');
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return user;
}

authRouter.get('/csrf', (req, res) => sendData(res, { csrfToken: issueCsrfCookie(res) }));
authRouter.post('/login', csrfProtection, async (req, res) => {
  const user = await signIn(req.body, false);
  const expiresAt = await createSession(user, res);
  return sendData(res, { user: displayUser(user), expiresAt });
});
authRouter.post('/admin/login', csrfProtection, async (req, res) => {
  const user = await signIn(req.body, true);
  const expiresAt = await createSession(user, res);
  return sendData(res, {
    administrator: {
      id: String(user._id),
      displayName: displayUser(user).fullName,
      roles: [normalizeRole(user.role) ?? 'admin'],
      permissions: await permissionsForUser(user),
      mfaEnrolled: Boolean(user.mfaEnrolled),
    },
    expiresAt,
  });
});
authRouter.get('/me', requireAuth, (req, res) => sendData(res, { user: displayUser(req.user) }));
authRouter.get('/admin/session', requireAdmin, async (req, res) => {
  const identity = await import('../common/identity.js');
  return sendData(res, {
    administrator: {
      id: String(req.user._id),
      displayName: identity.displayUser(req.user).fullName,
      roles: [normalizeRole(req.user.role) ?? 'admin'],
      permissions: await identity.permissionsForUser(req.user),
      mfaEnrolled: Boolean(req.user.mfaEnrolled),
    },
    expiresAt: req.sessionRecord.expiresAt?.toISOString?.() ?? null,
  });
});
authRouter.post('/refresh-token', requireAuth, async (req, res) => {
  const expiresAt = await rotateCurrentSession(req, res);
  return sendData(res, { user: displayUser(req.user), expiresAt });
});
authRouter.post('/logout', csrfProtection, async (req, res) => {
  let serverInvalidated=false;try { await (await import('../common/auth.js')).authenticateRequest(req); await revokeCurrentSession(req);serverInvalidated=true; } catch { /* report invalidation separately when no live session was presented */ }
  clearSessionCookie(res);
  return sendData(res, { signedOut: true, serverInvalidated });
});
authRouter.post('/admin/logout', csrfProtection, async (req, res) => {
  let serverInvalidated=false;try { await (await import('../common/auth.js')).authenticateRequest(req); await revokeCurrentSession(req);serverInvalidated=true; } catch { /* report invalidation separately when no live session was presented */ }
  clearSessionCookie(res);
  return sendData(res, { signedOut: true, serverInvalidated });
});

authRouter.post('/forgot-password-otp', csrfProtection, async (req, res) => {
  const email = z.string().email().max(254).parse(req.body?.email).toLowerCase();
  const user = await User.findOne({ email, isDeleted: { $ne: true } });
  if (user) await createOtp(email, 'password-reset', { user: user._id });
  return sendData(res, { accepted: true }, 202, 'If the account can receive mail, a verification code will be sent.');
});
authRouter.patch('/forgot-password-otp-match', csrfProtection, async (req, res) => {
  const body = parseBody(z.object({ otp: z.string().regex(/^\d{6}$/), token: z.string().min(32).max(128) }), req.body);
  const record = await Otp.findOne({ purpose: 'password-reset', tokenHash: challengeHash(body.token), status: 'pending', expiresAt: { $gt: new Date() } }).select('+otpHash');
  if (!record?.otpHash || !constantEqual(String(record.otpHash), otpHash(body.otp, body.token))) throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  const resetToken = randomBytes(32).toString('base64url');
  record.resetTokenHash = challengeHash(resetToken);
  record.status = 'verified';
  record.otpHash = undefined;
  await record.save();
  return sendData(res, { resetToken });
});
authRouter.patch('/forgot-password-reset', csrfProtection, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(32).max(128), newPassword: z.string().min(10).max(128), confirmPassword: z.string().min(10).max(128) }), req.body);
  if (body.newPassword !== body.confirmPassword) throw new HttpError(422, 'Passwords do not match.', 'PASSWORD_MISMATCH', 'confirmPassword');
  const challenge = await Otp.findOne({ purpose: 'password-reset', resetTokenHash: challengeHash(body.token), status: 'verified', expiresAt: { $gt: new Date() } });
  if (!challenge?.user) throw new HttpError(400, 'The reset request is invalid or expired.', 'RESET_TOKEN_INVALID');
  const passwordHash = await hashPassword(body.newPassword);
  await User.updateOne({ _id: challenge.user }, { $set: { passwordHash, passwordChangedAt: new Date() }, $inc: { refreshTokenVersion: 1 }, $unset: { password: '' } });
  await revokeUserSessions(challenge.user);
  challenge.status = 'used'; challenge.resetTokenHash = undefined; await challenge.save();
  return sendData(res, { reset: true });
});
authRouter.patch('/change-password', requireAuth, csrfProtection, async (req, res) => {
  const body = parseBody(z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128), confirmPassword: z.string().min(10).max(128) }), req.body);
  if (body.newPassword !== body.confirmPassword) throw new HttpError(422, 'Passwords do not match.', 'PASSWORD_MISMATCH', 'confirmPassword');
  const user = await User.findById(req.user._id).select('+password +passwordHash +refreshTokenVersion');
  if (!user || !(await verifyAndUpgradePassword(user, body.currentPassword))) throw new HttpError(401, 'Current password is incorrect.', 'INVALID_CURRENT_PASSWORD', 'currentPassword');
  const passwordHash = await hashPassword(body.newPassword);
  await User.updateOne({ _id: user._id }, { $set: { passwordHash, passwordChangedAt: new Date(), refreshTokenVersion: Number(user.refreshTokenVersion ?? 0) + 1 }, $unset: { password: '' } });
  await revokeUserSessions(user._id);
  clearSessionCookie(res);
  return sendData(res, { changed: true });
});

authRouter.post('/google-login', csrfProtection, (_req, _res, next) => next(new HttpError(503, 'Google sign-in is not configured on the server.', 'IDENTITY_PROVIDER_NOT_CONFIGURED')));
authRouter.post('/apple-login', csrfProtection, (_req, _res, next) => next(new HttpError(503, 'Apple sign-in is not configured on the server.', 'IDENTITY_PROVIDER_NOT_CONFIGURED')));

const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  role: z.enum(['seller', 'customer', 'farmer', 'buyer']),
});
export const signupRouter = Router();
signupRouter.post('/create', csrfProtection, async (req, res) => {
  const body = parseBody(registrationSchema, req.body);
  const email = body.email.toLowerCase();
  if (await User.exists({ email })) throw new HttpError(409, 'An account with that email already exists.', 'EMAIL_IN_USE', 'email');
  const passwordHash = await hashPassword(body.password);
  const role = ['seller', 'farmer'].includes(body.role) ? 'farmer' : 'buyer';
  const challenge = await createOtp(email, 'signup', { registrationData: { fullName: body.fullName, passwordHash, role } });
  return sendData(res, { createUserToken: challenge.challengeId }, 202, 'Check your email for a verification code.');
});
signupRouter.post('/create-user-verify-otp', csrfProtection, async (req, res) => {
  const body = parseBody(z.object({ otp: z.string().regex(/^\d{6}$/), token: z.string().min(32).max(128) }), req.body);
  const challenge = await Otp.findOne({ purpose: 'signup', tokenHash: challengeHash(body.token), status: 'pending', expiresAt: { $gt: new Date() } }).select('+otpHash +registrationData');
  if (!challenge?.otpHash || !challenge.registrationData || !constantEqual(String(challenge.otpHash), otpHash(body.otp, body.token))) {
    throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  }
  const session = await mongoose.startSession();
  let user: any;
  try {
    await session.withTransaction(async () => {
      const data = challenge.registrationData;
      const names = String(data.fullName).trim().split(/\s+/);
      const created = await User.create([{
        email: challenge.sentTo,
        fullName: data.fullName,
        firstName: names[0],
        lastName: names.slice(1).join(' '),
        passwordHash: data.passwordHash,
        role: data.role,
        isActive: true,
        isDeleted: false,
        isEmailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }], { session });
      user = created[0];
      challenge.status = 'used'; challenge.otpHash = undefined; challenge.registrationData = undefined;
      await challenge.save({ session });
    });
  } finally { await session.endSession(); }
  const expiresAt = await createSession(user, res);
  return sendData(res, { user: displayUser(user), expiresAt });
});
export const otpRouter = Router();
otpRouter.patch('/resend-otp', csrfProtection, async (req, res) => {
  const token = z.string().min(32).max(128).parse(req.body?.token);
  const record = await Otp.findOne({ purpose: 'signup', tokenHash: challengeHash(token), status: 'pending', expiresAt: { $gt: new Date() } }).select('+registrationData');
  if (!record?.registrationData) throw new HttpError(400, 'The registration request is invalid or expired.', 'OTP_INVALID');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  record.otpHash = otpHash(code, token); record.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await record.save();
  await sendOtpEmail(record.sentTo, code, 'signup');
  return sendData(res, { createUserToken: token }, 202);
});
