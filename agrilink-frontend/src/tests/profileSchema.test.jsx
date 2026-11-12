import { describe, expect, it } from 'vitest'
import { buildProfilePatch } from '../features/settings/profileSchema.js'

describe('profile PATCH payload', () => {
  it('sends changed editable role fields only and converts optional numeric blanks to null', () => {
    const draft = {
      firstName: 'Amina', lastName: 'Otieno', phoneNumber: '', county: 'Kiambu',
      farmName: 'N/A', farmSize: '', farmSizeUnit: 'acres', farmingExperienceYears: '',
      mainCrops: ['Maize'], about: '', profilePicture: 'https://example.test/image.png',
      _id: 'never-sent', user: 'never-sent', createdAt: 'never-sent', status: 'never-sent',
    }
    const snapshot = { ...draft, farmSize: 3, farmingExperienceYears: 4, county: 'Nakuru' }

    expect(buildProfilePatch('Farmer', draft, snapshot)).toEqual({
      county: 'Kiambu', farmSize: null, farmingExperienceYears: null,
    })
  })

  it('does not send unchanged fields or protected account identity fields', () => {
    const draft = { firstName: 'Farmer', lastName: 'Name', phoneNumber: '', county: '', subCounty: '', town: '', farmName: '', farmSize: '', farmSizeUnit: 'acres', farmingExperienceYears: '', mainCrops: [], about: '', profilePicture: null, role: 'admin', permissions: ['all'] }
    expect(buildProfilePatch('Farmer', draft, { ...draft })).toEqual({})
  })
})
