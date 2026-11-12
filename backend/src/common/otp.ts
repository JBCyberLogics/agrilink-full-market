import { Otp } from '../database/models.js';

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_RESENDS = 3;

/** Atomically claim one verification attempt, including for legacy records without an attempts field. */
export function claimPendingOtpAttempt(filter: Record<string, any>, select: string) {
  return Otp.findOneAndUpdate({
    ...filter,
    status: 'pending',
    expiresAt: { $gt: new Date() },
    $and: [{ $or: [{ attempts: { $exists: false } }, { attempts: { $lt: OTP_MAX_ATTEMPTS } }] }],
  }, {
    $inc: { attempts: 1 },
    $set: { updatedAt: new Date() },
  }, { returnDocument: 'after' }).select(select);
}
