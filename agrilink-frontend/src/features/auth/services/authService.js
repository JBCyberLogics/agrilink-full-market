/**
 * Auth service — maps the AgriLink /api/v1 auth contract to the app's
 * user shape `{ id, name, email, role: 'Farmer' | 'Buyer' | 'Admin', raw }`.
 * Backend roles: seller → Farmer, customer → Buyer, admin roles → Admin.
 */
import { auth, users, otp } from '../../../services/api/endpoints.js'
import { announceSessionEnded, tokens } from '../../../services/api/client.js'

export const toBackendRole = (role) =>
  String(role ?? '').trim().toLowerCase() === 'farmer' ? 'seller' : 'customer'

export const toAppRole = (role) => {
  const normalized = String(role ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (['seller', 'farmer'].includes(normalized)) return 'Farmer'
  if (['customer', 'buyer'].includes(normalized)) return 'Buyer'
  if (['admin', 'administrator', 'superadmin'].includes(normalized)) return 'Admin'
  return null
}

export const normalizeUser = (input) => {
  const u = input?.user ?? input?.data?.user ?? input?.data ?? input
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null
  const firstName = typeof u.firstName === 'string' ? u.firstName.trim() : ''
  const lastName = typeof u.lastName === 'string' ? u.lastName.trim() : ''
  const name = u.fullName ?? u.name ?? u.displayName ?? [firstName, lastName].filter(Boolean).join(' ') ?? u.email
  const normalizedName = typeof name === 'string' && name.trim()
    ? name.trim()
    : typeof u.email === 'string' && u.email.trim()
      ? u.email.trim()
      : 'Account'
  return {
    id: u._id ?? u.id,
    name: normalizedName,
    email: u.email,
    role: toAppRole(u.role ?? u.accountType ?? u.userType),
    image: u.image ?? u.profilePicture ?? u.avatarUrl,
    raw: u,
  }
}

/** Step 1 of signup — sends the email OTP, returns the registration token */
export async function signup({ name, email, password, role }) {
  const data = await users.create({ fullName: name, email, password, role: toBackendRole(role) })
  const token =
    data?.createUserToken ??
    data?.token ??
    data?.registrationToken ??
    data?.otpToken ??
    data?.data?.createUserToken ??
    data?.data?.token ??
    (typeof data === 'string' ? data : null)
  return { token }
}

/** Step 2 of signup — verifies the OTP; then signs in with the same credentials */
export async function verifySignup({ token, code, email, password }) {
  await users.verifyOtp(token, code)
  return login({ email, password })
}

export async function resendSignupOtp(token) {
  const data = await otp.resend(token)
  const nextToken =
    data?.createUserToken ??
    data?.resendOtpToken ??
    data?.token ??
    data?.registrationToken ??
    data?.data?.createUserToken ??
    data?.data?.resendOtpToken ??
    data?.data?.token ??
    (typeof data === 'string' ? data : null)
  return { token: nextToken || token, data }
}

export async function login({ email, password, role }) {
  let data
  try {
    data = await auth.login({ email, password, ...(role ? { role: toBackendRole(role) } : {}) })
  } catch (error) {
    const accountRole = error?.details?.details?.accountRole
    if (error?.field === 'role' && accountRole) throw { ...error, accountRole }
    throw error
  }
  const user = normalizeUser(data)
  if (role && user?.role && user.role !== 'Admin' && user.role !== role) {
    tokens.clear()
    throw {
      status: 403,
      field: 'role',
      error: `Sorry ${user.role}. Try again.`,
    }
  }
  return user
}

export async function me() {
  const result = normalizeUser(await users.myProfile())
  if (!result?.id || !result?.role) return null
  return result
}

export async function logout() {
  tokens.clear()
  announceSessionEnded()
}

/**
 * Invalidate the server session before clearing browser state. The response
 * distinguishes a revoked session from an already expired or missing cookie.
 */
export async function invalidateServerSession() {
  const result = await auth.logout()
  return { serverInvalidated: result?.serverInvalidated === true }
}

/* password recovery (3 steps, each returns the token for the next) */
export const pickToken = (d) =>
  d?.forgetToken ??
  d?.forgetOtpMatchToken ??
  d?.token ??
  d?.accessToken ??
  d?.resetToken ??
  d?.data?.forgetToken ??
  d?.data?.forgetOtpMatchToken ??
  d?.data?.token ??
  (typeof d === 'string' ? d : null)

export const forgotPassword = async (email) => ({
  token: pickToken(await auth.forgotPasswordOtp(email)),
})

export const verifyResetOtp = async (token, code) => ({
  token: pickToken(await auth.forgotPasswordOtpMatch(token, code)) ?? token,
})

export const resetPassword = (token, newPassword, confirmPassword) =>
  auth.forgotPasswordReset(token, newPassword, confirmPassword)

export const changePassword = (body) => auth.changePassword(body)
export const deleteMyAccount = (body) => users.deleteMyAccount(body)
