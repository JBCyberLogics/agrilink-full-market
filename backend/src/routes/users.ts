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
import { claimPendingOtpAttempt } from '../common/otp.js';
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
usersRouter.get('/account-preferences', requireAuth, async (req, res) => {
  const user: any = await User.findById(req.user._id).select('accountPreferences').lean();
  if (!user) throw new HttpError(404, 'Account not found.', 'USER_NOT_FOUND');
  const saved = user.accountPreferences && typeof user.accountPreferences === 'object' ? user.accountPreferences : {};
  return sendData(res, { configured: Object.keys(saved).length > 0, preferences: { defaultListingUnit: saved.defaultListingUnit ?? null } });
});
usersRouter.patch('/account-preferences', requireAuth, async (req, res) => {
  const body = parseBody(z.object({ defaultListingUnit: z.enum(['kg','litre','bunch','tray','crate','bird','head','cob','jar']).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0), req.body);
  const update: any = { updatedAt: new Date() };
  if (body.defaultListingUnit !== undefined) update['accountPreferences.defaultListingUnit'] = body.defaultListingUnit;
  const user: any = await User.findByIdAndUpdate(req.user._id, { $set: update }, { returnDocument: 'after' }).select('accountPreferences');
  if (!user) throw new HttpError(404, 'Account not found.', 'USER_NOT_FOUND');
  await writeAudit({ actor: req.user._id, action: 'account.preferences_updated', resource: 'user', resourceId: String(req.user._id), metadata: { fields: Object.keys(body) } });
  return sendData(res, { configured: true, preferences: { defaultListingUnit: user.accountPreferences?.defaultListingUnit ?? null } });
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
  if (role === 'farmer') filter.role = { $in: ['farmer', 'seller'] };
  else if (role === 'buyer') filter.role = { $in: ['buyer', 'customer'] };
  else if (role) filter.role = { $regex: '^' + role.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '$', $options: 'i' };
  const status = String(req.query.status ?? '').trim().toLowerCase();
  if (status && !['active', 'suspended'].includes(status)) throw new HttpError(422, 'Choose active or suspended account status.', 'INVALID_USER_STATUS_FILTER');
  if (status === 'active') filter.isActive = { $ne: false };
  if (status === 'suspended') filter.isActive = false;
  const search = String(req.query.search ?? '').trim().slice(0, 80);
  if (search) {
    const escaped = search.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    filter.$or = [{ fullName: { $regex: escaped, $options: 'i' } }, { firstName: { $regex: escaped, $options: 'i' } }, { lastName: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }];
  }
  const [rows, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  const users = rows.map((user) => ({ ...displayUser(user), status: user.isActive === false ? 'suspended' : 'active' }));
  return sendList(res, users, page, limit, total);
});
usersRouter.get('/details/:id', requirePermission('users.read'), async (req, res) => {
  const id = objectId(req.params.id);
  const user: any = await User.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!user) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  const role = normalizeRole(user.role);
  const Profile = role === 'farmer' ? FarmerProfile : role === 'buyer' ? BuyerProfile : null;
  const profile: any = Profile ? await Profile.findOne({ user: id }).lean() : null;
  const allowedProfileFields = role === 'farmer'
    ? ['farmName', 'farmSize', 'farmSizeUnit', 'farmingExperienceYears', 'mainCrops', 'about', 'phoneNumber', 'county', 'subCounty', 'town', 'verificationStatus', 'verificationReason', 'verifiedAt', 'createdAt', 'updatedAt']
    : ['buyerType', 'organizationName', 'businessDescription', 'produceInterests', 'preferredSourcingLocation', 'phoneNumber', 'county', 'subCounty', 'town', 'verificationStatus', 'verificationReason', 'verifiedAt', 'createdAt', 'updatedAt'];
  const safeProfile = profile ? Object.fromEntries(allowedProfileFields.filter((key) => profile[key] !== undefined).map((key) => [key, profile[key]])) : null;
  return sendData(res, {
    user: { ...displayUser(user), status: user.isActive === false ? 'suspended' : 'active', verificationStatus: user.verificationStatus ?? profile?.verificationStatus ?? 'unverified' },
    profile: safeProfile,
  });
});
usersRouter.patch('/:id/block', requirePermission('users.update'), async (req, res) => {
  const id = objectId(req.params.id);
  if (String(id) === String(req.user._id)) throw new HttpError(409, 'You cannot suspend your own administrator account.', 'SELF_SUSPENSION_BLOCKED');
  const target = await User.findById(id);
  if (!target || target.isDeleted === true) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  if (['admin', 'super_admin'].includes(normalizeRole(target.role) ?? '')) {
    throw new HttpError(409, 'Use administrator access management to change an administrator account.', 'ADMIN_STATUS_REQUIRES_ADMINISTRATORS_MANAGE');
  }
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
    attempts: 0, resendAttempts: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  try { await sendOtpEmail(email, code, 'email-change'); }
  catch (error) { await Otp.deleteOne({ _id: record._id }); throw error; }
  return sendData(res, { status: 'verification_pending', changeId }, 202);
});
usersRouter.post('/email-change/verify', requireAuth, async (req, res) => {
  const body = parseBody(z.object({ changeId: z.string().min(32).max(128), code: z.string().regex(/^\d{6}$/) }), req.body);
  const record: any = await claimPendingOtpAttempt({ purpose: 'email-change', user: req.user._id, tokenHash: hash(body.changeId) }, '+otpHash +pendingEmail');
  const expected = hash(body.changeId + ':' + body.code);
  const actual = String(record?.otpHash ?? '');
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  if (!record || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  const consumed = await Otp.findOneAndUpdate(
    { _id: record._id, user: req.user._id, status: 'pending', attempts: record.attempts, expiresAt: { $gt: new Date() } },
    { $set: { status: 'used', usedAt: new Date() }, $unset: { otpHash: '', pendingEmail: '' } },
    { returnDocument: 'after' },
  );
  if (!consumed) throw new HttpError(400, 'The verification code is invalid or expired.', 'OTP_INVALID');
  const email = String(record.pendingEmail ?? record.sentTo).toLowerCase();
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { email, isEmailVerified: true, updatedAt: new Date() } });
  } catch (error: any) {
    if (error?.code === 11000) throw new HttpError(409, 'An account with that email already exists.', 'EMAIL_IN_USE');
    throw error;
  }
  await revokeUserSessions(req.user._id);
  return sendData(res, { changed: true, email });
});

