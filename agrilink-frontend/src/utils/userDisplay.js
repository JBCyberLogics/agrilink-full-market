const clean = (value) => (typeof value === 'string' ? value.trim() : '')

function nameFrom(record) {
  const direct = clean(record?.name) || clean(record?.fullName) || clean(record?.displayName)
  if (direct) return direct

  const first = clean(record?.firstName ?? record?.first_name)
  const last = clean(record?.lastName ?? record?.last_name)
  return [first, last].filter(Boolean).join(' ')
}

export function getUserDisplayName(user) {
  const profile = user?.profile
  return nameFrom(user) || nameFrom(profile) || clean(user?.email) || 'Account'
}

export function getUserFirstName(user) {
  const profile = user?.profile
  const name = nameFrom(user) || nameFrom(profile)
  return name && name !== 'Account' ? name.split(/\s+/)[0] : ''
}

export function getUserInitials(user) {
  const name = getUserDisplayName(user)
  const parts = name.split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A'
}
