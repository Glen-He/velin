import type { Metadata } from 'next'
import { SignInPage } from '@/components/auth/SignInPage'
export const metadata: Metadata = { title: '登录 Velin' }
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [[key, Array.isArray(value) ? value.at(-1)! : value]],
    ),
  )
  return <SignInPage query={query} />
}
