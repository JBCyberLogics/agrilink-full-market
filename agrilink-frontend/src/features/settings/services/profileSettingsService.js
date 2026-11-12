import { API_BASE_CONFIGURED, request } from '../../../services/api/client.js'

const profileEndpoint = import.meta.env?.VITE_AGRILINK_PROFILE_ENDPOINT?.trim() || '/profiles/me'
const avatarEndpoint = import.meta.env?.VITE_AGRILINK_PROFILE_AVATAR_ENDPOINT?.trim() || '/upload/image'
const emailChangeEndpoint = import.meta.env?.VITE_AGRILINK_EMAIL_CHANGE_ENDPOINT?.trim() || '/users/email-change/request'
const emailVerifyEndpoint = import.meta.env?.VITE_AGRILINK_EMAIL_VERIFY_ENDPOINT?.trim() || '/users/email-change/verify'

export const PROFILE_INTEGRATION_REQUIRED = 'Profile persistence is not connected. Your changes were not saved.'
export const EMAIL_INTEGRATION_REQUIRED = 'Email change is not connected. Your email has not been changed.'

function requirePath(path, feature) {
  if (!path) throw { code: 'INTEGRATION_REQUIRED', error: `${feature} is not configured. No data was sent.` }
  if (!path.startsWith('/') || path.startsWith('//')) throw { code: 'INVALID_CONFIGURATION', error: `${feature} must be configured as an API-relative path.` }
  return path
}

const unwrap = (value) => value?.profile ?? value?.data?.profile ?? value?.data ?? value

/** Optional proposed profile resource; it is inactive unless explicitly configured. */
export const isProfilePersistenceConfigured = () => Boolean(API_BASE_CONFIGURED && profileEndpoint)
export const isAvatarStorageConfigured = () => Boolean(API_BASE_CONFIGURED && avatarEndpoint)
export const isEmailChangeConfigured = () => Boolean(API_BASE_CONFIGURED && emailChangeEndpoint && emailVerifyEndpoint)

export async function readExtendedProfile() {
  if (!profileEndpoint) return { configured: false, profile: null }
  try {
    const result = await request(requirePath(profileEndpoint, 'Profile persistence'))
    return { configured: true, profile: unwrap(result) }
  } catch (error) {
    if (error?.status === 404) return { configured: true, profile: null }
    throw error
  }
}

const defaultPrivacyPreferences = { showSellerName: true, showLocation: true, shareContactInformation: false }
export async function readPrivacyPreferences() {
  const result = await readExtendedProfile()
  const saved = result.profile?.privacyPreferences ?? {}
  return { configured: Object.keys(saved).length > 0, preferences: { ...defaultPrivacyPreferences, ...saved } }
}

export async function savePrivacyPreferences(preferences) {
  const result = await updateExtendedProfile({ privacyPreferences: preferences })
  const profile = unwrap(result)
  return { ...defaultPrivacyPreferences, ...(profile?.privacyPreferences ?? preferences) }
}

export async function readAccountPreferences() {
  const result = await request('/users/account-preferences')
  return { configured: result?.configured === true, preferences: result?.preferences ?? { defaultListingUnit: null } }
}

export async function saveAccountPreferences(preferences) {
  return request('/users/account-preferences', { method: 'PATCH', body: preferences })
}

export async function createExtendedProfile(profile) {
  const result = await request(requirePath(profileEndpoint, 'Profile persistence'), {
    method: 'POST', body: { profile },
  })
  return unwrap(result)
}

export async function updateExtendedProfile(profile) {
  const result = await request(requirePath(profileEndpoint, 'Profile persistence'), {
    method: 'PATCH', body: { profile },
  })
  return unwrap(result)
}

/** Delete optional role-specific profile data only; account deletion stays separate. */
export function deleteExtendedProfile() {
  return request(requirePath(profileEndpoint, 'Profile persistence'), { method: 'DELETE' })
}

export function uploadProfilePicture(file, onProgress = () => {}) {
  if (!API_BASE_CONFIGURED) {
    return Promise.reject({
      status: 0,
      code: 'API_BASE_NOT_CONFIGURED',
      error: 'The AgriLink backend is not configured. Set VITE_API_BASE_URL and restart Vite before uploading images.',
    })
  }
  const path = requirePath(avatarEndpoint, 'Profile-picture storage')
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('purpose', 'profile')
    request(path, { method: 'POST', body: form })
      .then((data) => {
        const imageUrl = data?.imageUrl ?? data?.url
        if (typeof imageUrl !== 'string' || !imageUrl) throw { code: 'INVALID_UPLOAD_RESPONSE', error: 'The server did not confirm a stored image URL.' }
        onProgress(100)
        resolve({ imageUrl })
      })
      .catch(reject)
  })
}

export function removeProfilePicture() {
  return request(requirePath(avatarEndpoint, 'Profile-picture storage'), { method: 'DELETE' })
}

export async function requestEmailChange(email) {
  const result = await request(requirePath(emailChangeEndpoint, 'Email-change verification'), {
    method: 'POST', body: { email },
  })
  const response = unwrap(result)
  if (response?.status !== 'verification_pending' || typeof response.changeId !== 'string') {
    throw { code: 'INVALID_EMAIL_CHANGE_RESPONSE', error: 'The server did not return a pending verification request.' }
  }
  return response
}

export function verifyEmailChange(changeId, code) {
  return request(requirePath(emailVerifyEndpoint, 'Email-change verification'), {
    method: 'POST', body: { changeId, code },
  })
}
