export type CropArea = { x: number; y: number; width: number; height: number }
export const acceptedAvatarTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export async function cropAvatar(
  file: File,
  area: CropArea,
  size: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('头像处理失败，请重试。')
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
      size,
      size,
    )
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (!blob) throw new Error('头像处理失败，请重试。')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
