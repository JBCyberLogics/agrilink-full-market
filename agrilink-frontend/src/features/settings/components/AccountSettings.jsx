import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Bell, CheckCircle2, Eye, FileUser, Info, KeyRound, LoaderCircle,
  LockKeyhole, Mail, MapPin, RotateCw, Save, Settings2, ShieldCheck, Sprout,
  Trash2, UserRound, X,
} from 'lucide-react'
import { fmtDate } from '../../../utils/format'
import { notifications } from '../../../services/api/endpoints.js'
import {
  changeMyPassword, deleteMyAccount, getMyAccountProfile, updateMyAccountProfile,
} from '../services/accountSettingsService'
import {
  createExtendedProfile, deleteExtendedProfile, isAvatarStorageConfigured,
  isEmailChangeConfigured, isProfilePersistenceConfigured, readExtendedProfile,
  removeProfilePicture, requestEmailChange, updateExtendedProfile, readPrivacyPreferences,
  savePrivacyPreferences, readAccountPreferences, saveAccountPreferences,
  uploadProfilePicture, verifyEmailChange,
} from '../services/profileSettingsService'
import {
  BUYER_PROFILE_FIELDS, FARMER_PROFILE_FIELDS, buildProfilePatch, combineName,
  normalizeProfileFields, splitFullName, validateProfileDraft,
} from '../profileSchema'
import ProfilePictureField from './ProfilePictureField'

const inputClass = 'w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-2.5 text-sm text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20'
const sections = (role) => [
  { id: 'overview', label: 'Overview', icon: FileUser },
  { id: 'personal', label: 'Personal information', icon: UserRound },
  { id: 'role', label: role === 'Farmer' ? 'Farm profile' : 'Buyer profile', icon: role === 'Farmer' ? Sprout : MapPin },
  { id: 'security', label: 'Security', icon: LockKeyhole },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: Eye },
  { id: 'preferences', label: 'Account preferences', icon: Settings2 },
]

function Message({ children, error = false, status = false }) {
  if (!children) return null
  const Icon = error ? AlertCircle : status ? CheckCircle2 : Info
  return <p role={error ? 'alert' : 'status'} aria-live="polite" className={`flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm leading-relaxed ${error ? 'bg-danger-wash text-farmer-danger' : status ? 'bg-farmer-surface text-farmer-success' : 'border border-farmer-line bg-farmer-page/70 text-farmer-muted'}`}><Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{children}</p>
}

function Field({ label, name, value, onChange, type = 'text', placeholder, error, ...props }) {
  const id = `profile-${name}`
  return <label htmlFor={id} className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">{label}</span><input id={id} name={name} type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className={inputClass} {...props} />{error && <span id={`${id}-error`} className="mt-1 block text-xs text-farmer-danger">{error}</span>}</label>
}

function TextAreaField({ label, name, value, onChange, error, rows = 4, placeholder }) {
  const id = `profile-${name}`
  return <label htmlFor={id} className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">{label}</span><textarea id={id} name={name} value={value ?? ''} onChange={onChange} rows={rows} placeholder={placeholder} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className={`${inputClass} resize-y`} />{error && <span id={`${id}-error`} className="mt-1 block text-xs text-farmer-danger">{error}</span>}</label>
}

function IntegrationPanel({ title, description }) {
  return <section className="rounded-2xl border border-dashed border-farmer-line bg-paper p-5 sm:p-7"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><Info size={18} aria-hidden="true" /></span><div><h3 className="font-display text-sm font-bold text-farmer-ink">{title}</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-farmer-muted">{description}</p></div></div></section>
}

