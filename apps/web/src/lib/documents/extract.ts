import { attachmentLimits } from '@velin/contracts/attachments'
import type { SupportedFileType } from 'officeparser'
import { normalizeDocumentText } from '../chat/text'
import { validateArchive } from './archive'
import { truncateText } from '@velin/contracts/policy'

function decodeText(bytes: Uint8Array) {
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (decoded.includes('\u0000')) {
    throw new Error('文件内容不是可读取的文本。')
  }

  const normalized = decoded.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    throw new Error('文件没有可读取的文本内容。')
  }

  const replacementCount = (normalized.match(/\uFFFD/g) ?? []).length
  if (replacementCount > Math.max(8, normalized.length * 0.02)) {
    throw new Error('文件内容不是可读取的文本。')
  }

  return normalized.length > attachmentLimits.characters
    ? `${truncateText(normalized, attachmentLimits.characters)}\n\n[内容过长，已截断]`
    : normalized
}

function hasBytes(bytes: Uint8Array, offset: number, values: number[]) {
  if (bytes.length < offset + values.length) return false
  return values.every((value, index) => bytes[offset + index] === value)
}

const xlsxMimeType =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function extractXlsxText(bytes: Uint8Array) {
  if (!hasBytes(bytes, 0, [0x50, 0x4b, 0x03, 0x04])) {
    throw new Error('Excel 文件格式无效。')
  }

  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    )
  } catch {
    throw new Error('无法读取该 Excel 文件，文件可能已加密或损坏。')
  }

  const sheetLimit = Math.min(
    workbook.worksheets.length,
    attachmentLimits.xlsxSheets,
  )
  const lines: string[] = []
  let length = 0
  let truncated = false

  const addLine = (line: string) => {
    if (length + line.length + 1 > attachmentLimits.characters) {
      truncated = true
      return false
    }
    lines.push(line)
    length += line.length + 1
    return true
  }

  for (let sheetIndex = 0; sheetIndex < sheetLimit; sheetIndex += 1) {
    const sheet = workbook.worksheets[sheetIndex]
    const header = `## ${sheet.name}`
    if (!addLine(header)) break

    const rowLimit = Math.min(sheet.rowCount, attachmentLimits.xlsxRows)
    const columnLimit = Math.min(
      sheet.columnCount,
      attachmentLimits.xlsxColumns,
    )
    if (sheet.columnCount > columnLimit) truncated = true

    for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
      const cells: string[] = []
      let hasValue = false
      for (let column = 1; column <= columnLimit; column += 1) {
        const text = truncateText(
          sheet
            .getCell(rowNumber, column)
            .text.replace(/[\t\r\n]+/g, ' ')
            .trim(),
          attachmentLimits.xlsxCellCharacters,
        )
        if (text) hasValue = true
        cells.push(text)
      }
      if (!hasValue) continue
      if (!addLine(cells.join('\t'))) break
    }

    if (sheet.rowCount > rowLimit || sheet.columnCount > columnLimit) {
      truncated = true
      addLine(`[工作表 ${sheet.name} 内容已截断]`)
    }
  }

  if (workbook.worksheets.length > sheetLimit) {
    truncated = true
    addLine('[工作表数量过多，已截断]')
  }

  const normalized = normalizeDocumentText(lines.join('\n'))
  if (!normalized) {
    throw new Error('Excel 文件没有可读取的文本内容。')
  }
  return truncated ? `${normalized}\n\n[Excel 内容已截断]` : normalized
}

const officeFileTypes: Partial<Record<string, SupportedFileType>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.graphics': 'odg',
  'application/rtf': 'rtf',
  'application/epub+zip': 'epub',
  'application/x-tex': 'tex',
}

async function extractOfficeDocumentText(
  fileType: SupportedFileType,
  bytes: Uint8Array,
) {
  const { parseOffice } = await import('officeparser')
  let value: string
  try {
    const ast = await parseOffice(Buffer.from(bytes), {
      fileType,
      extractAttachments: false,
      ocr: false,
      allowRemoteAssets: false,
    })
    value = (await ast.to('text')).value
  } catch {
    throw new Error('无法读取该文档，文件可能已加密或损坏。')
  }

  const normalized = normalizeDocumentText(value)
  if (!normalized) {
    throw new Error('文档没有可读取的文本内容。')
  }
  return normalized.length > attachmentLimits.characters
    ? `${truncateText(normalized, attachmentLimits.characters)}\n\n[文档内容已截断]`
    : normalized
}

export async function extractAttachmentText(
  mimeType: string,
  bytes: Uint8Array,
) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) await validateArchive(bytes)
  if (mimeType === xlsxMimeType) return extractXlsxText(bytes)
  const officeFileType = officeFileTypes[mimeType]
  if (officeFileType) return extractOfficeDocumentText(officeFileType, bytes)
  return decodeText(bytes)
}
