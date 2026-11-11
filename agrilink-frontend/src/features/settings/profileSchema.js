export const FARMER_PROFILE_FIELDS = Object.freeze({
  firstName: '', lastName: '', phoneNumber: '', county: '', subCounty: '', town: '',
  farmName: '', farmSize: '', farmSizeUnit: 'acres', farmingExperienceYears: '',
  mainCrops: [], about: '', profilePicture: null,
})

export const BUYER_PROFILE_FIELDS = Object.freeze({
  firstName: '', lastName: '', phoneNumber: '', county: '', subCounty: '', town: '',
  buyerType: 'individual', organizationName: '', businessDescription: '',
  produceInterests: [], preferredSourcingLocation: '', profilePicture: null,
})

export const splitFullName = (fullName = '') => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean)
  return { firstName: parts.shift() ?? '', lastName: parts.join(' ') }
}

export const combineName = ({ firstName = '', lastName = '' }) =>
  [firstName, lastName].map((part) => String(part).trim()).filter(Boolean).join(' ')

export function normalizeProfileFields(role, value = {}) {
  const defaults = role === 'Farmer' ? FARMER_PROFILE_FIELDS : BUYER_PROFILE_FIELDS
  const fields = { ...defaults, ...(value && typeof value === 'object' ? value : {}) }
  if (role === 'Buyer' && fields.buyerType !== 'business') {
    fields.buyerType = 'individual'
    fields.organizationName = ''
    fields.businessDescription = ''
  }
  for (const key of ['mainCrops', 'produceInterests']) {
    if (fields[key] != null && !Array.isArray(fields[key])) fields[key] = String(fields[key]).split(',').map((entry) => entry.trim()).filter(Boolean)
    fields[key] ??= []
  }
  return fields
}

export function validateProfileDraft(role, draft) {
  const errors = {}
  const fullName = combineName(draft)
  if (!draft.firstName.trim()) errors.firstName = 'Enter your first name.'
  if (!draft.lastName.trim()) errors.lastName = 'Enter your last name.'
  if (fullName.length > 120) errors.firstName = 'Your name must be 120 characters or fewer.'
  if (draft.phoneNumber && !/^\+?[0-9 ()-]{7,20}$/.test(draft.phoneNumber.trim())) errors.phoneNumber = 'Enter a valid phone number.'
  if (role === 'Farmer' && draft.farmSize !== '' && (!Number.isFinite(Number(draft.farmSize)) || Number(draft.farmSize) < 0)) errors.farmSize = 'Enter a non-negative farm size.'
  if (role === 'Farmer' && draft.farmingExperienceYears !== '' && (!Number.isInteger(Number(draft.farmingExperienceYears)) || Number(draft.farmingExperienceYears) < 0)) errors.farmingExperienceYears = 'Enter a whole number of years.'
  if (role === 'Buyer' && draft.buyerType === 'business' && !draft.organizationName.trim()) errors.organizationName = 'Enter the business or organization name.'
  return errors
}
