'use client'

import './truncated-text.css'

type TruncatedTextProps = {
  children: string
  className?: string
  tooltip?: string
}

// CSS 只省略视觉展示，DOM 与悬停提示保留完整文字。
export function TruncatedText({
  children,
  className = '',
  tooltip,
}: TruncatedTextProps) {
  return (
    <span
      className={`truncated-text ${className}`.trim()}
      title={tooltip ?? children}
    >
      {children}
    </span>
  )
}
