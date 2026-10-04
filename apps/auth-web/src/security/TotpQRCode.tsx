import { useEffect, useRef } from 'react'
import QRCodeStyling from 'qr-code-styling'

// 二维码保持黑码白底；两种主题都可扫描，静区由外层卡片提供。
export function TotpQRCode({ value, size }: { value: string; size: number }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    const code = new QRCodeStyling({
      width: size,
      height: size,
      type: 'svg',
      data: value,
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { color: '#000000', type: 'rounded', roundSize: false },
      cornersSquareOptions: { color: '#000000', type: 'extra-rounded' },
      cornersDotOptions: { color: '#000000', type: 'dot' },
      backgroundOptions: { color: '#ffffff' },
    })

    host.replaceChildren()
    code.append(host)

    return () => {
      host.replaceChildren()
    }
  }, [value, size])

  return <div ref={hostRef} />
}
