import { errorMessage } from '@velin/contracts/error-copy'
import { AvatarDialog } from '@velin/ui/AvatarDialog.tsx'

async function uploadAvatar(bytes: Uint8Array<ArrayBuffer>) {
  const response = await fetch('/api/avatars', {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: bytes,
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new Error(
      response.status === 401
        ? '登录状态已过期，请重新登录。'
        : errorMessage(body, '上传头像失败，请稍后重试。'),
    )
  }
}

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
  return (
    <AvatarDialog
      preview={currentImage ? <img src={currentImage} alt="" /> : initial}
      onClose={onClose}
      onUpload={async (bytes) => {
        await uploadAvatar(bytes)
        onUploaded()
      }}
    />
  )
}
