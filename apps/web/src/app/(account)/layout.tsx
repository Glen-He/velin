import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Document } from '@/components/layout/Document'
import { requireSession } from '@/lib/auth/session'
import '../globals.css'
export const metadata: Metadata = {
  title: 'Velin',
  description: 'Velin 账号与安全管理',
}
export const dynamic = 'force-dynamic'
export default async function Layout({ children }: { children: ReactNode }) {
  await requireSession()
  return <Document theme="system">{children}</Document>
}
