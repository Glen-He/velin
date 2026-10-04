import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = withApiBoundary(
  async (request, context: { params: Promise<{ userId: string }> }) => {
    const { readAvatar } = await import('@/lib/avatars')
    return readAvatar(request, (await context.params).userId)
  },
)
