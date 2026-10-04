import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

// Server Component 直接读取服务端会话，不绕过 HTTP 再请求本应用。
export const requireSession = cache(async () => {
  const { auth } = await import('./server')
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/sign-in')
  return session
})
