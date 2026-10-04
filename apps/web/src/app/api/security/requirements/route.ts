import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(
  async (request) => {
    const { readSecurityRequirements } = await import('@/lib/security/step-up')
    return readSecurityRequirements(request)
  },
  { security: true },
)
export { handler as GET }
