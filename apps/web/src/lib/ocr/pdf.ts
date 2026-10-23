import 'server-only'

import { attachmentLimits } from '@velin/contracts/attachments'
import { truncateText } from '@velin/contracts/policy'
import { access, copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { meaningfulCharacterCount, normalizeDocumentText } from '../chat/text'

export const pdfOcrEngineVersion = 'tesseract-7-layout-v2'
export const pdfOcrBudgetMs = 60 * 60_000
const pdfOcrPageTimeoutMs = 60_000
const pdfTextPageMinimumCharacters = 12
const pdfOcrLowConfidence = 65
const ocrLanguageDataDir = join(tmpdir(), 'velin-tessdata')
const require = createRequire(import.meta.url)

export class PdfOcrInputError extends Error {}
export class PdfOcrTimeoutError extends Error {}

type PdfPageNode = {
  type?: string
  text?: string
  children?: Array<{
    type?: string
    metadata?: { attachmentName?: string }
    bounds?: { x?: number; y?: number; width?: number; height?: number }
  }>
  metadata?: {
    pageNumber?: number
    pageWidth?: number
    pageHeight?: number
  }
}

type OcrWord = {
  text?: string
  bbox?: { x0?: number; x1?: number; y0?: number }
}

type OcrLine = {
  bbox?: { y0?: number }
  words?: OcrWord[]
}

type OcrPageData = {
  text?: string
  confidence?: number
  blocks?: Array<{
    paragraphs?: Array<{ lines?: OcrLine[] }>
  }> | null
}

export type PdfOcrPageResult = {
  text: string
  confidence?: number
}

export type PdfPagePlan = {
  pageNumber: number
  type: 'text' | 'ocr' | 'outside' | 'empty'
  text: string
}

export type PdfPlan = {
  pageCount: number
  pages: PdfPagePlan[]
  requestedPages: number[]
  outsideRangePages: number[]
  ocrPageNumbers: number[]
  processablePageCount: number
}

type OcrWorker = {
  setParameters(parameters: Record<string, string>): Promise<unknown>
  recognize(
    image: Buffer,
    options: { rotateAuto: boolean },
    output: { text: boolean; blocks: boolean },
  ): Promise<{ data: OcrPageData }>
  terminate(): Promise<unknown>
}

export function hasPdfHeader(bytes: Uint8Array) {
  const header = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, 1024),
  )
  return header.includes('%PDF-')
}

function pdfPageNodes(ast: { content?: unknown }): PdfPageNode[] {
  if (!Array.isArray(ast.content)) return []
  return (ast.content as PdfPageNode[])
    .filter(
      (node) =>
        node.type === 'page' && typeof node.metadata?.pageNumber === 'number',
    )
    .sort(
      (left, right) =>
        (left.metadata?.pageNumber ?? 0) - (right.metadata?.pageNumber ?? 0),
    )
}

function formatPageRanges(pages: number[], separator = '、', dash = '–') {
  const sorted = [...new Set(pages)].sort((left, right) => left - right)
  const parts: string[] = []
  for (let index = 0; index < sorted.length; ) {
    let end = index
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) {
      end += 1
    }
    parts.push(
      index === end
        ? String(sorted[index])
        : `${sorted[index]}${dash}${sorted[end]}`,
    )
    index = end + 1
  }
  return parts.join(separator)
}

function formatLowConfidencePages(
  pages: Array<{ pageNumber: number; confidence?: number }>,
) {
  const shown = pages
    .slice(0, 6)
    .map((page) => `${page.pageNumber}（${Math.round(page.confidence ?? 0)}%）`)
  return shown.join('、') + (pages.length > 6 ? ` 等 ${pages.length} 页` : '')
}

