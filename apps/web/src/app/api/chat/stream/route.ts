import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(async (request) => {
  const { streamChat } = await import('@/lib/chat/stream')
  return streamChat(request)
})
export { handler as POST }
