'use client'

import { ActionGroup, Button } from './Button'
import { Camera } from 'lucide-react'
import type { ReactNode } from 'react'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Modal } from './Modal'
import { useAvatarCrop } from './useAvatarCrop'
import './confirmation-dialog.css'
import './avatar-dialog.css'

// 视图和反馈共用，调用方提供当前头像与所属运行环境的上传边界。
export function AvatarDialog({
  preview,
  onUpload,
  onClose,
}: {
  preview: ReactNode
  onUpload: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>
  onClose: () => void
}) {
  const {
    imageUrl,
    imageFile,
    crop,
    setCrop,
    zoom,
    setZoom,
    error,
    isUploading,
    fileInputRef,
    pickFile,
    handleFileChange,
    setArea,
    confirmUpload,
    canUpload,
  } = useAvatarCrop(onUpload, onClose)
  const isCropStage = imageUrl !== null && imageFile !== null
  const title = isCropStage ? '调整头像' : '更换头像'
  return (
    <Modal
      label={title}
      onClose={onClose}
      focusKey={isCropStage ? 'crop' : 'pick'}
    >
      <div className="confirmation-scrim" onPointerDown={onClose}>
        <section
          className="confirmation-card avatar-task"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <h2 className="confirmation-title">{title}</h2>
          {isCropStage ? (
            <div className="avatar-task-crop-body">
              <div className="avatar-task-crop-area">
                <Cropper
                  image={imageUrl}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, area) => setArea(area)}
                />
              </div>
              <label className="avatar-task-zoom">
                <input
                  className="avatar-task-slider"
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  disabled={isUploading}
                  aria-label="缩放头像"
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <button
                className="text-action"
                type="button"
                disabled={isUploading}
                onClick={pickFile}
              >
                重新选择图片
              </button>
            </div>
          ) : (
            <div className="avatar-task-pick-body">
              <button
                className="avatar-task-avatar-button"
                type="button"
                aria-label="选择头像图片"
                onClick={pickFile}
              >
                <span className="avatar-task-preview" aria-hidden="true">
                  {preview}
                  <span className="avatar-task-camera">
                    <Camera aria-hidden="true" />
                  </span>
                </span>
              </button>
              <p className="avatar-task-hint">
                选择一张图片作为你的头像，之后可以调整显示区域。
                <br />
                支持 PNG、JPEG 或 WebP，8MB 以内。
              </p>
            </div>
          )}
          <p
            className="confirmation-feedback"
            role={error ? 'alert' : undefined}
          >
            {error ?? ''}
          </p>
          <ActionGroup className="confirmation-actions">
            <Button variant="outline" type="button" onClick={onClose}>
              取消
            </Button>
            {isCropStage ? (
              <Button
                variant="primary"
                sizeLabel="保存"
                type="button"
                disabled={!canUpload}
                onClick={() => void confirmUpload()}
              >
                {isUploading ? '上传中…' : '保存'}
              </Button>
            ) : (
              <Button variant="primary" type="button" onClick={pickFile}>
                选择图片
              </Button>
            )}
          </ActionGroup>
          <input
            ref={fileInputRef}
            className="avatar-task-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleFileChange}
          />
        </section>
      </div>
    </Modal>
  )
}
