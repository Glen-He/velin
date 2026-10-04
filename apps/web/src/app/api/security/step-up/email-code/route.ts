import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(
  async (request) => {
    const { sendStepUpEmailCode } = await import('@/lib/security/step-up')
    return sendStepUpEmailCode(request)
  },
  { security: true },
)
export { handler as POST }
