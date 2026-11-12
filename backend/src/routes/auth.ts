import { createHash, createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { getConfig } from '../config/env.js';
import { authenticateRequest, assertSessionRealmOrigin, createSession, clearSessionCookie, csrfProtection, issueCsrfCookie, requireAuth, requireAdmin, revokeCurrentSession, revokeUserSessions, rotateCurrentSession } from '../common/auth.js';
import { sendOtpEmail } from '../common/email.js';
import { claimPendingOtpAttempt, OTP_MAX_RESENDS } from '../common/otp.js';
import { HttpError, sendData } from '../common/http.js';
import { displayUser, normalizeRole, permissionsForUser } from '../common/identity.js';
import { parseBody } from '../common/validation.js';
import { Otp, User } from '../database/models.js';
import { hashPassword, verifyAndUpgradePassword } from '../services/password.js';
import { requirePlatformFeature } from '../services/platform-settings.js';

export const authRouter = Router();
const INVALID_LOGIN_MESSAGE = 'Unable to sign in with those credentials. Please check your details and try again.';
const invalidLogin = () => new HttpError(401, INVALID_LOGIN_MESSAGE, 'INVALID_CREDENTIALS');
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

async function createOtp(to: string, purpose: 'signup' | 'password-reset', values: Record<string, unknown>, retainOnDeliveryFailure = false) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const challengeId = randomBytes(32).toString('base64url');
  const challenge = await Otp.create({
    sentTo: to, purpose, status: 'pending', tokenHash: challengeHash(challengeId),
    otpHash: otpHash(code, challengeId), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0, resendAttempts: 0,
    deliveryEligible: true, deliveryStatus: 'pending',
    ...values, createdAt: new Date(), updatedAt: new Date(),
  });
  try {
    await sendOtpEmail(to, code, purpose);
  } catch (error) {
    if (!retainOnDeliveryFailure) {
      await Otp.deleteOne({ _id: challenge._id });
      throw error;
    }
    await Otp.updateOne({ _id: challenge._id }, { $set: { deliveryStatus: 'failed', updatedAt: new Date() } });
    return { challengeId, delivered: false };
  }
  await Otp.updateOne({ _id: challenge._id }, { $set: { deliveryStatus: 'sent', resendAvailableAt: new Date(Date.now() + 30_000), updatedAt: new Date() } });
  return { challengeId, delivered: true };
}

async function signIn(input: unknown, adminOnly = false) {
  const values = parseBody(loginSchema, input);
  const identity = String(values.email ?? values.username ?? '').trim().toLowerCase();
  const user = await User.findOne({ $or: [{ email: identity }, { username: identity }] })
    .select('+password +passwordHash +refreshTokenVersion');
  if (!user || user.isActive === false || user.isDeleted === true || !(await verifyAndUpgradePassword(user, values.password))) {
    throw invalidLogin();
  }
  const role = normalizeRole(user.role);
  if (adminOnly && role !== 'admin' && role !== 'super_admin') throw invalidLogin();
  if (!adminOnly && role !== 'farmer' && role !== 'buyer') {
    throw invalidLogin();
  }
  if (!adminOnly && values.role && role !== normalizeRole(values.role)) throw invalidLogin();
  if (!adminOnly && user.isEmailVerified === false) throw new HttpError(403, 'Verify your email before signing in.', 'EMAIL_NOT_VERIFIED');
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return user;
}