function selectPdfPageImages(
  page: PdfPageNode,
  dataByName: Map<string, string>,
) {
  const images: Array<{
    buffer: Buffer
    area: number
    x: number
    y: number
  }> = []

  for (const child of page.children ?? []) {
    if (child.type !== 'image') continue
    const name = child.metadata?.attachmentName
    if (!name) continue
    const data = dataByName.get(name)
    if (!data) continue
    const buffer = Buffer.from(data, 'base64')
    if (buffer.length === 0) continue
    images.push({
      buffer,
      area:
        Math.max(0, child.bounds?.width ?? 0) *
        Math.max(0, child.bounds?.height ?? 0),
      x: child.bounds?.x ?? 0,
      y: child.bounds?.y ?? 0,
    })
  }

  if (images.length === 0) return []
  images.sort(
    (left, right) =>
      right.area - left.area || right.buffer.length - left.buffer.length,
  )

  const pageArea =
    (page.metadata?.pageWidth ?? 0) * (page.metadata?.pageHeight ?? 0)
  const largest = images[0]
  if (!largest) return []
  const largestRatio =
    pageArea > 0 && largest.area > 0 ? largest.area / pageArea : 1
  if (largestRatio < 0.1) return []
  if (images.length === 1 || largestRatio >= 0.5) return [largest.buffer]

  const totalArea = images.reduce((sum, image) => sum + image.area, 0)
  if (pageArea > 0 && totalArea / pageArea >= 0.5) {
    // 整页扫描可能被拆成多块图片，按位置拼回阅读顺序。
    return images
      .filter((image) => image.area / pageArea >= 0.05)
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((image) => image.buffer)
  }
  return [largest.buffer]
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function layoutOcrText(data: OcrPageData) {
  const flat = typeof data.text === 'string' ? data.text : ''
  if (!Array.isArray(data.blocks) || data.blocks.length === 0) return flat

  const lines: Array<{
    words: Array<{ text: string; x0: number; x1: number }>
    y0: number
  }> = []
  for (const block of data.blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words: Array<{ text: string; x0: number; x1: number }> = []
        for (const word of line.words ?? []) {
          const text = (word.text ?? '').trim()
          if (!text) continue
          words.push({
            text,
            x0: word.bbox?.x0 ?? 0,
            x1: word.bbox?.x1 ?? 0,
          })
        }
        if (words.length > 0) {
          lines.push({
            words,
            y0: line.bbox?.y0 ?? line.words?.[0]?.bbox?.y0 ?? 0,
          })
        }
      }
    }
  }
  if (lines.length === 0) return flat

  const glyphWidths: number[] = []
  for (const line of lines) {
    for (const word of line.words) {
      if (word.text.length > 0) {
        glyphWidths.push((word.x1 - word.x0) / word.text.length)
      }
    }
  }
  const characterWidth = median(glyphWidths.filter((value) => value > 0)) || 8

  let minX = Infinity
  for (const line of lines) {
    for (const word of line.words) minX = Math.min(minX, word.x0)
  }
  if (!Number.isFinite(minX)) minX = 0

  lines.sort((left, right) => left.y0 - right.y0)
  const pitches: number[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const current = lines[index]
    const previous = lines[index - 1]
    if (current && previous) pitches.push(current.y0 - previous.y0)
  }
  const linePitch =
    median(pitches.filter((value) => value > characterWidth)) ||
    median(pitches.filter((value) => value > 0)) ||
    characterWidth * 2
  const rowBand = 0.4 * linePitch

  const rows: Array<{
    words: Array<{ text: string; x0: number; x1: number }>
    y0: number
  }> = []
  for (const line of lines) {
    const last = rows[rows.length - 1]
    if (last && line.y0 - last.y0 <= rowBand) {
      last.words.push(...line.words)
    } else {
      rows.push({ words: [...line.words], y0: line.y0 })
    }
  }

  const output: string[] = []
  let previousY: number | null = null
  for (const row of rows) {
    if (previousY !== null && row.y0 - previousY > 1.8 * linePitch) {
      output.push('')
    }
    previousY = row.y0

    let text = ''
    let column = 0
    const words = [...row.words].sort((left, right) => left.x0 - right.x0)
    for (const word of words) {
      const target = Math.min(
        1000,
        Math.max(column, Math.round((word.x0 - minX) / characterWidth)),
      )
      if (text.length === 0) {
        if (target >= 3) {
          text += ' '.repeat(target)
          column = target
        }
      } else if (target - column >= 3) {
        // 只有明显大于词间距的横向间隙才作为分栏/缩进保留。
        text += ' '.repeat(target - column)
        column = target
      } else if (!text.endsWith(' ')) {
        text += ' '
        column += 1
      }
      text += word.text
      column += word.text.length
    }
    output.push(text.trimEnd())
  }
  return output.join('\n')
}

