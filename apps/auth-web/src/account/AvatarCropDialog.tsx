import { avatarLimits } from '@velin/contracts/policy'
import { acceptedAvatarTypes, cropAvatar } from '@velin/ui/avatar.ts'
import { Modal } from '@velin/ui/Modal.tsx'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Camera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Area } from 'react-easy-crop'

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

    if (!acceptedAvatarTypes.some((type) => type === file.type)) {
      setError('请选择 PNG、JPEG 或 WebP 格式的图片。')
      return
    }

    if (file.size > avatarLimits.sourceBytes) {
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

    return cropAvatar(imageFile, area, avatarLimits.outputSize)
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

  // 写成两条比较而不是 Boolean(...)：TypeScript 只有这样才能在分支里收窄出非空的 imageUrl。
  const isCropStage = imageUrl !== null && imageFile !== null

  return (
    <Modal
      label={isCropStage ? '调整头像' : '更换头像'}
      onClose={onClose}
      focusKey={isCropStage ? 'crop' : 'pick'}
    >
      <div className="web-modal-scrim" onPointerDown={onClose}>
        <div
          className={`web-modal avatar-dialog${isCropStage ? ' is-crop' : ''}`}
          aria-label={isCropStage ? '调整头像' : '更换头像'}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <h2 className="web-modal-title">
            {isCropStage ? '调整头像' : '更换头像'}
          </h2>

          {/* 两阶段共用同一副骨架：标题 → 正文 → 提示行 → 操作行；
            正文不锁高度，选图到裁剪之间隔着系统文件面板，不是看得见的一次换步。 */}
          {isCropStage ? (
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
              <p className="avatar-step-hint">
                拖动图片调整位置，使用滑杆缩放。
              </p>
              <div className="avatar-zoom-row">
                <span className="avatar-zoom-label">缩放</span>
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
              </div>
              <button
                className="text-button avatar-repick-button"
                type="button"
                onClick={pickFile}
              >
                重新选择图片
              </button>
            </div>
          ) : (
            <div className="avatar-pick-body">
              {/* 头像本身是快捷入口，底部「选择图片」是显式入口，两者走同一个 pickFile。
                  这里不写 title：原生提示会在切到裁剪阶段后继续悬浮在弹窗左上角。 */}
              <button
                className="account-avatar-button is-large"
                type="button"
                aria-label="选择头像图片"
                onClick={pickFile}
              >
                <span className="account-avatar-lg" aria-hidden="true">
                  {currentImage ? <img src={currentImage} alt="" /> : initial}
                  <span className="account-avatar-hint">
                    <Camera aria-hidden="true" />
                  </span>
                </span>
              </button>
              <p className="avatar-step-hint">
                选择一张图片作为你的头像，之后可以调整显示区域。
                <br />
                支持 PNG、JPEG 或 WebP，8MB 以内。
              </p>
            </div>
          )}

          <p className="auth-field-hint" role={error ? 'alert' : undefined}>
            {error ?? ''}
          </p>

          <div className="web-modal-actions">
            <button
              className="security-action is-outline"
              type="button"
              onClick={onClose}
            >
              取消
            </button>
            {isCropStage ? (
              <button
                className="security-action is-primary"
                type="button"
                disabled={isUploading}
                onClick={() => void confirmUpload()}
              >
                {isUploading ? '上传中…' : '保存'}
              </button>
            ) : (
              <button
                className="security-action is-primary"
                type="button"
                onClick={pickFile}
              >
                选择图片
              </button>
            )}
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
    </Modal>
  )
}