export default function AccountSettings({ role, onDeleted, onProfileUpdated }) {
  const [account, setAccount] = useState(null)
  const [draft, setDraft] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [profileExists, setProfileExists] = useState(false)
  const [profileConfigured, setProfileConfigured] = useState(isProfilePersistenceConfigured())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [profileLoadError, setProfileLoadError] = useState('')
  const [activeSection, setActiveSection] = useState('overview')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [removingProfile, setRemovingProfile] = useState(false)

  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [notificationPreferences, setNotificationPreferences] = useState({ messages: true, orders: true })
  const [notificationSnapshot, setNotificationSnapshot] = useState({ messages: true, orders: true })
  const [notificationConfigured, setNotificationConfigured] = useState(false)
  const [notificationDelivery, setNotificationDelivery] = useState({ email: 'unavailable', push: 'unavailable' })
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [notificationSaving, setNotificationSaving] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  const [privacyPreferences, setPrivacyPreferences] = useState({ showSellerName: true, showLocation: true, shareContactInformation: false })
  const [privacySnapshot, setPrivacySnapshot] = useState({ showSellerName: true, showLocation: true, shareContactInformation: false })
  const [privacyLoading, setPrivacyLoading] = useState(false)
  const [privacySaving, setPrivacySaving] = useState(false)
  const [privacyError, setPrivacyError] = useState('')
  const [privacyMessage, setPrivacyMessage] = useState('')
  const [accountPreferences, setAccountPreferences] = useState({ defaultListingUnit: null })
  const [accountPreferencesSnapshot, setAccountPreferencesSnapshot] = useState({ defaultListingUnit: null })
  const [accountPreferencesLoading, setAccountPreferencesLoading] = useState(false)
  const [accountPreferencesSaving, setAccountPreferencesSaving] = useState(false)
  const [accountPreferencesError, setAccountPreferencesError] = useState('')
  const [accountPreferencesMessage, setAccountPreferencesMessage] = useState('')

  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailChangeId, setEmailChangeId] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailMessage, setEmailMessage] = useState('')

  const dirty = !!draft && !!snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot)
  const nameChanged = !!draft && !!snapshot && (draft.firstName !== snapshot.firstName || draft.lastName !== snapshot.lastName)
  const roleSections = sections(role)
  const notificationDirty = JSON.stringify(notificationPreferences) !== JSON.stringify(notificationSnapshot) || !notificationConfigured
  const privacyDirty = JSON.stringify(privacyPreferences) !== JSON.stringify(privacySnapshot)
  const accountPreferencesDirty = JSON.stringify(accountPreferences) !== JSON.stringify(accountPreferencesSnapshot)
  const supplementalChanged = useMemo(() => {
    if (!draft || !snapshot) return false
    return Object.keys(draft).some((key) => !['firstName', 'lastName'].includes(key) && JSON.stringify(draft[key]) !== JSON.stringify(snapshot[key]))
  }, [draft, snapshot])
  const missingRequiredFields = useMemo(() => {
    if (!draft || !profileConfigured || profileLoadError) return []
    const fields = role === 'Farmer'
      ? ['farmName', 'county', 'mainCrops']
      : ['county', 'produceInterests', 'buyerType']
    return fields.filter((key) => Array.isArray(draft[key]) ? !draft[key].length : !String(draft[key] ?? '').trim())
  }, [draft, profileConfigured, profileLoadError, role])

  useEffect(() => {
    if (activeSection !== 'notifications') return undefined
    let alive = true
    setNotificationLoading(true)
    setNotificationError('')
    notifications.preferences()
      .then((result) => {
        if (!alive) return
        const preferences = result?.preferences ?? { messages: true, orders: true }
        setNotificationPreferences(preferences)
        setNotificationSnapshot(preferences)
        setNotificationConfigured(result?.configured === true)
        setNotificationDelivery(result?.delivery ?? { email: 'unavailable', push: 'unavailable' })
      })
      .catch((error) => { if (alive) setNotificationError(error?.error || error?.message || 'Notification preferences are unavailable.') })
      .finally(() => { if (alive) setNotificationLoading(false) })
    return () => { alive = false }
  }, [activeSection])

  useEffect(() => {
    if (activeSection !== 'privacy' || role !== 'Farmer') return undefined
    let alive = true
    setPrivacyLoading(true); setPrivacyError(''); setPrivacyMessage('')
    readPrivacyPreferences().then(({ preferences }) => {
      if (alive) { setPrivacyPreferences(preferences); setPrivacySnapshot(preferences) }
    }).catch((error) => { if (alive) setPrivacyError(error?.error || 'Privacy settings could not be loaded.') })
      .finally(() => { if (alive) setPrivacyLoading(false) })
    return () => { alive = false }
  }, [activeSection, role])

  useEffect(() => {
    if (activeSection !== 'preferences') return undefined
    let alive = true
    setAccountPreferencesLoading(true); setAccountPreferencesError(''); setAccountPreferencesMessage('')
    readAccountPreferences().then(({ preferences }) => {
      if (alive) { const next = { defaultListingUnit: preferences?.defaultListingUnit ?? null }; setAccountPreferences(next); setAccountPreferencesSnapshot(next) }
    }).catch((error) => { if (alive) setAccountPreferencesError(error?.error || 'Account preferences could not be loaded.') })
      .finally(() => { if (alive) setAccountPreferencesLoading(false) })
    return () => { alive = false }
  }, [activeSection])

  async function saveNotificationPreferences(event) {
    event.preventDefault()
    setNotificationSaving(true); setNotificationError(''); setNotificationMessage('')
    try {
      const result = await notifications.updatePreferences(notificationPreferences)
      const preferences = result?.preferences ?? notificationPreferences
      setNotificationPreferences(preferences); setNotificationSnapshot(preferences); setNotificationConfigured(true)
      setNotificationDelivery(result?.delivery ?? { email: 'unavailable', push: 'unavailable' })
      setNotificationMessage('In-app notification preferences were saved to your account.')
    } catch (error) { setNotificationError(error?.error || error?.message || 'Notification preferences could not be saved.') }
    finally { setNotificationSaving(false) }
  }

  async function savePrivacy(event) {
    event.preventDefault(); setPrivacySaving(true); setPrivacyError(''); setPrivacyMessage('')
    try { const saved = await savePrivacyPreferences(privacyPreferences); setPrivacyPreferences(saved); setPrivacySnapshot(saved); setPrivacyMessage('Privacy settings were saved and are enforced on public listing responses.') }
    catch (error) { setPrivacyError(error?.error || 'Privacy settings could not be saved.') }
    finally { setPrivacySaving(false) }
  }

  async function saveAccountPreference(event) {
    event.preventDefault(); setAccountPreferencesSaving(true); setAccountPreferencesError(''); setAccountPreferencesMessage('')
    try {
      const result = await saveAccountPreferences(accountPreferences)
      const saved = { defaultListingUnit: result?.preferences?.defaultListingUnit ?? null }
      setAccountPreferences(saved); setAccountPreferencesSnapshot(saved); setAccountPreferencesMessage('Your default listing unit was saved. New produce forms will use it.')
    } catch (error) { setAccountPreferencesError(error?.error || 'Account preferences could not be saved.') }
    finally { setAccountPreferencesSaving(false) }
  }

  const loadProfile = async () => {
    setLoading(true)
    setLoadError('')
    setProfileLoadError('')
    try {
      const nextAccount = await getMyAccountProfile()
      setAccount(nextAccount)
      let extended = { configured: isProfilePersistenceConfigured(), profile: null }
      try {
        extended = await readExtendedProfile()
      } catch (error) {
        setProfileLoadError(error?.error || error?.message || 'Role-specific profile details could not be loaded.')
      }
      setProfileConfigured(extended.configured)
      setProfileExists(!!extended.profile)
      const base = role === 'Farmer' ? FARMER_PROFILE_FIELDS : BUYER_PROFILE_FIELDS
      const nextDraft = normalizeProfileFields(role, {
        ...base,
        ...(extended.profile ?? {}),
        ...splitFullName(nextAccount.fullName),
        profilePicture: extended.profile?.profilePicture ?? nextAccount.image ?? null,
      })
      setDraft(nextDraft)
      setSnapshot(nextDraft)
    } catch (error) {
      setLoadError(error?.error || error?.message || 'We could not load your account profile.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
    // This is the initial server read; retry is available through the error state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  useEffect(() => {
    if (!dirty) return undefined
    const beforeRouteChange = (event) => {
      if (!window.confirm('You have unsaved profile changes. Leave this page and discard them?')) event.preventDefault()
    }
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('agrilink:before-route-change', beforeRouteChange)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('agrilink:before-route-change', beforeRouteChange)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [dirty])

  const setField = (key) => (event) => {
    const value = event.target.value
    setDraft((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => ({ ...current, [key]: undefined }))
    setSaveError('')
    setSaveMessage('')
  }

  const commitSnapshot = (next) => {
    setDraft(next)
    setSnapshot(next)
    setSaveError('')
    setFieldErrors({})
  }

  const saveProfile = async (event) => {
    event?.preventDefault?.()
    if (!draft || !dirty) return
    const validation = validateProfileDraft(role, draft)
    if (role === 'Farmer' && supplementalChanged && !profileExists) {
      if (!String(draft.farmName ?? '').trim()) validation.farmName = 'Enter your farm name.'
      if (!String(draft.county ?? '').trim()) validation.county = 'Enter your county.'
      if (!Array.isArray(draft.mainCrops) || draft.mainCrops.every((crop) => !String(crop).trim())) validation.mainCrops = 'Add at least one main crop.'
    }
    setFieldErrors(validation)
    if (Object.keys(validation).length) {
      setSaveError('Review the highlighted profile fields.')
      return
    }
    setSaving(true)
    setSaveError('')
    setSaveMessage('')
    try {
      if (supplementalChanged && !profileConfigured) {
        if (nameChanged) {
          const updatedAccount = await updateMyAccountProfile({ fullName: combineName(draft) })
          setAccount(updatedAccount)
          onProfileUpdated?.(updatedAccount)
          setSnapshot((current) => ({ ...current, firstName: draft.firstName, lastName: draft.lastName }))
          setSaveMessage('Your name was accepted by the account service. Other profile fields remain unsaved drafts until profile storage is connected.')
          return
        }
        throw { code: 'INTEGRATION_REQUIRED', error: 'Profile storage is not connected. These changes were not saved.' }
      }
      if (supplementalChanged && profileConfigured && profileLoadError) {
        throw { code: 'PROFILE_READ_FAILED', error: 'The existing profile could not be read, so no create or update request was sent.' }
      }
      if (supplementalChanged && profileConfigured) {
        const payload = buildProfilePatch(role, draft, snapshot)
        if (profileExists) await updateExtendedProfile(payload)
        else await createExtendedProfile(payload)
        setProfileExists(true)
      }
      if (nameChanged) {
        const updatedAccount = await updateMyAccountProfile({ fullName: combineName(draft) })
        setAccount(updatedAccount)
        onProfileUpdated?.(updatedAccount)
      }
      const refreshedAccount = await getMyAccountProfile()
      setAccount(refreshedAccount)
      onProfileUpdated?.(refreshedAccount)
      let refreshedExtended = { profile: null }
      if (profileConfigured && !profileLoadError) refreshedExtended = await readExtendedProfile()
      const nextDraft = normalizeProfileFields(role, {
        ...(refreshedExtended.profile ?? (profileConfigured ? draft : {})),
        ...splitFullName(refreshedAccount.fullName),
        profilePicture: refreshedExtended.profile?.profilePicture ?? refreshedAccount.image ?? draft.profilePicture,
      })
      commitSnapshot(nextDraft)
      setSaveMessage('The server accepted your profile update and the account has been refreshed.')
    } catch (error) {
      const field = String(error?.field ?? '').replace(/^profile\./, '')
      if (field && Object.prototype.hasOwnProperty.call(draft, field)) {
        setFieldErrors((current) => ({ ...current, [field]: error?.error || 'Check this field.' }))
      }
      setSaveError(error?.error || error?.message || 'Your profile could not be saved. No success was reported.')
    } finally {
      setSaving(false)
    }
  }

  const cancelChanges = () => { if (snapshot) commitSnapshot(snapshot); setSaveMessage(''); setSaveError('') }

  const removeOptionalProfile = async () => {
    if (!profileConfigured || removingProfile) return
    if (!window.confirm('Remove optional profile details? Your AgriLink account and login will remain.')) return
    setRemovingProfile(true)
    setSaveError('')
    setSaveMessage('')
    try {
      await deleteExtendedProfile()
      setProfileExists(false)
      const next = normalizeProfileFields(role, { ...splitFullName(account.fullName), profilePicture: account.image ?? null })
      commitSnapshot(next)
      setSaveMessage('Optional profile details were removed by the server. Your account remains active.')
    } catch (error) {
      setSaveError(error?.error || error?.message || 'Optional profile details could not be removed.')
    } finally {
      setRemovingProfile(false)
    }
  }

  const onUploadPicture = async (file, onProgress) => {
    const uploaded = await uploadProfilePicture(file, onProgress)
    const nextAccount = { ...account, image: uploaded.imageUrl }
    const nextDraft = { ...draft, profilePicture: uploaded.imageUrl }
    setAccount(nextAccount)
    setDraft(nextDraft)
    setSnapshot((current) => ({ ...current, profilePicture: uploaded.imageUrl }))
    onProfileUpdated?.({ ...nextAccount, fullName: combineName(draft) })
  }

  const onRemovePicture = async () => {
    await removeProfilePicture()
    const refreshed = await getMyAccountProfile()
    if (refreshed.image) throw { error: 'The server has not confirmed that the profile picture was removed.' }
    const nextDraft = { ...draft, profilePicture: null }
    setAccount(refreshed)
    setDraft(nextDraft)
    setSnapshot((current) => ({ ...current, profilePicture: null }))
    onProfileUpdated?.({ ...refreshed, image: null })
  }

  const startEmailChange = async (event) => {
    event.preventDefault()
    setEmailError('')
    setEmailMessage('')
    const cleanEmail = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setEmailError('Enter a valid email address.')
      return
    }
    if (cleanEmail === account.email?.toLowerCase()) {
      setEmailError('Enter an address different from your current email.')
      return
    }
    setEmailBusy(true)
    try {
      const pending = await requestEmailChange(cleanEmail)
      setEmailChangeId(pending.changeId)
      setEmailMessage(`A verification request was created for ${cleanEmail}. Your account email remains unchanged until the server confirms the code.`)
    } catch (error) {
      setEmailError(error?.error || error?.message || 'The email change request could not be created.')
    } finally {
      setEmailBusy(false)
    }
  }

  const confirmEmailChange = async (event) => {
    event.preventDefault()
    setEmailError('')
    setEmailMessage('')
    if (!emailChangeId || !emailCode.trim()) { setEmailError('Enter the verification code sent by the server.'); return }
    setEmailBusy(true)
    try {
      await verifyEmailChange(emailChangeId, emailCode.trim())
      const refreshed = await getMyAccountProfile()
      if (refreshed.email?.toLowerCase() !== newEmail.trim().toLowerCase()) {
        throw { code: 'EMAIL_NOT_CONFIRMED', error: 'The server has not confirmed the new email yet. Your displayed email remains unchanged.' }
      }
      setAccount(refreshed)
      onProfileUpdated?.(refreshed)
      setEmailChangeId('')
      setEmailCode('')
      setNewEmail('')
      setEmailMessage('The server confirmed the new email address.')
    } catch (error) {
      setEmailError(error?.error || error?.message || 'Email verification could not be completed.')
    } finally {
      setEmailBusy(false)
    }
  }

  const updatePassword = async (event) => {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (passwords.newPassword.length < 6) { setPasswordError('Use at least six characters for the new password.'); return }
    if (passwords.newPassword !== passwords.confirmPassword) { setPasswordError('The new passwords do not match.'); return }
    if (passwords.newPassword === passwords.currentPassword) { setPasswordError('Choose a password different from your current one.'); return }
    setPasswordBusy(true)
    try {
      await changeMyPassword(passwords)
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPasswordMessage('The password endpoint confirmed the change.')
    } catch (error) {
      setPasswordError(error?.error || error?.message || 'The password change was not confirmed by the server.')
    } finally {
      setPasswordBusy(false)
    }
  }

  const removeAccount = async (event) => {
    event.preventDefault()
    setDeleteError('')
    if (!deletePassword) { setDeleteError('Enter your current password to continue.'); return }
    if (!window.confirm('Permanently delete your AgriLink account? This action cannot be undone.')) return
    setDeleting(true)
    try {
      await deleteMyAccount({ password: deletePassword })
      onDeleted?.()
    } catch (error) {
      setDeleteError(error?.error || error?.message || 'The server did not confirm account deletion.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <div className="mx-auto max-w-5xl space-y-4" aria-busy="true" aria-label="Loading profile and settings"><div className="h-40 animate-pulse rounded-2xl border border-farmer-line bg-paper/70" /><div className="h-72 animate-pulse rounded-2xl border border-farmer-line bg-paper/70" /></div>
  if (loadError || !account || !draft) return <div className="rounded-2xl border border-farmer-line bg-paper p-7 text-center"><AlertCircle size={22} aria-hidden="true" className="mx-auto text-farmer-danger" /><p role="alert" className="mt-3 text-sm font-semibold text-farmer-ink">{loadError || 'Your account profile is unavailable.'}</p><button type="button" onClick={loadProfile} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-farmer-primary px-4 text-sm font-semibold text-white"><RotateCw size={15} aria-hidden="true" />Try again</button></div>

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="overflow-hidden rounded-2xl border border-farmer-line bg-paper shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-farmer-surface/60 px-5 py-5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-paper text-farmer-brand">{account.image ? <img src={account.image} alt="" className="h-full w-full object-cover" /> : <UserRound size={21} aria-hidden="true" />}</span>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-farmer-muted">{role} workspace</p><h2 className="truncate font-display text-lg font-bold text-farmer-ink">{account.fullName || 'Complete your account profile'}</h2><p className="truncate text-xs text-farmer-muted">{account.email}</p></div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-xs font-semibold text-farmer-muted"><ShieldCheck size={14} aria-hidden="true" className="text-farmer-success" />Account settings</span>
        </div>

        <div className="grid lg:grid-cols-[230px_minmax(0,1fr)]">
          <nav aria-label="Profile and settings sections" className="flex gap-1 overflow-x-auto border-t border-farmer-line p-2 lg:flex-col lg:overflow-visible lg:border-r lg:border-t-0 lg:p-3">
            {roleSections.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveSection(id)} aria-current={activeSection === id ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-farmer-brand/40 ${activeSection === id ? 'bg-farmer-primary text-white' : 'text-farmer-muted hover:bg-farmer-page hover:text-farmer-ink'}`}><Icon size={15} aria-hidden="true" />{label}</button>)}
          </nav>

          <div className="min-w-0 space-y-4 border-t border-farmer-line p-4 sm:p-6 lg:border-l-0 lg:border-t-0">
            {activeSection === 'overview' && <>
              <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-farmer-brand">Account workspace</p><h3 className="mt-1 font-display text-xl font-bold text-farmer-ink">Profile overview</h3><p className="mt-1 text-sm text-farmer-muted">Review your account record and complete the details relevant to your {role.toLowerCase()} workflow.</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <article className="rounded-2xl border border-farmer-line bg-farmer-page/60 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">Personal details</p><p className="mt-2 text-sm font-semibold text-farmer-ink">{account.fullName || 'Name not set'}</p><p className="mt-1 truncate text-xs text-farmer-muted">{account.email || 'Email unavailable'}</p><button type="button" onClick={() => setActiveSection('personal')} className="mt-4 text-xs font-semibold text-farmer-brand underline underline-offset-2">Edit personal details</button></article>
                <article className="rounded-2xl border border-farmer-line bg-farmer-page/60 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">{role === 'Farmer' ? 'Farm details' : 'Buyer details'}</p>{profileConfigured ? <><p className="mt-2 text-sm font-semibold text-farmer-ink">{missingRequiredFields.length ? `${missingRequiredFields.length} key detail${missingRequiredFields.length === 1 ? '' : 's'} to complete` : 'Profile details available'}</p><p className="mt-1 text-xs text-farmer-muted">{missingRequiredFields.length ? 'Complete the fields marked for your role.' : 'These fields are loaded from the connected profile service.'}</p></> : <><p className="mt-2 text-sm font-semibold text-farmer-ink">Backend connection needed</p><p className="mt-1 text-xs text-farmer-muted">The account API does not expose these role-specific fields yet.</p></>}<button type="button" onClick={() => setActiveSection('role')} className="mt-4 text-xs font-semibold text-farmer-brand underline underline-offset-2">Open {role === 'Farmer' ? 'farm' : 'buyer'} profile</button></article>
                <article className="rounded-2xl border border-farmer-line bg-farmer-page/60 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">Account type</p><p className="mt-2 text-sm font-semibold text-farmer-ink">{role}</p><p className="mt-1 text-xs text-farmer-muted">Member since {fmtDate(account.memberSince)}</p></article>
                <article className="rounded-2xl border border-farmer-line bg-farmer-page/60 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">Profile image</p><p className="mt-2 text-sm font-semibold text-farmer-ink">{account.image ? 'Image returned by account API' : 'No profile image returned'}</p><p className="mt-1 text-xs text-farmer-muted">Image storage is a separate backend integration.</p></article>
              </div>
              {profileLoadError && <Message error>{profileLoadError}</Message>}
              {!profileConfigured && <Message>Extended profile information is not connected. Editing fields is available as a draft, and unsupported changes will not be reported as saved.</Message>}
            </>}

            {activeSection === 'personal' && <form onSubmit={saveProfile} className="space-y-5">
              <div><h3 className="font-display text-lg font-bold text-farmer-ink">Personal information</h3><p className="mt-1 text-sm text-farmer-muted">Your email is read from your account. Names can use the existing account update; contact and location details need profile persistence.</p></div>
              <ProfilePictureField imageUrl={draft.profilePicture || account.image} uploadConfigured={isAvatarStorageConfigured()} removeConfigured={isAvatarStorageConfigured()} onUpload={onUploadPicture} onRemove={onRemovePicture} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" name="firstName" value={draft.firstName} onChange={setField('firstName')} error={fieldErrors.firstName} autoComplete="given-name" />
                <Field label="Last name" name="lastName" value={draft.lastName} onChange={setField('lastName')} error={fieldErrors.lastName} autoComplete="family-name" />
                <Field label="Phone number" name="phoneNumber" value={draft.phoneNumber} onChange={setField('phoneNumber')} error={fieldErrors.phoneNumber} type="tel" autoComplete="tel" placeholder="+254…" />
                <Field label="County" name="county" value={draft.county} onChange={setField('county')} error={fieldErrors.county} autoComplete="address-level1" />
                <Field label="Sub-county" name="subCounty" value={draft.subCounty} onChange={setField('subCounty')} />
                <Field label="Town or location" name="town" value={draft.town} onChange={setField('town')} autoComplete="address-level2" />
              </div>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Email address</span><input type="email" value={account.email ?? ''} readOnly aria-readonly="true" className={`${inputClass} bg-farmer-page`} /><span className="mt-1.5 block text-xs text-farmer-muted">Use Security to request an email change. The displayed email updates only after verification and a fresh server read.</span></label>
              {profileLoadError && <Message error>{profileLoadError}</Message>}
              <SaveRow dirty={dirty} saving={saving} onCancel={cancelChanges} />
              <Message error>{saveError}</Message><Message status>{saveMessage}</Message>
            </form>}

            {activeSection === 'role' && <form onSubmit={saveProfile} className="space-y-5">
              <div><h3 className="font-display text-lg font-bold text-farmer-ink">{role === 'Farmer' ? 'Farm profile' : 'Buyer profile'}</h3><p className="mt-1 text-sm text-farmer-muted">These details describe your {role.toLowerCase()} account. Changes remain drafts until an account-scoped profile endpoint accepts them.</p></div>
              {role === 'Farmer' ? <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Farm name" name="farmName" value={draft.farmName} onChange={setField('farmName')} error={fieldErrors.farmName} />
                <div className="grid grid-cols-[1fr_130px] gap-2"><Field label="Farm size" name="farmSize" value={draft.farmSize} onChange={setField('farmSize')} error={fieldErrors.farmSize} type="number" min="0" step="any" /><label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Unit</span><select value={draft.farmSizeUnit} onChange={setField('farmSizeUnit')} className={inputClass}><option value="acres">Acres</option><option value="hectares">Hectares</option></select></label></div>
                <Field label="Farming experience (years)" name="farmingExperienceYears" value={draft.farmingExperienceYears} onChange={setField('farmingExperienceYears')} error={fieldErrors.farmingExperienceYears} type="number" min="0" step="1" />
                <Field label="Main crops or produce" name="mainCrops" value={(draft.mainCrops ?? []).join(', ')} onChange={(event) => { setDraft((current) => ({ ...current, mainCrops: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })); setFieldErrors((current) => ({ ...current, mainCrops: undefined })) }} error={fieldErrors.mainCrops} placeholder="Separate crops with commas" />
                <div className="sm:col-span-2"><TextAreaField label="About your farm and farming practices" name="about" value={draft.about} onChange={setField('about')} rows={5} placeholder="Share details you want buyers to know." /></div>
              </div> : <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Buyer type</span><select value={draft.buyerType} onChange={(event) => { setDraft((current) => ({ ...current, buyerType: event.target.value, ...(event.target.value === 'individual' ? { organizationName: '', businessDescription: '' } : {}) })); setFieldErrors((current) => ({ ...current, organizationName: undefined })) }} className={inputClass}><option value="individual">Individual</option><option value="business">Business or organization</option></select></label>
                {draft.buyerType === 'business' && <><Field label="Business or organization name" name="organizationName" value={draft.organizationName} onChange={setField('organizationName')} error={fieldErrors.organizationName} /><div className="sm:col-span-2"><TextAreaField label="Business description" name="businessDescription" value={draft.businessDescription} onChange={setField('businessDescription')} rows={4} /></div></>}
                <Field label="Produce interests" name="produceInterests" value={(draft.produceInterests ?? []).join(', ')} onChange={(event) => setDraft((current) => ({ ...current, produceInterests: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} placeholder="Separate produce with commas" />
                <Field label="Preferred sourcing location" name="preferredSourcingLocation" value={draft.preferredSourcingLocation} onChange={setField('preferredSourcingLocation')} placeholder="County, town, or region" />
              </div>}
              {profileLoadError && <Message error>{profileLoadError}</Message>}
              {!profileConfigured && <Message>Profile persistence is not connected. These role-specific values are temporary form drafts and will not be stored or represented as saved.</Message>}
              <SaveRow dirty={dirty} saving={saving} onCancel={cancelChanges} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-farmer-line pt-4"><p className="text-xs text-farmer-muted">Remove optional profile details while keeping the account active.</p><button type="button" disabled={!profileConfigured || removingProfile} onClick={removeOptionalProfile} className="inline-flex h-9 items-center gap-2 rounded-lg border border-danger-line px-3 text-xs font-semibold text-farmer-danger hover:bg-danger-wash disabled:cursor-not-allowed disabled:opacity-50">{removingProfile ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}Remove profile details</button></div>
              <Message error>{saveError}</Message><Message status>{saveMessage}</Message>
            </form>}

            {activeSection === 'security' && <div className="space-y-5">
              <div><h3 className="font-display text-lg font-bold text-farmer-ink">Security and account access</h3><p className="mt-1 text-sm text-farmer-muted">Email and password workflows report changes only after backend confirmation.</p></div>
              <section className="rounded-2xl border border-farmer-line bg-paper p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><Mail size={16} aria-hidden="true" /></span><div><h4 className="text-sm font-bold text-farmer-ink">Change email</h4><p className="mt-1 text-xs leading-relaxed text-farmer-muted">A verified address remains the account email until the backend confirms the new one.</p></div></div><form onSubmit={startEmailChange} className="mt-4 space-y-3"><Field label="Current email" name="currentEmail" value={account.email} onChange={() => {}} disabled readOnly /><Field label="New email address" name="newEmail" type="email" autoComplete="email" value={newEmail} onChange={(event) => { setNewEmail(event.target.value); setEmailError(''); setEmailMessage('') }} placeholder="name@example.com" /><button type="submit" disabled={emailBusy || !isEmailChangeConfigured()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-ink hover:bg-farmer-page disabled:cursor-not-allowed disabled:opacity-50">{emailBusy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}Request email verification</button></form>{emailChangeId && <form onSubmit={confirmEmailChange} className="mt-4 grid gap-3 border-t border-farmer-line pt-4 sm:grid-cols-[1fr_auto]"><Field label="Verification code" name="emailCode" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} autoComplete="one-time-code" /><button type="submit" disabled={emailBusy || !emailCode.trim()} className="self-end inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white disabled:opacity-50">{emailBusy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}Verify and refresh account</button></form>}{!isEmailChangeConfigured() && <p className="mt-3 text-xs text-farmer-muted">Email-change and verification endpoints are not connected. No request has been sent.</p>}<div className="mt-3 space-y-2"><Message error>{emailError}</Message><Message status>{emailMessage}</Message></div></section>

              <section className="rounded-2xl border border-farmer-line bg-paper p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><KeyRound size={16} aria-hidden="true" /></span><div><h4 className="text-sm font-bold text-farmer-ink">Change password</h4><p className="mt-1 text-xs leading-relaxed text-farmer-muted">Password fields are held only while this form is open and sent only to the existing authenticated password endpoint.</p></div></div><form onSubmit={updatePassword} className="mt-4 grid gap-3 sm:grid-cols-3">{[['currentPassword', 'Current password', 'current-password'], ['newPassword', 'New password', 'new-password'], ['confirmPassword', 'Confirm new password', 'new-password']].map(([key, label, autoComplete]) => <Field key={key} label={label} name={key} type="password" autoComplete={autoComplete} minLength={key === 'currentPassword' ? undefined : 6} value={passwords[key]} onChange={(event) => { setPasswords((current) => ({ ...current, [key]: event.target.value })); setPasswordError(''); setPasswordMessage('') }} />)}<div className="space-y-2 sm:col-span-3"><Message error>{passwordError}</Message><Message status>{passwordMessage}</Message></div><div className="flex justify-end sm:col-span-3"><button type="submit" disabled={passwordBusy || !passwords.currentPassword || !passwords.newPassword || !passwords.confirmPassword} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{passwordBusy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />}{passwordBusy ? 'Updating…' : 'Update password'}</button></div></form></section>

              <section className="rounded-2xl border border-danger-line bg-paper p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger-wash text-farmer-danger"><Trash2 size={16} aria-hidden="true" /></span><div><h4 className="text-sm font-bold text-farmer-ink">Delete account</h4><p className="mt-1 text-xs leading-relaxed text-farmer-muted">This is separate from removing profile details. The existing self-delete API must confirm success before the app signs out.</p></div></div>{!deleteOpen ? <button type="button" onClick={() => { setDeleteOpen(true); setDeleteError('') }} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-danger-line px-3 text-xs font-semibold text-farmer-danger hover:bg-danger-wash"><Trash2 size={14} aria-hidden="true" />Delete AgriLink account</button> : <form onSubmit={removeAccount} className="mt-4 space-y-3"><Field label="Current password" name="deletePassword" type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => { setDeletePassword(event.target.value); setDeleteError('') }} /><Message error>{deleteError}</Message><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setDeleteOpen(false); setDeletePassword(''); setDeleteError('') }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-muted"><X size={14} aria-hidden="true" />Cancel</button><button type="submit" disabled={deleting || !deletePassword} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-danger px-3 text-xs font-semibold text-white disabled:opacity-50">{deleting ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}Confirm permanent deletion</button></div></form>}</section>
            </div>}

            {activeSection === 'notifications' && <div className="space-y-4"><div><h3 className="font-display text-lg font-bold text-farmer-ink">Notifications</h3><p className="mt-1 text-sm text-farmer-muted">Choose which in-app alerts AgriLink stores for this account.</p></div>{notificationLoading ? <p role="status" className="rounded-xl border border-farmer-line bg-paper p-4 text-sm text-farmer-muted">Loading saved notification preferences…</p> : <form onSubmit={saveNotificationPreferences} className="space-y-4 rounded-2xl border border-farmer-line bg-paper p-4 sm:p-5"><div className="space-y-3">{[['messages', 'New messages', 'Show in-app alerts when another account messages you.'], ['orders', 'Order updates', 'Show in-app alerts when an order is placed or its delivery status changes.']].map(([key, title, description]) => <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-farmer-line p-3"><input type="checkbox" checked={notificationPreferences[key]} onChange={(event) => setNotificationPreferences((current) => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-farmer-brand" /><span><span className="block text-sm font-semibold text-farmer-ink">{title}</span><span className="mt-0.5 block text-xs leading-relaxed text-farmer-muted">{description}</span></span></label>)}</div>{!notificationConfigured && <p className="text-xs text-farmer-muted">No preference has been saved yet. The current in-app defaults are on; saving will store the choices above.</p>}<p className="text-xs text-farmer-muted">In-app alerts: available · Email: {notificationDelivery.email} · Mobile push: {notificationDelivery.push}</p><div className="flex justify-end"><button type="submit" disabled={notificationSaving || !notificationDirty} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{notificationSaving ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{notificationSaving ? 'Saving…' : 'Save preferences'}</button></div><Message error>{notificationError}</Message><Message status>{notificationMessage}</Message></form>}</div>}
            {activeSection === 'privacy' && <div className="space-y-4"><div><h3 className="font-display text-lg font-bold text-farmer-ink">Privacy</h3><p className="mt-1 text-sm text-farmer-muted">These choices are stored with your farmer profile and applied when the marketplace returns seller information.</p></div>{role !== 'Farmer' ? <IntegrationPanel title="Farmer privacy settings" description="These visibility controls apply to farmer listing profiles. Your buyer account does not have a farm profile." /> : privacyLoading ? <p role="status" className="rounded-xl border border-farmer-line bg-paper p-4 text-sm text-farmer-muted">Loading saved privacy settings…</p> : <form onSubmit={savePrivacy} className="space-y-4 rounded-2xl border border-farmer-line bg-paper p-4 sm:p-5"><div className="space-y-3">{[['showSellerName','Show my name on public listings','When off, public marketplace responses omit your name.'],['showLocation','Show my location on public listings','When off, public marketplace responses omit your town and county.'],['shareContactInformation','Share my contact details with marketplace visitors','When on, public listing responses include your account email and phone if set.']].map(([key,title,description])=><label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-farmer-line p-3"><input type="checkbox" checked={privacyPreferences[key]} onChange={(event)=>setPrivacyPreferences((current)=>({...current,[key]:event.target.checked}))} className="mt-0.5 h-4 w-4 accent-farmer-brand"/><span><span className="block text-sm font-semibold text-farmer-ink">{title}</span><span className="mt-0.5 block text-xs leading-relaxed text-farmer-muted">{description}</span></span></label>)}</div><p className="text-xs text-farmer-muted">Contact details are hidden unless you explicitly enable sharing. Order fulfillment details remain available to the buyer and farmer on that order.</p><div className="flex justify-end"><button type="submit" disabled={privacySaving||!privacyDirty} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white disabled:opacity-50">{privacySaving?<LoaderCircle size={14} className="animate-spin" aria-hidden="true"/>:<Save size={14} aria-hidden="true"/>}{privacySaving?'Saving…':'Save privacy settings'}</button></div><Message error>{privacyError}</Message><Message status>{privacyMessage}</Message></form>}</div>}
            {activeSection === 'preferences' && <div className="space-y-4"><div><h3 className="font-display text-lg font-bold text-farmer-ink">Account preferences</h3><p className="mt-1 text-sm text-farmer-muted">Choose the initial measurement unit used by new produce listings. Your theme preference remains available from the app theme control.</p></div>{accountPreferencesLoading ? <p role="status" className="rounded-xl border border-farmer-line bg-paper p-4 text-sm text-farmer-muted">Loading saved account preferences…</p> : role !== 'Farmer' ? <IntegrationPanel title="No buyer-specific account preference is configured" description="The buyer workflow does not currently expose a saved marketplace default. Notification preferences and theme controls are available in their own sections." /> : <form onSubmit={saveAccountPreference} className="space-y-4 rounded-2xl border border-farmer-line bg-paper p-4 sm:p-5"><label className="block max-w-sm"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Default unit for new produce listings</span><select className={inputClass} value={accountPreferences.defaultListingUnit ?? ''} onChange={(event)=>setAccountPreferences({defaultListingUnit:event.target.value||null})}><option value="">Use the form default</option>{['kg','litre','bunch','tray','crate','bird','head','cob','jar'].map((unit)=><option key={unit} value={unit}>{unit}</option>)}</select></label><p className="text-xs text-farmer-muted">This affects the unit preselected on My Produce. Existing listings are not changed.</p><div className="flex justify-end"><button type="submit" disabled={accountPreferencesSaving||!accountPreferencesDirty} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white disabled:opacity-50">{accountPreferencesSaving?<LoaderCircle size={14} className="animate-spin" aria-hidden="true"/>:<Save size={14} aria-hidden="true"/>}{accountPreferencesSaving?'Saving…':'Save preferences'}</button></div><Message error>{accountPreferencesError}</Message><Message status>{accountPreferencesMessage}</Message></form>}</div>}
          </div>
        </div>
      </section>
      {dirty && <p role="status" className="rounded-xl border border-[#d6b66f]/50 bg-[#f8f1df] px-4 py-3 text-xs font-medium text-[#70551d]">Unsaved profile changes. Save or cancel before leaving; AgriLink will ask before in-app navigation.</p>}
    </div>
  )
}

function SaveRow({ dirty, saving, onCancel }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t border-farmer-line pt-4"><button type="button" disabled={!dirty || saving} onClick={onCancel} className="inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-muted hover:bg-farmer-page disabled:cursor-not-allowed disabled:opacity-50"><X size={14} aria-hidden="true" />Cancel</button><button type="submit" disabled={!dirty || saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white hover:bg-farmer-primary-hover disabled:cursor-not-allowed disabled:opacity-50">{saving ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{saving ? 'Saving…' : 'Save profile'}</button></div>
}
