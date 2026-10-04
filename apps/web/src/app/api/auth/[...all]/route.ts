import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(async (request) => {
  const { handleAuthentication } = await import('@/lib/auth/handler')
  return handleAuthentication(request)
})
export { handler as GET, handler as POST }
