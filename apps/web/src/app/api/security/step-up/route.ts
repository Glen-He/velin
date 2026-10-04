import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(
  async (request) => {
    const { verifyStepUpCode } = await import('@/lib/security/step-up')
    return verifyStepUpCode(request)
  },
  { security: true },
)
export { handler as POST }
