import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Camera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Area } from 'react-easy-crop'
import type { AuthUser } from '../../shared/auth-protocol'
import { CardDialog } from '../settings/CardDialog'
import { UserAvatar } from './UserAvatar'

const maxSourceBytes = 8 * 1024 * 1024
const avatarOutputSize = 256
const acceptedImageTypes = ['image/png', 'image/jpeg', 'image/webp']

// 头像更换分两步：先选文件预览，再进入圆形裁剪视图；
// 输出为服务端约定的 256px JPEG，上传走 Main 进程持有的会话。
export function AvatarDialog({
  authUser,
  onUpload,
  onClose,
}: {
  authUser: AuthUser
  onUpload: (image: Uint8Array) => Promise<void>
  onClose: () => void
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
      await onUpload(bytes)
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
    <CardDialog title="更换头像" onClose={onClose}>
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
          <label className="avatar-zoom-row">
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
          </label>
          <button className="avatar-repick-button" type="button" onClick={pickFile}>
            重新选择图片
          </button>
        </div>
      ) : (
        <div className="avatar-pick-body">
          <button
            className="settings-avatar-button"
            type="button"
            aria-label="选择图片"
            title="选择图片"
            onClick={pickFile}
          >
            <UserAvatar user={authUser} className="avatar-preview">
              <span className="settings-avatar-hint" aria-hidden="true">
                <Camera />
              </span>
            </UserAvatar>
          </button>
          <p className="avatar-pick-hint">
            点击头像选择一张图片，裁剪为圆形。
            <br />
            支持 PNG、JPEG 或 WebP，8MB 以内。
          </p>
        </div>
      )}

      <p className="card-dialog-feedback" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>

      <div className="card-dialog-actions">
        <button
          className="settings-action-button is-secondary is-narrow"
          type="button"
          onClick={onClose}
        >
          取消
        </button>
        {imageUrl ? (
          <button
            className="settings-action-button is-narrow"
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
    </CardDialog>
  )
}
