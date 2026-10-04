import { AccountPage } from '@/components/account/AccountPage'
import { requireSession } from '@/lib/auth/session'
export const metadata = { title: '账号 · Velin' }
export default async function Page() {
  const { user } = await requireSession()
  return (
    <AccountPage
      initialUser={{
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
      }}
    />
  )
}