function marginKey(line: string) {
  return line
    .normalize('NFKC')
    .replace(/\d+/g, '#')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
}

export function stripRepeatedOcrMargins(
  results: Map<number, PdfOcrPageResult>,
) {
  if (results.size < 3) return

  const pages = [...results.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageNumber, result]) => {
      const lines = result.text.split('\n')
      const nonEmpty = lines
        .map((line, index) => ({ line, index, trimmed: line.trim() }))
        .filter((line) => line.trimmed.length > 0)
      // 只处理首行/末行的重复页眉页脚，避免误删靠近页边的表格数据行。
      const margin = new Set(
        [...nonEmpty.slice(0, 1), ...nonEmpty.slice(-1)].map(
          (line) => line.index,
        ),
      )
      const keys = new Set(
        [...margin]
          .filter((index) => !/\S {3,}\S/u.test(lines[index] ?? ''))
          .map((index) => marginKey(lines[index] ?? ''))
          .filter((key) => key.length >= 1 && key.length <= 80),
      )
      return { pageNumber, result, lines, margin, keys }
    })

  const threshold = Math.max(3, Math.ceil(pages.length * 0.6))
  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const key of page.keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const repeated = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([key]) => key),
  )
  if (repeated.size === 0) return

  for (const page of pages) {
    const text = normalizeDocumentText(
      page.lines
        .filter(
          (line, index) =>
            !(page.margin.has(index) && repeated.has(marginKey(line))),
        )
        .join('\n'),
    )
    if (text) results.set(page.pageNumber, { ...page.result, text })
  }
}

async function preparePdfPageImage(bytes: Buffer) {
  const sharp = (await import('sharp')).default
  const image = sharp(bytes, {
    failOn: 'error',
    limitInputPixels: attachmentLimits.imagePixels,
  })
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width <= 0 || height <= 0) {
    throw new Error('OCR image dimensions are unavailable.')
  }

  let pipeline = image
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .normalize()
  if (width < 1800) {
    // 按图像宽度放大较小扫描，不据此推断页面的实际 DPI。
    pipeline = pipeline.resize({
      width: Math.min(3000, Math.round(width * 2)),
      kernel: 'lanczos3',
    })
  } else if (width > 5000) {
    pipeline = pipeline.resize({ width: 5000, kernel: 'lanczos3' })
  }
  return pipeline.sharpen({ sigma: 1 }).png().toBuffer()
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), milliseconds)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function ocrLanguageSource(code: 'eng' | 'chi_sim') {
  const packageName = `@tesseract.js-data/${code}`
  try {
    // 使用明确的包入口，避免构建器把动态目录下的训练文件当作 JavaScript 模块。
    const data = (
      code === 'eng'
        ? require('@tesseract.js-data/eng')
        : require('@tesseract.js-data/chi_sim')
    ) as { langPath?: string }
    if (data.langPath) return join(data.langPath, `${code}.traineddata.gz`)
  } catch {
    // 打包后回退到应用目录下的依赖路径。
  }
  return join(
    process.cwd(),
    'node_modules',
    packageName,
    '4.0.0',
    `${code}.traineddata.gz`,
  )
}

