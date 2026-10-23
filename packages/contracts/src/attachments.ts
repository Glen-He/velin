export const attachmentLimits = {
  maxFiles: 5,
  maxImages: 4,
  maxPromptImages: 4,
  promptImageBytes: 20 * 1024 * 1024,
  imagePixels: 20_000_000,
  imageDimension: 8_192,
  archiveBytes: 64 * 1024 * 1024,
  archiveEntryBytes: 16 * 1024 * 1024,
  archiveEntries: 5_000,
  processingTimeoutMs: 60_000,
  fileBytes: 20 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  requestBytes: 21 * 1024 * 1024,
  characters: 100_000,
  pdfPages: 300,
  pdfOcrPages: 300,
  xlsxSheets: 20,
  xlsxRows: 1_000,
  xlsxColumns: 50,
  xlsxCellCharacters: 1_000,
  thumbnailCharacters: 1_000_000,
} as const

const documentTypes = [
  { mimeType: 'application/pdf', extensions: ['pdf'] },
  {
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
  },
  {
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
  },
  {
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['pptx'],
  },
  {
    mimeType: 'application/vnd.oasis.opendocument.text',
    extensions: ['odt'],
  },
  {
    mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
    extensions: ['ods'],
  },
  {
    mimeType: 'application/vnd.oasis.opendocument.presentation',
    extensions: ['odp'],
  },
  {
    mimeType: 'application/vnd.oasis.opendocument.graphics',
    extensions: ['odg'],
  },
  { mimeType: 'application/rtf', extensions: ['rtf'] },
  { mimeType: 'application/epub+zip', extensions: ['epub'] },
  { mimeType: 'application/x-tex', extensions: ['tex', 'ltx'] },
  { mimeType: 'text/plain', extensions: ['txt', 'log'] },
  { mimeType: 'text/markdown', extensions: ['md', 'markdown'] },
  { mimeType: 'application/json', extensions: ['json'] },
  { mimeType: 'text/csv', extensions: ['csv'] },
  { mimeType: 'text/typescript', extensions: ['ts', 'tsx'] },
  { mimeType: 'text/javascript', extensions: ['js', 'jsx'] },
  { mimeType: 'text/css', extensions: ['css'] },
  { mimeType: 'text/html', extensions: ['html', 'htm'] },
  { mimeType: 'application/xml', extensions: ['xml'] },
  { mimeType: 'application/yaml', extensions: ['yaml', 'yml'] },
  { mimeType: 'application/toml', extensions: ['toml'] },
  { mimeType: 'text/x-python', extensions: ['py'] },
  { mimeType: 'text/x-go', extensions: ['go'] },
  { mimeType: 'text/x-rust', extensions: ['rs'] },
  { mimeType: 'text/x-java', extensions: ['java'] },
  { mimeType: 'text/x-c', extensions: ['c', 'h'] },
  { mimeType: 'text/x-c++', extensions: ['cpp', 'cc', 'hpp'] },
  { mimeType: 'text/x-sh', extensions: ['sh', 'bash', 'zsh'] },
  { mimeType: 'text/x-sql', extensions: ['sql'] },
] as const

const imageTypes = [
  { mimeType: 'image/png', extensions: ['png'] },
  { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  { mimeType: 'image/webp', extensions: ['webp'] },
] as const

export const attachmentExtensions: readonly string[] = documentTypes.flatMap(
  (type) => type.extensions,
)

export const imageExtensions: readonly string[] = imageTypes.flatMap(
  (type) => type.extensions,
)

export type MessageAttachmentKind = 'file' | 'image'

export type MessageAttachmentStatus =
  | 'processing'
  | 'ready'
  | 'failed'
  | 'canceled'

export type MessageAttachmentProgress = {
  completed: number
  total: number
}

export type MessageAttachment = {
  id: string
  kind: MessageAttachmentKind
  name: string
  mimeType: string
  sizeBytes: number
  status: MessageAttachmentStatus
  thumbnail?: string
  pageCount?: number
  ocrPageRange?: string
  ocrError?: string
  progress?: MessageAttachmentProgress
}

export type OcrPageRangeParseResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: 'format' | 'limit' }

export function parseOcrPageRange(
  value: string,
): OcrPageRangeParseResult | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > 120) return { ok: false, error: 'format' }

  const pages = new Set<number>()
  const parts = normalized
    .replace(/[，、]/g, ',')
    .replace(/[–—−]/g, '-')
    .split(',')
  for (const rawPart of parts) {
    const part = rawPart.trim()
    const match = /^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/.exec(part)
    if (!match) return { ok: false, error: 'format' }
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < 1
    ) {
      return { ok: false, error: 'format' }
    }
    const from = Math.min(start, end)
    const to = Math.max(start, end)
    for (let page = from; page <= to; page += 1) {
      pages.add(page)
      if (pages.size > attachmentLimits.pdfOcrPages) {
        return { ok: false, error: 'limit' }
      }
    }
  }
  return { ok: true, pages: [...pages].sort((left, right) => left - right) }
}

export function formatOcrPageRange(pages: number[]) {
  const sorted = [...new Set(pages)].sort((left, right) => left - right)
  const parts: string[] = []
  for (let index = 0; index < sorted.length; ) {
    let end = index
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) {
      end += 1
    }
    parts.push(
      index === end ? String(sorted[index]) : `${sorted[index]}-${sorted[end]}`,
    )
    index = end + 1
  }
  return parts.join(',')
}

function attachmentExtension(name: string) {
  const separator = name.lastIndexOf('.')
  return separator > 0 ? name.slice(separator + 1).toLowerCase() : ''
}

export function attachmentMimeType(name: string): string | null {
  const extension = attachmentExtension(name)
  if (!extension) return null
  return (
    [...documentTypes, ...imageTypes].find((type) =>
      type.extensions.some((value) => value === extension),
    )?.mimeType ?? null
  )
}

export function isImageMimeType(mimeType: string) {
  return imageTypes.some((type) => type.mimeType === mimeType)
}

export function isImageAttachmentName(name: string) {
  return isImageMimeType(attachmentMimeType(name) ?? '')
}

export function isSupportedAttachmentName(name: string) {
  return attachmentMimeType(name) !== null
}
