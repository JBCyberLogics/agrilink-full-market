import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission, revokeUserSessions } from '../common/auth.js';
import { writeAudit } from '../common/audit.js';
import { displayUser, normalizeRole, requireRole } from '../common/identity.js';
import { HttpError, sendData, sendList } from '../common/http.js';
import { objectId, pagination, parseBody } from '../common/validation.js';
import { BuyerProfile, FarmerProfile, Otp, User } from '../database/models.js';
import { verifyAndUpgradePassword } from '../services/password.js';
import { sendOtpEmail } from '../common/email.js';
import { getConfig } from '../config/env.js';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const usersRouter = Router();
export const profilesRouter = Router();
const hash = (value: string) => createHmac('sha256', getConfig().sessionSecret).update(value).digest('hex');

usersRouter.get('/my-profile', requireAuth, async (req, res) => {
  return sendData(res, { user: displayUser(req.user) });
});
usersRouter.patch('/update-my-profile', requireAuth, async (req, res) => {
  const body = parseBody(z.object({
    fullName: z.string().trim().min(2).max(100).optional(),
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    phone: z.string().trim().max(24).optional(),
    county: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    address_line1: z.string().trim().max(200).optional(),
    address_line2: z.string().trim().max(200).optional(),
    postal_code: z.string().trim().max(20).optional(),
    image: z.string().url().max(2048).nullable().optional(),
  }).strict(), req.body);
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.fullName) {
    const parts = body.fullName.split(/\s+/);
    update.fullName = body.fullName; update.firstName = body.firstName ?? parts[0];
    update.lastName = body.lastName ?? parts.slice(1).join(' ');
  } else {
    if (body.firstName !== undefined) update.firstName = body.firstName;
    if (body.lastName !== undefined) update.lastName = body.lastName;
    const firstName = body.firstName ?? req.user.firstName ?? '';
    const lastName = body.lastName ?? req.user.lastName ?? '';
    if (body.firstName !== undefined || body.lastName !== undefined) update.fullName = [firstName, lastName].filter(Boolean).join(' ');
  }
  for (const key of ['phone', 'county', 'city', 'address_line1', 'address_line2', 'postal_code', 'image'] as const) {
    if (body[key] !== undefined) update[key] = body[key];
  }
  const saved = await User.findByIdAndUpdate(req.user._id, { $set: update }, { returnDocument: 'after' }).select('+refreshTokenVersion');
  return sendData(res, { user: displayUser(saved) });
});
usersRouter.delete('/delete-my-account', requireAuth, async (req, res) => {
  const body = parseBody(z.object({ password: z.string().min(1).max(128) }), req.body);
  const user = await User.findById(req.user._id).select('+password +passwordHash +refreshTokenVersion');
  if (!user || !(await verifyAndUpgradePassword(user, body.password))) throw new HttpError(401, 'Current password is incorrect.', 'INVALID_CURRENT_PASSWORD', 'password');
  await User.updateOne({ _id: user._id }, { $set: { isActive: false, isDeleted: true, deletedAt: new Date(), refreshTokenVersion: Number(user.refreshTokenVersion ?? 0) + 1 } });
  await revokeUserSessions(user._id);
  await writeAudit({ actor: user._id, action: 'account.soft_deleted', resource: 'user', resourceId: String(user._id) });
  return sendData(res, { deleted: true });
});
usersRouter.get('/all-users', requirePermission('users.read'), async (req, res) => {
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const filter: Record<string, any> = { isDeleted: { $ne: true } };
  const role = String(req.query.role ?? '').trim();
  if (role) filter.role = { $regex: '^' + role.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '$', $options: 'i' };
  const search = String(req.query.search ?? '').trim().slice(0, 80);
  if (search) {
    const escaped = search.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    filter.$or = [{ fullName: { $regex: escaped, $options: 'i' } }, { firstName: { $regex: escaped, $options: 'i' } }, { lastName: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }];
  }
  const [rows, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  const users = rows.map((user) => ({ ...displayUser(user), status: user.isActive === false ? 'suspended' : 'active' }));
  return sendList(res, users, page, limit, total);
});
usersRouter.patch('/:id/block', requirePermission('users.update'), async (req, res) => {
  const id = objectId(req.params.id);
  if (String(id) === String(req.user._id)) throw new HttpError(409, 'You cannot suspend your own administrator account.', 'SELF_SUSPENSION_BLOCKED');
  const target = await User.findById(id);
  if (!target || target.isDeleted === true) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  const nextActive = target.isActive === false;
  await User.updateOne({ _id: id }, { $set: { isActive: nextActive, updatedAt: new Date() } });
  if (!nextActive) await revokeUserSessions(id);
  await writeAudit({ actor: req.user._id, action: nextActive ? 'user.activated' : 'user.suspended', resource: 'user', resourceId: String(id) });
  return sendData(res, { id: String(id), isActive: nextActive });
});

usersRouter.post('/email-change/request', requireAuth, async (req, res) => {
  const email = parseBody(z.object({ email: z.string().email().max(254) }), req.body).email.toLowerCase();
  if (email === String(req.user.email).toLowerCase()) throw new HttpError(409, 'This is already the current email address.', 'EMAIL_UNCHANGED');
  if (await User.exists({ email })) throw new HttpError(409, 'An account with that email already exists.', 'EMAIL_IN_USE', 'email');
  if (!getConfig().SMTP_HOST || !getConfig().SMTP_FROM) throw new HttpError(503, 'Email verification is unavailable until the mail provider is configured.', 'EMAIL_PROVIDER_NOT_CONFIGURED');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const changeId = randomBytes(32).toString('base64url');
  const record = await Otp.create({
    sentTo: email, purpose: 'email-change', user: req.user._id,
    pendingEmail: email, status: 'pending', tokenHash: hash(changeId),
    otpHash: hash(changeId + ':' + code), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  try { await sendOtpEmail(email, code, 'email-change'); }
  catch (error) { await Otp.deleteOne({ _id: record._id }); throw error; }
  return sendData(res, { status: 'verification_pending', changeId }, 202);
});
usersRouter.post('/email-change/verify', requireAuth, async (req, res) => {
  const body = parseBody(z.object({ changeId: z.string().min(32).max(128), code: z.string().regex(/^\d{6}$/) }), req.body);
  const record = await Otp.findOne({ purpose: 'email-change', user: req.user._id, tokenHash: hash(body.changeId), status: 'pending', expiresAt: { $gt: new Date() } }).select('+otpHash');
  const expected = hash(body.changeId + ':' + body.code);
  const actual = String(record?.otpHash ?? '');
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  if (!record || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  const email = String(record.pendingEmail ?? record.sentTo).toLowerCase();
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { email, isEmailVerified: true, updatedAt: new Date() } });
  } catch (error: any) {
    if (error?.code === 11000) throw new HttpError(409, 'An account with that email already exists.', 'EMAIL_IN_USE');
    throw error;
  }
  record.status = 'used'; record.otpHash = undefined; await record.save();
  await revokeUserSessions(req.user._id);
  return sendData(res, { changed: true, email });
});

profilesRouter.get('/me', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  const Model = role === 'farmer' ? FarmerProfile : role === 'buyer' ? BuyerProfile : null;
  if (!Model) throw new HttpError(403, 'A farmer or buyer profile is required.', 'FORBIDDEN');
  const profile = await Model.findOne({ user: req.user._id });
  return sendData(res, { role, profile: profile ? profile.toObject() : null });
});
profilesRouter.post('/me', requireAuth, async (req, res) => saveProfile(req, res));
profilesRouter.patch('/me', requireAuth, async (req, res) => saveProfile(req, res));
async function saveProfile(req: any, res: any) {
  const role = normalizeRole(req.user.role);
  const Model = role === 'farmer' ? FarmerProfile : role === 'buyer' ? BuyerProfile : null;
  if (!Model) throw new HttpError(403, 'A farmer or buyer profile is required.', 'FORBIDDEN');
  const body = parseBody(z.object({
    role: z.string().optional(),
    profile: z.record(z.string(), z.unknown()),
  }), req.body);
  const sharedFields = {
    phoneNumber: z.string().trim().max(24).optional(), county: z.string().trim().max(80).optional(),
    subCounty: z.string().trim().max(80).optional(), town: z.string().trim().max(80).optional(),
  };
  const profileSchema = role === 'farmer'
    ? z.object({
        ...sharedFields,
        farmName: z.string().trim().max(120).optional(),
        farmSize: z.union([z.number().nonnegative(), z.null()]).optional(),
        farmSizeUnit: z.enum(['acres', 'hectares']).optional(),
        farmingExperienceYears: z.union([z.number().int().nonnegative(), z.null()]).optional(),
        mainCrops: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
        about: z.string().trim().max(3000).optional(),
      }).strict()
    : z.object({
        ...sharedFields,
        buyerType: z.enum(['individual', 'business']).optional(),
        organizationName: z.string().trim().max(160).optional(),
        businessDescription: z.string().trim().max(2000).optional(),
        produceInterests: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
        preferredSourcingLocation: z.string().trim().max(120).optional(),
      }).strict();
  const fields = parseBody(profileSchema.partial(), body.profile);
  if (!Object.keys(fields).length) throw new HttpError(422, 'No editable profile fields were supplied.', 'PROFILE_FIELDS_REQUIRED');
  const profile = await Model.findOneAndUpdate(
    { user: req.user._id },
    { $set: { ...fields, updatedAt: new Date() }, $setOnInsert: { user: req.user._id, verificationStatus: 'unverified', createdAt: new Date() } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return sendData(res, { role, profile: profile.toObject() });
}
profilesRouter.delete('/me', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  const Model = role === 'farmer' ? FarmerProfile : role === 'buyer' ? BuyerProfile : null;
  if (!Model) throw new HttpError(403, 'A farmer or buyer profile is required.', 'FORBIDDEN');
  await Model.updateOne({ user: req.user._id }, { $set: { archivedAt: new Date(), isActive: false } });
  return sendData(res, { archived: true });
});

export const adminPeopleRouter = Router();
adminPeopleRouter.patch('/:id/role', requirePermission('users.roles.manage'), async (req, res) => {
  const id = objectId(req.params.id);
  const role = parseBody(z.object({ role: z.enum(['farmer', 'buyer', 'admin', 'super_admin']) }), req.body).role;
  if (String(id) === String(req.user._id)) throw new HttpError(409, 'You cannot change your own administrator role.', 'SELF_ROLE_CHANGE_BLOCKED');
  await User.findByIdAndUpdate(id, { $set: { role, updatedAt: new Date() }, $inc: { refreshTokenVersion: 1 } });
  await revokeUserSessions(id);
  await writeAudit({ actor: req.user._id, action: 'user.role_changed', resource: 'user', resourceId: String(id), metadata: { role } });
  return sendData(res, { id: String(id), role });
});
adminPeopleRouter.patch('/:id/verification', requirePermission('users.verify'), async (req, res) => {
  const id = objectId(req.params.id);
  const body = parseBody(z.object({ status: z.enum(['pending', 'verified', 'rejected']), reason: z.string().trim().min(5).max(500) }), req.body);
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  const Model = normalizeRole(user.role) === 'farmer' ? FarmerProfile : normalizeRole(user.role) === 'buyer' ? BuyerProfile : null;
  if (Model) await Model.updateOne({ user: id }, { $set: { verificationStatus: body.status, verificationReason: body.reason, verifiedBy: req.user._id, verifiedAt: new Date() } });
  await User.updateOne({ _id: id }, { $set: { verificationStatus: body.status, updatedAt: new Date() } });
  await writeAudit({ actor: req.user._id, action: 'user.verification_decided', resource: 'user', resourceId: String(id), metadata: { status: body.status, reason: body.reason } });
  return sendData(res, { id: String(id), verificationStatus: body.status });
});