function officeParserPdfWorkerSrc() {
  try {
    const officeParserRequire = createRequire(require.resolve('officeparser'))
    return pathToFileURL(
      officeParserRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href
  } catch {
    return undefined
  }
}

function ocrWorkerPath() {
  // Next 会把 require.resolve 改写成打包模块 ID，worker_threads 只接受真实文件路径。
  return join(
    process.cwd(),
    'node_modules',
    'tesseract.js',
    'src',
    'worker-script',
    'node',
    'index.js',
  )
}

async function ensureOcrLanguageData() {
  await mkdir(ocrLanguageDataDir, { recursive: true })
  for (const code of ['eng', 'chi_sim'] as const) {
    const target = join(ocrLanguageDataDir, `${code}.traineddata.gz`)
    try {
      await access(target)
      continue
    } catch {
      // 首次 OCR 时准备本地语言数据。
    }
    try {
      await copyFile(ocrLanguageSource(code), target)
    } catch (error) {
      throw new Error('OCR language data could not be prepared.', {
        cause: error,
      })
    }
  }
  return ocrLanguageDataDir
}

async function parsePdf(
  bytes: Uint8Array,
  options: {
    extractAttachments: boolean
    pageRange?: string
  },
) {
  const { parseOffice } = await import('officeparser')
  const pdfWorkerSrc = officeParserPdfWorkerSrc()
  return parseOffice(Buffer.from(bytes), {
    fileType: 'pdf',
    ocr: false,
    extractAttachments: options.extractAttachments,
    allowRemoteAssets: false,
    ignoreHeadersAndFooters: true,
    pdfParserConfig: {
      ...(options.pageRange ? { pageRange: options.pageRange } : {}),
      spaceToleranceFactor: 0.6,
    },
    ...(pdfWorkerSrc ? { pdfWorkerSrc } : {}),
  })
}

export async function analyzePdf(
  bytes: Uint8Array,
  requestedPages?: number[],
): Promise<PdfPlan> {
  if (!hasPdfHeader(bytes)) {
    throw new PdfOcrInputError('PDF 文件格式无效。')
  }

  // 先读目录页数，再做逐页内容解析；此路径也运行在可终止的受限进程内。
  const { getDocument, GlobalWorkerOptions } = await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  )
  const workerSource = officeParserPdfWorkerSrc()
  if (workerSource) GlobalWorkerOptions.workerSrc = workerSource
  const documentTask = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: false,
    stopAtErrors: true,
  })
  try {
    const document = await documentTask.promise
    if (document.numPages > attachmentLimits.pdfPages) {
      throw new PdfOcrInputError(
        `PDF 页数过多，最多支持 ${attachmentLimits.pdfPages} 页。`,
      )
    }
  } catch (error) {
    if (error instanceof PdfOcrInputError) throw error
    throw new PdfOcrInputError('无法读取该 PDF，可能已加密或格式无效。')
  } finally {
    await documentTask.destroy()
  }

  let textAst: Awaited<ReturnType<typeof parsePdf>>
  try {
    textAst = await parsePdf(bytes, { extractAttachments: false })
  } catch {
    throw new PdfOcrInputError('无法读取该 PDF，可能已加密或格式无效。')
  }

  const pageNodes = pdfPageNodes(textAst)
  const pageCount = Math.max(
    typeof textAst.metadata?.pages === 'number' ? textAst.metadata.pages : 0,
    pageNodes.length,
  )
  if (pageCount === 0) {
    throw new PdfOcrInputError('PDF 没有可读取的页面。')
  }
  if (pageCount > attachmentLimits.pdfPages) {
    throw new PdfOcrInputError(
      `PDF 页数过多，最多支持 ${attachmentLimits.pdfPages} 页。`,
    )
  }
  if (requestedPages?.some((page) => page > pageCount)) {
    throw new PdfOcrInputError(`OCR 页码超出 PDF 范围（共 ${pageCount} 页）。`)
  }

  const pages = pageNodes.map((page) => ({
    pageNumber: page.metadata?.pageNumber ?? 0,
    text: normalizeDocumentText(page.text ?? ''),
  }))
  const candidates = pages.filter(
    (page) =>
      meaningfulCharacterCount(page.text) < pdfTextPageMinimumCharacters,
  )
  const selectedPages = requestedPages ? new Set(requestedPages) : null
  const ocrCandidates = selectedPages
    ? candidates.filter((page) => selectedPages.has(page.pageNumber))
    : candidates.slice(0, attachmentLimits.pdfOcrPages)
  const outsideRangePages = selectedPages
    ? candidates
        .filter((page) => !selectedPages.has(page.pageNumber))
        .map((page) => page.pageNumber)
    : []
  const ocrPageNumbers = new Set(ocrCandidates.map((page) => page.pageNumber))
  const outsideSet = new Set(outsideRangePages)

  const planPages: PdfPagePlan[] = pages.map((page) => {
    if (ocrPageNumbers.has(page.pageNumber)) {
      return {
        pageNumber: page.pageNumber,
        type: 'ocr',
        text: page.text,
      }
    }
    if (outsideSet.has(page.pageNumber)) {
      return {
        pageNumber: page.pageNumber,
        type: 'outside',
        text: page.text,
      }
    }
    return {
      pageNumber: page.pageNumber,
      type: page.text ? 'text' : 'empty',
      text: page.text,
    }
  })

  const processablePageCount = planPages.filter(
    (page) => page.type !== 'outside',
  ).length
  if (planPages.every((page) => page.type === 'empty')) {
    throw new PdfOcrInputError('PDF 没有可读取的文本内容。')
  }

  return {
    pageCount,
    pages: planPages,
    requestedPages: requestedPages ?? [],
    outsideRangePages,
    ocrPageNumbers: ocrCandidates.map((page) => page.pageNumber),
    processablePageCount,
  }
}

