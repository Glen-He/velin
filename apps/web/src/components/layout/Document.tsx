import type { ReactNode } from 'react'

// 两类页面在服务端确定主题，避免首屏闪烁与额外的根主题同步 Effect。
export function Document({
  children,
  theme,
}: {
  children: ReactNode
  theme: 'light' | 'system'
}) {
  return (
    <html lang="zh-CN" data-theme={theme}>
      <body>{children}</body>
    </html>
  )
}
