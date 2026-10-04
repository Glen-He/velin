import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(async (request) => {
  const { uploadAvatar } = await import('@/lib/avatars')
  return uploadAvatar(request)
}, {})
export { handler as POST }
