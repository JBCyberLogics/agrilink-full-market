import { auth, users } from '../../../services/api/endpoints.js'

const unwrapUser = (value) => value?.user ?? value?.profile ?? value?.data?.user ?? value?.data ?? value

function accountShape(value) {
  const user = unwrapUser(value)
  if (!user || typeof user !== 'object') {
    throw { error: 'The server returned an invalid account profile.' }
  }

  return {
    id: user._id ?? user.id ?? null,
    fullName: user.fullName ?? user.name ?? '',
    email: user.email ?? '',
    role: user.role ?? null,
    image: user.image ?? null,
    memberSince: user.createdAt ?? user.created_at ?? null,
  }
}

/** Read the authenticated account through the existing self-only endpoint. */
export async function getMyAccountProfile() {
  return accountShape(await users.myProfile())
}

/** The current API exposes fullName as the editable user field. */
export async function updateMyAccountProfile({ fullName }) {
  const cleanName = String(fullName ?? '').trim()
  if (cleanName.length < 2) throw { field: 'fullName', error: 'Enter your full name.' }

  await users.updateMyProfile({ fullName: cleanName })
  return getMyAccountProfile()
}

/** Password values are sent directly to the existing auth endpoint and never persisted client-side. */
export function changeMyPassword({ currentPassword, newPassword, confirmPassword }) {
  return auth.changePassword({ currentPassword, newPassword, confirmPassword })
}

/** Account deletion uses the authenticated self-delete endpoint, then clears this browser's tokens. */
export async function deleteMyAccount({ password }) {
  const result = await users.deleteMyAccount({ password })
  auth.logout()
  return result
}
