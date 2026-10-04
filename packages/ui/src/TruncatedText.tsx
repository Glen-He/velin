'use client'

import './truncated-text.css'

type TruncatedTextProps = {
  children: string
  className?: string
}

// CSS 只省略视觉展示，DOM 与悬停提示保留完整文字。
export function TruncatedText({
  children,
  className = '',
}: TruncatedTextProps) {
  return (
    <span className={`truncated-text ${className}`.trim()} title={children}>
      {children}
    </span>
  )
}