authRouter.get('/csrf', (req, res) => { assertSessionRealmOrigin(req, 'marketplace'); return sendData(res, { csrfToken: issueCsrfCookie(res) }); });
authRouter.get('/admin/csrf', (req, res) => { assertSessionRealmOrigin(req, 'admin'); return sendData(res, { csrfToken: issueCsrfCookie(res, 'admin') }); });
authRouter.post('/login', csrfProtection, async (req, res) => {
  const user = await signIn(req.body, false);
  const expiresAt = await createSession(user, res, 'marketplace');
  return sendData(res, { user: displayUser(user), expiresAt });
});
authRouter.post('/admin/login', csrfProtection, async (req, res) => {
  const user = await signIn(req.body, true);
  const expiresAt = await createSession(user, res, 'admin');
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
  const expiresAt = await rotateCurrentSession(req, res, 'marketplace');
  return sendData(res, { user: displayUser(req.user), expiresAt });
});
authRouter.post('/admin/refresh-token', requireAdmin, async (req, res) => {
  const expiresAt = await rotateCurrentSession(req, res, 'admin');
  return sendData(res, { administrator: { id: String(req.user._id) }, expiresAt });
});
authRouter.post('/logout', csrfProtection, async (req, res) => {
  let serverInvalidated=false;try { await authenticateRequest(req, 'marketplace'); await revokeCurrentSession(req);serverInvalidated=true; } catch { /* report invalidation separately when no live marketplace session was presented */ }
  clearSessionCookie(res, 'marketplace');
  return sendData(res, { signedOut: true, serverInvalidated });
});
authRouter.post('/admin/logout', csrfProtection, async (req, res) => {
  let serverInvalidated=false;try { await authenticateRequest(req, 'admin'); await revokeCurrentSession(req);serverInvalidated=true; } catch { /* report invalidation separately when no live administrator session was presented */ }
  clearSessionCookie(res, 'admin');
  return sendData(res, { signedOut: true, serverInvalidated });
});