profilesRouter.get('/me', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  const Model = role === 'farmer' ? FarmerProfile : role === 'buyer' ? BuyerProfile : null;
  if (!Model) throw new HttpError(403, 'A farmer or buyer profile is required.', 'FORBIDDEN');
  const profile = await Model.findOne({ user: req.user._id, isActive: { $ne: false }, $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }] });
  return sendData(res, { role, profile: profile ? profile.toObject() : null });
});
profilesRouter.post('/me', requireAuth, async (req, res) => saveProfile(req, res));
profilesRouter.patch('/me', requireAuth, async (req, res) => saveProfile(req, res));
async function saveProfile(req: any, res: any) {
  const role = normalizeRole(req.user.role);
  const Model = role === 'farmer' ? FarmerProfile : role === 'buyer' ? BuyerProfile : null;
  if (!Model) throw new HttpError(403, 'A farmer or buyer profile is required.', 'FORBIDDEN');
  const body = parseBody(z.object({
    profile: z.record(z.string(), z.unknown()),
  }).strict(), req.body);
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
        privacyPreferences: z.object({ showSellerName: z.boolean().optional(), showLocation: z.boolean().optional(), shareContactInformation: z.boolean().optional() }).strict().optional(),
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
  const farmerFields = fields as Record<string, any>;
  if (role === 'farmer' && req.method === 'POST') {
    if (!farmerFields.farmName?.trim()) throw new HttpError(422, 'Enter your farm name.', 'FARM_NAME_REQUIRED', 'farmName');
    if (!farmerFields.county?.trim()) throw new HttpError(422, 'Enter your county.', 'COUNTY_REQUIRED', 'county');
    if (!Array.isArray(farmerFields.mainCrops) || !farmerFields.mainCrops.length) throw new HttpError(422, 'Add at least one main crop.', 'MAIN_CROPS_REQUIRED', 'mainCrops');
  }
  const profile = await Model.findOneAndUpdate(
    { user: req.user._id },
    { $set: { ...fields, isActive: true, updatedAt: new Date() }, $unset: { archivedAt: 1 }, $setOnInsert: { user: req.user._id, verificationStatus: 'unverified', createdAt: new Date() } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return sendData(res, { role, profile: profile.toObject() }, req.method === 'POST' ? 201 : 200);
}
profilesRouter.delete('/me', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  const Model = role === 'farmer' ? FarmerProfile : role === 'buyer' ? BuyerProfile : null;
  if (!Model) throw new HttpError(403, 'A farmer or buyer profile is required.', 'FORBIDDEN');
  await Model.updateOne({ user: req.user._id }, { $set: { archivedAt: new Date(), isActive: false } });
  return sendData(res, { archived: true });
});

export const adminPeopleRouter = Router();
adminPeopleRouter.patch('/details/:id', requirePermission('users.update'), async (req, res) => {
  const id = objectId(req.params.id);
  const body = parseBody(z.object({
    fullName: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().max(24).nullable().optional(),
    county: z.string().trim().max(80).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0), req.body);
  const target = await User.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!target) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  if (['admin', 'super_admin'].includes(normalizeRole(target.role) ?? '')) {
    throw new HttpError(409, 'Administrator identity details must be managed through administrator access workflows.', 'ADMIN_PROFILE_UPDATE_RESTRICTED');
  }
  const fields: Record<string, unknown> = { updatedAt: new Date() };
  if (body.fullName !== undefined) {
    const parts = body.fullName.split(/\s+/);
    fields.fullName = body.fullName; fields.firstName = parts[0]; fields.lastName = parts.slice(1).join(' ');
  }
  for (const key of ['phone', 'county', 'city'] as const) if (body[key] !== undefined) fields[key] = body[key];
  await User.updateOne({ _id: id }, { $set: fields });
  const saved = await User.findById(id);
  await writeAudit({ actor: req.user._id, action: 'user.profile_updated_by_admin', resource: 'user', resourceId: String(id), metadata: { fields: Object.keys(body) } });
  return sendData(res, { user: displayUser(saved) });
});
adminPeopleRouter.get('/verifications', requirePermission('users.verify'), async (req, res) => {
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const status = String(req.query.status ?? '').trim().toLowerCase();
  const statuses = ['pending', 'verified', 'rejected'].includes(status) ? [status] : ['pending', 'verified', 'rejected'];
  const [farmerProfileIds, buyerProfileIds] = await Promise.all([
    FarmerProfile.find({ verificationStatus: { $in: statuses }, user: { $type: 'objectId' } }).distinct('user'),
    BuyerProfile.find({ verificationStatus: { $in: statuses }, user: { $type: 'objectId' } }).distinct('user'),
  ]);
  const profileUserIds = [...farmerProfileIds, ...buyerProfileIds];
  const filter: Record<string, any> = {
    isDeleted: { $ne: true }, role: { $in: ['farmer', 'seller', 'buyer', 'customer'] },
    $or: [ { verificationStatus: { $in: statuses } }, ...(profileUserIds.length ? [{ _id: { $in: profileUserIds } }] : []) ],
  };
  const search = String(req.query.search ?? '').trim().slice(0, 80);
  if (search) {
    const escaped = search.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    filter.$and = [{ $or: [{ fullName: { $regex: escaped, $options: 'i' } }, { firstName: { $regex: escaped, $options: 'i' } }, { lastName: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }] }];
  }
  const [users, total] = await Promise.all([User.find(filter).sort({ updatedAt: -1, _id: 1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  const rows = await Promise.all(users.map(async (user: any) => {
    const Model = normalizeRole(user.role) === 'farmer' ? FarmerProfile : BuyerProfile;
    const profile: any = await Model.findOne({ user: user._id }).lean();
    return {
      ...displayUser(user), _id: String(user._id), verificationStatus: user.verificationStatus ?? profile?.verificationStatus ?? 'unverified',
      verificationReason: user.verificationReason ?? profile?.verificationReason ?? null,
      verificationRequestedAt: user.verificationRequestedAt ?? profile?.verificationRequestedAt ?? profile?.createdAt ?? null,
      verificationUpdatedAt: user.updatedAt ?? profile?.updatedAt ?? null,
    };
  }));
  return sendList(res, rows, page, limit, total);
});
adminPeopleRouter.patch('/:id/role', requirePermission('users.roles.manage'), async (req, res) => {
  const id = objectId(req.params.id);
  if (String(id) === String(req.user._id)) throw new HttpError(409, 'You cannot change your own administrator role.', 'SELF_ROLE_CHANGE_BLOCKED');
  const role = parseBody(z.object({ role: z.enum(['farmer', 'buyer']) }), req.body).role;
  const target = await User.findOne({ _id: id, isDeleted: { $ne: true } }).select('role');
  if (!target) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  if (['admin', 'super_admin'].includes(normalizeRole(target.role) ?? '')) {
    throw new HttpError(409, 'Use administrator access management to update an administrator account.', 'ADMIN_ROLE_CHANGE_REQUIRES_ADMINISTRATORS_MANAGE');
  }
  const user = await User.findOneAndUpdate({ _id: id, role: target.role, isDeleted: { $ne: true } }, { $set: { role, updatedAt: new Date() }, $inc: { refreshTokenVersion: 1 } }, { returnDocument: 'after' });
  if (!user) throw new HttpError(409, 'This account changed while the request was being processed. Refresh and try again.', 'USER_ROLE_CHANGED');
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
