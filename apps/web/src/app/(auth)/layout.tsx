import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Document } from '@/components/layout/Document'
import '../globals.css'
export const metadata: Metadata = {
  title: 'Velin',
  description: 'Velin 账号与安全管理',
}
export default function Layout({ children }: { children: ReactNode }) {
  return <Document theme="light">{children}</Document>
}
