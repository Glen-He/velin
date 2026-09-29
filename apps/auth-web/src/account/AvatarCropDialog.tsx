import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Camera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Area } from 'react-easy-crop'

const maxSourceBytes = 8 * 1024 * 1024
const avatarOutputSize = 256
const acceptedImageTypes = ['image/png', 'image/jpeg', 'image/webp']

// 网页端头像更换：选图 → 圆形裁剪 → 256px JPEG 上传到认证服务。
// 服务端存的地址为绝对路径，展示时统一转相对路径走同源。
export function AvatarCropDialog({
  currentImage,
  initial,
  onClose,
  onUploaded,
}: {
  currentImage: string | null
  initial: string
  onClose: () => void
  onUploaded: () => void
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const croppedAreaRef = useRef<Area | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [imageUrl])

  function pickFile() {
    fileInputRef.current?.click()
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!acceptedImageTypes.includes(file.type)) {
      setError('请选择 PNG、JPEG 或 WebP 格式的图片。')
      return
    }

    if (file.size > maxSourceBytes) {
      setError('图片太大，请选择 8MB 以内的图片。')
      return
    }

    setError(null)
    setImageFile(file)
    setImageUrl(URL.createObjectURL(file))
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  async function createAvatarBytes() {
    const area = croppedAreaRef.current

    if (!imageUrl || !imageFile || !area) {
      throw new Error('请先调整裁剪区域。')
    }

    const bitmap = await createImageBitmap(imageFile)
    const canvas = document.createElement('canvas')
    canvas.width = avatarOutputSize
    canvas.height = avatarOutputSize
    const context = canvas.getContext('2d')

    if (!context) {
      bitmap.close()
      throw new Error('头像处理失败，请重试。')
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      avatarOutputSize,
      avatarOutputSize,
    )
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )

    if (!blob) {
      throw new Error('头像处理失败，请重试。')
    }

    return new Uint8Array(await blob.arrayBuffer())
  }

  async function confirmUpload() {
    if (isUploading) {
      return
    }

    setIsUploading(true)
    setError(null)
    try {
      const bytes = await createAvatarBytes()
      const response = await fetch('/api/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: bytes as unknown as BodyInit,
      })

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        const message =
          typeof body === 'object' &&
          body !== null &&
          'message' in body &&
          typeof (body as { message: unknown }).message === 'string'
            ? (body as { message: string }).message
            : '上传头像失败，请稍后重试。'
        throw new Error(
          response.status === 401 ? '登录状态已过期，请重新登录。' : message,
        )
      }

      onUploaded()
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : '上传头像失败，请稍后重试。',
      )
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="web-modal-scrim" onPointerDown={onClose}>
      <div
        className="web-modal"
        role="dialog"
        aria-modal="true"
        aria-label="更换头像"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="web-modal-title">更换头像</h2>

        {imageUrl && imageFile ? (
          <div className="avatar-crop-body">
            <div className="avatar-crop-area">
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, croppedAreaPixels) => {
                  croppedAreaRef.current = croppedAreaPixels
                }}
              />
            </div>
            <input
              className="avatar-zoom-slider"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              aria-label="缩放头像"
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <button
              className="avatar-repick-button"
              type="button"
              onClick={pickFile}
            >
              重新选择图片
            </button>
          </div>
        ) : (
          <div className="avatar-pick-body">
            <button
              className="account-avatar-button is-large"
              type="button"
              aria-label="选择图片"
              title="选择图片"
              onClick={pickFile}
            >
              <span className="account-avatar-lg" aria-hidden="true">
                {currentImage ? (
                  <img src={currentImage} alt="" />
                ) : (
                  initial
                )}
                <span className="account-avatar-hint">
                  <Camera aria-hidden="true" />
                </span>
              </span>
            </button>
            <p className="avatar-pick-hint">
              点击头像选择一张图片，裁剪为圆形。
              <br />
              支持 PNG、JPEG 或 WebP，8MB 以内。
            </p>
          </div>
        )}

        <p className="auth-field-hint" role={error ? 'alert' : undefined}>
          {error ?? ''}
        </p>

        <div className="web-modal-actions">
          <button className="security-action is-secondary is-narrow" type="button" onClick={onClose}>
            取消
          </button>
          {imageUrl ? (
            <button
              className="security-action is-primary is-narrow"
              type="button"
              disabled={isUploading}
              onClick={() => void confirmUpload()}
            >
              {isUploading ? '上传中…' : '确认'}
            </button>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          className="avatar-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFileChange}
        />
      </div>
    </div>
  )
}
