import { useEffect, useRef } from 'react'
import QRCodeStyling from 'qr-code-styling'

// 苹果式二维码：圆角码点 + 圆角定位角 + 圆点中心，静区由外层卡片的内边距提供。
export function TotpQRCode({ value, size }: { value: string; size: number }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    const ink = getComputedStyle(host).getPropertyValue('--color-ink').trim()
    const code = new QRCodeStyling({
      width: size,
      height: size,
      type: 'svg',
      data: value,
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { color: ink, type: 'rounded' },
      cornersSquareOptions: { color: ink, type: 'extra-rounded' },
      cornersDotOptions: { color: ink, type: 'dot' },
    })

    host.replaceChildren()
    code.append(host)

    // 库把每格边长向下取整，剩下的零头居中摊派，码点四周凭空多出十像素。
    // 只有直接子元素是画布坐标（点阵在 defs 的 mask 里，坐标不能混用），
    // 而三个定位角永远贴着码的最外侧，用它们推出码的真实范围再收 viewBox。
    const svg = host.querySelector('svg')

    if (svg) {
      const marks = Array.from(svg.children).filter(
        (child): child is SVGRectElement =>
          child.tagName === 'rect' &&
          Number((child as SVGRectElement).getAttribute('width')) < size - 1,
      )

      if (marks.length > 0) {
        const boxes = marks.map((mark) => {
          const x = Number(mark.getAttribute('x'))
          const y = Number(mark.getAttribute('y'))
          const width = Number(mark.getAttribute('width'))

          return { x, y, right: x + width, bottom: y + width }
        })

        const origin = Math.min(...boxes.map((box) => Math.min(box.x, box.y)))
        const extent = Math.max(
          ...boxes.map((box) => Math.max(box.right, box.bottom)),
        )

        svg.setAttribute(
          'viewBox',
          `${origin} ${origin} ${extent - origin} ${extent - origin}`,
        )
        svg.setAttribute('width', `${size}`)
        svg.setAttribute('height', `${size}`)
      }
    }

    return () => {
      host.replaceChildren()
    }
  }, [value, size])

  return <div ref={hostRef} />
}