export async function extractPdfPageImages(
  bytes: Uint8Array,
  pageNumbers: number[],
) {
  const images = new Map<number, Buffer[]>()
  if (pageNumbers.length === 0) return images

  let imageAst: Awaited<ReturnType<typeof parsePdf>>
  try {
    imageAst = await parsePdf(bytes, {
      extractAttachments: true,
      pageRange: formatPageRanges(pageNumbers, ',', '-'),
    })
  } catch {
    throw new PdfOcrInputError('无法读取 PDF 页面内容。')
  }

  const dataByName = new Map<string, string>()
  for (const attachment of imageAst.attachments ?? []) {
    if (attachment.name && typeof attachment.data === 'string') {
      dataByName.set(attachment.name, attachment.data)
    }
  }
  for (const page of pdfPageNodes(imageAst)) {
    const pageNumber = page.metadata?.pageNumber ?? 0
    const pageImages = selectPdfPageImages(page, dataByName)
    if (pageImages.length > 0) images.set(pageNumber, pageImages)
  }
  return images
}

export class PdfOcrSession {
  private worker: OcrWorker | null = null
  private readonly langPath: string

  private constructor(langPath: string) {
    this.langPath = langPath
  }

  static async create() {
    const langPath = await ensureOcrLanguageData()
    const session = new PdfOcrSession(langPath)
    await session.openWorker()
    return session
  }

  private async openWorker() {
    const { createWorker } = await import('tesseract.js')
    const worker = (await createWorker('eng+chi_sim', undefined, {
      langPath: this.langPath,
      workerPath: ocrWorkerPath(),
      cacheMethod: 'none',
      gzip: true,
    })) as unknown as OcrWorker
    try {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      })
      this.worker = worker
    } catch (error) {
      await worker.terminate().catch(() => {})
      throw error
    }
  }

  async recognize(images: Buffer[]): Promise<PdfOcrPageResult> {
    const worker = this.worker
    if (!worker) throw new Error('OCR worker is not ready.')

    const chunks: string[] = []
    const confidences: number[] = []
    for (const image of images) {
      const prepared = await preparePdfPageImage(image)
      const recognized = await withTimeout(
        worker.recognize(
          prepared,
          { rotateAuto: true },
          { text: true, blocks: true },
        ),
        pdfOcrPageTimeoutMs,
      )
      if (!recognized) throw new PdfOcrTimeoutError('OCR page timed out.')
      const text = normalizeDocumentText(layoutOcrText(recognized.data))
      if (text) {
        chunks.push(text)
        if (typeof recognized.data.confidence === 'number') {
          confidences.push(recognized.data.confidence)
        }
      }
    }

    const text = normalizeDocumentText(chunks.join('\n\n'))
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const confidence =
      totalLength > 0 && confidences.length === chunks.length
        ? chunks.reduce(
            (sum, chunk, chunkIndex) =>
              sum + (confidences[chunkIndex] ?? 0) * chunk.length,
            0,
          ) / totalLength
        : undefined
    return {
      text,
      ...(confidence !== undefined ? { confidence } : {}),
    }
  }

  async reset() {
    await this.terminate()
    await this.openWorker()
  }

  async terminate() {
    const worker = this.worker
    this.worker = null
    if (worker) await worker.terminate().catch(() => {})
  }
}

