import sharp from 'sharp'

function buildPdf(image: Buffer, pageCount: number) {
  const pageObjectStart = 5
  const maxObject = pageObjectStart + pageCount - 1
  const chunks: Buffer[] = []
  const offsets: number[] = []
  let length = 0

  const write = (value: string | Buffer) => {
    const buffer =
      typeof value === 'string' ? Buffer.from(value, 'utf8') : value
    chunks.push(buffer)
    length += buffer.length
  }
  const start = (id: number) => {
    offsets[id] = length
    write(`${id} 0 obj\n`)
  }
  const end = () => write('endobj\n')

  write('%PDF-1.4\n%Velin load fixture\n')
  start(1)
  write('<< /Type /Catalog /Pages 2 0 R >>\n')
  end()
  start(2)
  write(
    `<< /Type /Pages /Kids [${Array.from(
      { length: pageCount },
      (_, index) => `${pageObjectStart + index} 0 R`,
    ).join(' ')}] /Count ${pageCount} >>\n`,
  )
  end()
  const content = 'q\n525 0 0 700 43.5 46 cm\n/Im0 Do\nQ\n'
  start(3)
  write(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n`)
  write(content)
  write('endstream\n')
  end()
  start(4)
  write(
    `<< /Type /XObject /Subtype /Image /Width 700 /Height 900 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
  )
  write(image)
  write('\nendstream\n')
  end()

  for (let index = 0; index < pageCount; index += 1) {
    start(pageObjectStart + index)
    write(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 3 0 R >>\n',
    )
    end()
  }

  const xrefOffset = length
  write(`xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`)
  for (let id = 1; id <= maxObject; id += 1) {
    write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  }
  write(
    `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )
  return Buffer.concat(chunks)
}

export async function createScannedPdf(pageCount: number) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="700" height="900">
      <rect width="700" height="900" fill="#ffffff" />
      <text x="60" y="150" font-family="sans-serif" font-size="44" fill="#111111">Velin OCR load test</text>
      <text x="60" y="250" font-family="sans-serif" font-size="28" fill="#111111">Revenue grew steadily this quarter.</text>
      <text x="60" y="310" font-family="sans-serif" font-size="28" fill="#111111">Costs fell across every region.</text>
      <text x="60" y="370" font-family="sans-serif" font-size="28" fill="#111111">Gross margin improved by eight points.</text>
      <text x="60" y="460" font-family="sans-serif" font-size="24" fill="#111111">This page is intentionally scanned.</text>
    </svg>
  `
  const image = await sharp(Buffer.from(svg))
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer()
  return buildPdf(image, pageCount)
}
