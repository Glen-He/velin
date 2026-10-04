import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { avatarLimits } from '@velin/contracts/policy'
import { errorMessage } from '@velin/contracts/error-copy'
import { acceptedAvatarTypes, cropAvatar } from './avatar'
import type { CropArea } from './avatar'

// 两端共用选图与上传生命周期；调用方只提供各自的网络边界和成功动作。
export function useAvatarCrop(
  upload: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>,
  onComplete: () => void,
) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<CropArea | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const preview = useRef<string | null>(null)
  const active = useRef(true)
  const busy = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      if (preview.current) URL.revokeObjectURL(preview.current)
      preview.current = null
    }
  }, [])
  function pickFile() {
    if (!busy.current) fileInputRef.current?.click()
  }
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy.current || !active.current) return
    if (!acceptedAvatarTypes.some((type) => type === file.type)) {
      setError('请选择 PNG、JPEG 或 WebP 格式的图片。')
      return
    }
    if (file.size > avatarLimits.sourceBytes) {
      setError('图片太大，请选择 8MB 以内的图片。')
      return
    }
    if (preview.current) URL.revokeObjectURL(preview.current)
    preview.current = URL.createObjectURL(file)
    setImageUrl(preview.current)
    setImageFile(file)
    setArea(null)
    setError(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }
  async function confirmUpload() {
    if (busy.current || !active.current) return
    if (!imageFile || !area) {
      setError('请先调整裁剪区域。')
      return
    }
    busy.current = true
    setIsUploading(true)
    setError(null)
    try {
      const bytes = await cropAvatar(imageFile, area, avatarLimits.outputSize)
      if (!active.current) return
      await upload(bytes)
      if (active.current) onComplete()
    } catch (cause) {
      if (active.current)
        setError(errorMessage(cause, '上传头像失败，请稍后重试。'))
    } finally {
      busy.current = false
      if (active.current) setIsUploading(false)
    }
  }
  return {
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
    canUpload: area !== null && !isUploading,
  }
}