export function assemblePdfText(input: {
  plan: PdfPlan
  results: Map<number, PdfOcrPageResult>
  failures: number[]
  canceled?: boolean
  completedPages?: number
}) {
  const pageResults: Array<{
    pageNumber: number
    text: string
    source: 'text' | 'ocr'
    confidence?: number
  }> = []

  for (const page of input.plan.pages) {
    if (page.type === 'outside' || page.type === 'empty') continue
    if (page.type === 'text') {
      if (page.text) {
        pageResults.push({
          pageNumber: page.pageNumber,
          text: page.text,
          source: 'text',
        })
      }
      continue
    }

    const result = input.results.get(page.pageNumber)
    if (
      result &&
      meaningfulCharacterCount(result.text) >
        meaningfulCharacterCount(page.text)
    ) {
      pageResults.push({
        pageNumber: page.pageNumber,
        text: result.text,
        source: 'ocr',
        ...(result.confidence !== undefined
          ? { confidence: result.confidence }
          : {}),
      })
      continue
    }
    if (page.text) {
      pageResults.push({
        pageNumber: page.pageNumber,
        text: page.text,
        source: 'text',
      })
    } else if (input.failures.includes(page.pageNumber)) {
      pageResults.push({
        pageNumber: page.pageNumber,
        text: '[本页 OCR 未能识别出文本]',
        source: 'text',
      })
    }
  }

  const ocrPages = pageResults.filter((page) => page.source === 'ocr')
  const lowConfidencePages = ocrPages.filter(
    (page) => (page.confidence ?? 100) < pdfOcrLowConfidence,
  )
  const failures = [...new Set(input.failures)]
    .filter((pageNumber) => !input.results.has(pageNumber))
    .sort((left, right) => left - right)
  const requestedPages = [...new Set(input.plan.requestedPages)].sort(
    (left, right) => left - right,
  )
  const outsideRangePages = [...new Set(input.plan.outsideRangePages)].sort(
    (left, right) => left - right,
  )

  const headerParts: string[] = []
  if (
    ocrPages.length > 0 ||
    failures.length > 0 ||
    requestedPages.length > 0 ||
    outsideRangePages.length > 0 ||
    input.canceled
  ) {
    headerParts.push(`PDF 共 ${input.plan.pageCount} 页`)
    if (requestedPages.length > 0) {
      headerParts.push(`所选 OCR 页码 ${formatPageRanges(requestedPages)}`)
    }
    const textPages = pageResults
      .filter((page) => page.source === 'text')
      .map((page) => page.pageNumber)
    if (textPages.length > 0) {
      headerParts.push(`文本页 ${formatPageRanges(textPages)}`)
    }
    if (ocrPages.length > 0) {
      headerParts.push(
        `OCR 页 ${formatPageRanges(ocrPages.map((page) => page.pageNumber))}`,
      )
    }
    if (lowConfidencePages.length > 0) {
      headerParts.push(
        `低置信度 OCR 页 ${formatLowConfidencePages(lowConfidencePages)}`,
      )
    }
    if (failures.length > 0) {
      headerParts.push(`第 ${formatPageRanges(failures)} 页 OCR 失败`)
    }
    if (outsideRangePages.length > 0) {
      headerParts.push(
        `第 ${formatPageRanges(outsideRangePages)} 页为扫描页，不在所选 OCR 页码内`,
      )
    }
    if (
      requestedPages.length > 0 &&
      ocrPages.length === 0 &&
      failures.length === 0 &&
      !input.canceled
    ) {
      headerParts.push('所选页码没有需要 OCR 的页面')
    }
    if (input.canceled) {
      headerParts.push(
        `识别已取消（已完成 ${input.completedPages ?? 0}/${input.plan.processablePageCount} 页）`,
      )
    }
  }

  const chunks: string[] = []
  if (headerParts.length > 0) chunks.push(`[${headerParts.join('；')}]`)
  for (const page of pageResults) {
    if (input.plan.pageCount > 1) {
      const confidenceNote =
        page.source === 'ocr' &&
        page.confidence !== undefined &&
        page.confidence < pdfOcrLowConfidence
          ? `，置信度 ${Math.round(page.confidence)}%`
          : ''
      chunks.push(
        `[第 ${page.pageNumber} 页${page.source === 'ocr' ? `｜OCR${confidenceNote}` : ''}]\n${page.text}`,
      )
    } else {
      chunks.push(page.text)
    }
  }
  return normalizeDocumentText(chunks.join('\n\n'))
}

export function capPdfText(text: string, pageCount: number) {
  return text.length > attachmentLimits.characters
    ? `${truncateText(text, attachmentLimits.characters)}\n\n[PDF 共 ${pageCount} 页，内容已截断]`
    : text
}
