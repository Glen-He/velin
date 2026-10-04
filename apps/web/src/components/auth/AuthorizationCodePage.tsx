import { Button } from '@velin/ui/Button.tsx'
import { useEffect, useState } from 'react'

export function AuthorizationCodePage({
  code,
  isManualFlow,
}: {
  code: string
  isManualFlow: boolean
}) {
  const [isCopied, setIsCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  useEffect(() => {
    if (!isCopied) {
      return
    }

    // 与消息复制反馈一致：保留 1600ms（--motion-duration-copied）后恢复。
    const timer = window.setTimeout(() => setIsCopied(false), 1600)

    return () => window.clearTimeout(timer)
  }, [isCopied])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-shell auth-code-result">
        <div className="auth-wordmark">Velin</div>
        <h1>一次性授权码</h1>
        <p>
          {isManualFlow
            ? '复制授权码，返回 Velin 粘贴。授权码在 5 分钟内有效。'
            : '若 Velin 没有自动打开，请复制授权码并在应用中粘贴。'}
        </p>
        <code className="auth-code-value">{code}</code>
        <Button
          variant="primary"
          size="regular"
          stretch
          type="button"
          onClick={() => void copyCode()}
        >
          {isCopied ? '已复制' : '复制授权码'}
        </Button>
        <p
          className="auth-code-copy-feedback"
          role={copyError ? 'alert' : undefined}
        >
          {copyError ? '复制失败，请手动选中授权码。' : ''}
        </p>
      </section>
    </main>
  )
}
