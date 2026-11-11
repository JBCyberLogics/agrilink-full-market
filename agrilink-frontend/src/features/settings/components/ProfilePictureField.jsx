import { useEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle, Trash2, UploadCloud, UserRound, X } from 'lucide-react'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i

export function validateProfilePicture(file) {
  if (!file) return 'Choose an image file.'
  const hasSupportedExtension = ALLOWED_EXT.test(file.name)
  if (file.type ? !ALLOWED_MIME.has(file.type) : !hasSupportedExtension) return 'Choose a JPG, JPEG, PNG, or WebP image.'
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return 'The image must be larger than zero and no more than 5 MB.'
  return ''
}

export default function ProfilePictureField({ imageUrl, uploadConfigured, removeConfigured, onUpload, onRemove }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return undefined }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const selectFile = (next) => {
    const validationError = validateProfilePicture(next)
    setError(validationError)
    if (validationError) { setFile(null); return }
    setFile(next)
    setProgress(0)
  }

  const upload = async () => {
    if (!file || !uploadConfigured || uploading) return
    setError('')
    setUploading(true)
    try {
      await onUpload(file, setProgress)
      setFile(null)
      setProgress(0)
    } catch (uploadError) {
      setError(uploadError?.error || uploadError?.message || 'The image could not be stored.')
    } finally {
      setUploading(false)
    }
  }

  const clearDraft = () => { setFile(null); setError(''); setProgress(0); if (inputRef.current) inputRef.current.value = '' }
  const removePicture = async () => {
    if (!removeConfigured || removing) return
    if (!window.confirm('Remove your current profile picture?')) return
    setError('')
    setRemoving(true)
    try { await onRemove() }
    catch (removeError) { setError(removeError?.error || removeError?.message || 'The profile picture could not be removed.') }
    finally { setRemoving(false) }
  }
  const handleDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    selectFile(event.dataTransfer.files?.[0])
  }

  return (
    <section className="rounded-2xl border border-farmer-line bg-paper p-5 sm:p-6" aria-labelledby="profile-picture-title">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-farmer-line bg-farmer-surface text-farmer-brand">
          {previewUrl || imageUrl
            ? <img src={previewUrl || imageUrl} alt="Profile preview" className="h-full w-full object-cover" />
            : <UserRound size={28} aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="profile-picture-title" className="text-sm font-bold text-farmer-ink">Profile picture</h3>
          <p className="mt-1 text-xs leading-relaxed text-farmer-muted">JPG, JPEG, PNG, or WebP · maximum 5 MB. A selected image is a temporary local preview until the server confirms storage.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-ink hover:bg-farmer-page"><ImagePlus size={14} aria-hidden="true" />{imageUrl ? 'Replace picture' : 'Choose picture'}</button>
            {file && <>
              <button type="button" disabled={!uploadConfigured || uploading} onClick={upload} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-3 text-xs font-semibold text-white hover:bg-farmer-primary-hover disabled:cursor-not-allowed disabled:opacity-50">
                {uploading ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <UploadCloud size={14} aria-hidden="true" />}
                {uploading ? `Uploading ${progress}%` : 'Upload picture'}
              </button>
              <button type="button" disabled={uploading} onClick={clearDraft} className="inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-muted hover:bg-farmer-page disabled:opacity-50"><X size={14} aria-hidden="true" />Cancel preview</button>
            </>}
            {imageUrl && !file && <button type="button" disabled={!removeConfigured || uploading || removing} onClick={removePicture} className="inline-flex h-9 items-center gap-2 rounded-lg border border-danger-line px-3 text-xs font-semibold text-farmer-danger hover:bg-danger-wash disabled:cursor-not-allowed disabled:opacity-50">{removing ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}{removing ? 'Removing…' : 'Remove'}</button>}
          </div>
        </div>
      </div>

      <div onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className={`mt-4 rounded-xl border border-dashed px-4 py-5 text-center text-xs text-farmer-muted transition-colors ${dragging ? 'border-farmer-brand bg-farmer-surface' : 'border-farmer-line bg-farmer-page/60'}`}>
        Drop an image here, or <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-farmer-brand underline underline-offset-2">browse files</button>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="sr-only" onChange={(event) => selectFile(event.target.files?.[0])} aria-label="Choose profile picture" />
      {uploading && <div className="mt-3" role="progressbar" aria-label="Uploading profile picture" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><div className="h-2 overflow-hidden rounded-full bg-farmer-surface"><div className="h-full rounded-full bg-farmer-primary transition-[width]" style={{ width: `${progress}%` }} /></div></div>}
      {file && <p className="mt-2 text-xs text-farmer-muted" role="status">Preview only: {file.name}. This image has not been uploaded.</p>}
      {!uploadConfigured && <p className="mt-2 text-xs text-farmer-muted">Image storage is not connected. You can preview a file, but permanent upload is unavailable.</p>}
      {imageUrl && !removeConfigured && <p className="mt-2 text-xs text-farmer-muted">The current picture can be removed after the profile-picture endpoint is configured.</p>}
      {error && <p className="mt-3 text-sm text-farmer-danger" role="alert">{error}</p>}
    </section>
  )
}
