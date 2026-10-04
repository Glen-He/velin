'use client'

import { Document } from '@/components/layout/Document'
import { RouteError } from '@/components/RouteError'
import './globals.css'

// 根布局失败也提供中文恢复入口，不将服务端诊断直接显示给用户。
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <Document theme="system">
      <RouteError reset={reset} />
    </Document>
  )
}