const recoveryAcceptedMessage = 'If this address can receive a recovery email, a code may arrive shortly. We do not confirm whether an account uses this address.';
authRouter.post('/forgot-password-otp', csrfProtection, async (req, res) => {
  const { email: submittedEmail } = parseBody(z.object({ email: z.string().trim().email().max(254) }).strict(), req.body);
  const email = submittedEmail.toLowerCase();
  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_FROM) throw new HttpError(503, 'Password recovery email is unavailable until the mail provider is configured.', 'EMAIL_PROVIDER_NOT_CONFIGURED');
  const user = await User.findOne({ email, isDeleted: { $ne: true }, isActive: { $ne: false } }).select('_id');
  let challengeId: string;
  if (user) {
    ({ challengeId } = await createOtp(email, 'password-reset', { user: user._id }, true));
  } else {
    // Keep response shape and status independent of account existence. The
    // unbound challenge cannot be emailed or converted into a reset token.
    challengeId = randomBytes(32).toString('base64url');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await Otp.create({ sentTo: email, purpose: 'password-reset', status: 'pending', tokenHash: challengeHash(challengeId), otpHash: otpHash(code, challengeId), deliveryEligible: false, deliveryStatus: 'not_applicable', expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, resendAttempts: 0, createdAt: new Date(), updatedAt: new Date() });
  }
  return sendData(res, { accepted: true, challengeId }, 202, recoveryAcceptedMessage);
});
authRouter.patch('/forgot-password-otp-resend', csrfProtection, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(32).max(128) }), req.body);
  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_FROM) throw new HttpError(503, 'Password recovery email is unavailable until the mail provider is configured.', 'EMAIL_PROVIDER_NOT_CONFIGURED');
  const now = new Date();
  const record: any = await Otp.findOneAndUpdate({
    purpose: 'password-reset', tokenHash: challengeHash(body.token), status: 'pending', deliveryEligible: { $ne: false }, expiresAt: { $gt: now },
    $and: [
      { $or: [{ resendAttempts: { $exists: false } }, { resendAttempts: { $lt: OTP_MAX_RESENDS } }] },
      { $or: [{ resendAvailableAt: { $exists: false } }, { resendAvailableAt: { $lte: now } }] },
      { $or: [{ resendInProgress: { $ne: true } }, { resendStartedAt: { $lt: new Date(now.getTime() - 120_000) } }] },
    ],
  }, { $set: { resendInProgress: true, resendStartedAt: now, updatedAt: now }, $inc: { resendAttempts: 1 } }, { returnDocument: 'after' }).select('+otpHash');
  if (record) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await sendOtpEmail(record.sentTo, code, 'password-reset');
      const updated = await Otp.updateOne({ _id: record._id, resendInProgress: true, status: 'pending' }, {
        $set: { otpHash: otpHash(code, body.token), expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, resendAvailableAt: new Date(Date.now() + 30_000), deliveryStatus: 'sent', updatedAt: new Date() },
        $unset: { resendInProgress: '', resendStartedAt: '' },
      });
      if (!updated.matchedCount) throw new HttpError(409, 'The recovery request changed before the new code could be saved. Request another code.', 'OTP_RESEND_CONFLICT');
    } catch (error) {
      await Otp.updateOne({ _id: record._id, resendInProgress: true }, { $set: { deliveryStatus: 'failed', resendAvailableAt: new Date(Date.now() + 30_000), updatedAt: new Date() }, $unset: { resendInProgress: '', resendStartedAt: '' } }).catch(() => undefined);
      if (error instanceof HttpError && error.code === 'OTP_RESEND_CONFLICT') throw error;
    }
  }
  return sendData(res, { accepted: true, challengeId: body.token }, 202, recoveryAcceptedMessage);
});
authRouter.patch('/forgot-password-otp-match', csrfProtection, async (req, res) => {
  const body = parseBody(z.object({ otp: z.string().regex(/^\d{6}$/), token: z.string().min(32).max(128) }), req.body);
  const record: any = await claimPendingOtpAttempt({ purpose: 'password-reset', tokenHash: challengeHash(body.token) }, '+otpHash');
  if (!record?.user || !record?.otpHash || !constantEqual(String(record.otpHash), otpHash(body.otp, body.token))) throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  const resetToken = randomBytes(32).toString('base64url');
  const verified = await Otp.findOneAndUpdate(
    { _id: record._id, status: 'pending', attempts: record.attempts, expiresAt: { $gt: new Date() } },
    { $set: { resetTokenHash: challengeHash(resetToken), status: 'verified', verifiedAt: new Date(), updatedAt: new Date() }, $unset: { otpHash: '' } },
    { returnDocument: 'after' },
  );
  if (!verified) throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  return sendData(res, { resetToken });
});
authRouter.patch('/forgot-password-reset', csrfProtection, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(32).max(128), newPassword: z.string().min(10).max(128), confirmPassword: z.string().min(10).max(128) }), req.body);
  if (body.newPassword !== body.confirmPassword) throw new HttpError(422, 'Passwords do not match.', 'PASSWORD_MISMATCH', 'confirmPassword');
  const challenge: any = await Otp.findOneAndUpdate(
    { purpose: 'password-reset', resetTokenHash: challengeHash(body.token), status: 'verified', expiresAt: { $gt: new Date() } },
    { $set: { status: 'used', usedAt: new Date(), updatedAt: new Date() }, $unset: { resetTokenHash: '' } },
    { returnDocument: 'after' },
  );
  if (!challenge?.user) throw new HttpError(400, 'The reset request is invalid or expired.', 'RESET_TOKEN_INVALID');
  const passwordHash = await hashPassword(body.newPassword);
  const updated = await User.updateOne({ _id: challenge.user, isDeleted: { $ne: true } }, { $set: { passwordHash, passwordChangedAt: new Date() }, $inc: { refreshTokenVersion: 1 }, $unset: { password: '' } });
  if (!updated.matchedCount) throw new HttpError(400, 'The reset request is invalid or expired.', 'RESET_TOKEN_INVALID');
  await revokeUserSessions(challenge.user);
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
  clearSessionCookie(res, 'marketplace');
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
  await requirePlatformFeature('registrationEnabled');
  const body = parseBody(registrationSchema, req.body);
  const email = body.email.toLowerCase();
  if (await User.exists({ email })) throw new HttpError(409, 'An account with that email already exists.', 'EMAIL_IN_USE', 'email');
  const passwordHash = await hashPassword(body.password);
  const role = ['seller', 'farmer'].includes(body.role) ? 'farmer' : 'buyer';
  const challenge = await createOtp(email, 'signup', { registrationData: { fullName: body.fullName, passwordHash, role } });
  return sendData(res, { createUserToken: challenge.challengeId }, 202, 'Check your email for a verification code.');
});
signupRouter.post('/create-user-verify-otp', csrfProtection, async (req, res) => {
  await requirePlatformFeature('registrationEnabled');
  const body = parseBody(z.object({ otp: z.string().regex(/^\d{6}$/), token: z.string().min(32).max(128) }), req.body);
  const challenge: any = await claimPendingOtpAttempt({ purpose: 'signup', tokenHash: challengeHash(body.token) }, '+otpHash +registrationData');
  if (!challenge?.otpHash || !challenge.registrationData || !constantEqual(String(challenge.otpHash), otpHash(body.otp, body.token))) {
    throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  }
  const session = await mongoose.startSession();
  let user: any;
  try {
    await session.withTransaction(async () => {
      const claimed = await Otp.findOneAndUpdate(
        { _id: challenge._id, status: 'pending', attempts: challenge.attempts, expiresAt: { $gt: new Date() } },
        { $set: { status: 'used', usedAt: new Date(), updatedAt: new Date() }, $unset: { otpHash: '', registrationData: '' } },
        { returnDocument: 'after', session },
      );
      if (!claimed) throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
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
    });
  } finally { await session.endSession(); }
  const expiresAt = await createSession(user, res, 'marketplace');
  return sendData(res, { user: displayUser(user), expiresAt });
});
export const otpRouter = Router();
otpRouter.patch('/resend-otp', csrfProtection, async (req, res) => {
  await requirePlatformFeature('registrationEnabled');
  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_FROM) throw new HttpError(503, 'Email verification is unavailable until the mail provider is configured.', 'EMAIL_PROVIDER_NOT_CONFIGURED');
  const token = z.string().min(32).max(128).parse(req.body?.token);
  const now = new Date();
  const record: any = await Otp.findOneAndUpdate({
    purpose: 'signup', tokenHash: challengeHash(token), status: 'pending', expiresAt: { $gt: now },
    registrationData: { $exists: true },
    $and: [
      { $or: [{ resendAttempts: { $exists: false } }, { resendAttempts: { $lt: OTP_MAX_RESENDS } }] },
      { $or: [{ resendInProgress: { $ne: true } }, { resendStartedAt: { $lt: new Date(now.getTime() - 120_000) } }] },
    ],
  }, { $set: { resendInProgress: true, resendStartedAt: now, updatedAt: now }, $inc: { resendAttempts: 1 } }, { returnDocument: 'after' }).select('+registrationData');
  if (!record?.registrationData) throw new HttpError(400, 'The registration request is invalid or expired.', 'OTP_INVALID');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await sendOtpEmail(record.sentTo, code, 'signup');
  } catch (error) {
    await Otp.updateOne({ _id: record._id, resendInProgress: true }, { $unset: { resendInProgress: '', resendStartedAt: '' }, $set: { updatedAt: new Date() } });
    throw error;
  }
  const updated = await Otp.updateOne({ _id: record._id, resendInProgress: true, status: 'pending' }, {
    $set: { otpHash: otpHash(code, token), expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, updatedAt: new Date() },
    $unset: { resendInProgress: '', resendStartedAt: '' },
  });
  if (!updated.matchedCount) throw new HttpError(409, 'The verification challenge changed before the new code could be saved. Request another code.', 'OTP_RESEND_CONFLICT');
  return sendData(res, { createUserToken: token }, 202);
});
