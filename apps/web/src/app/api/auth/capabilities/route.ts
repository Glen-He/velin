import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(async () => {
  const { config } = await import('@/lib/config')
  return Response.json({
    google: config.google !== null,
    passkey: true,
    emailOtp: true,
    password: true,
    twoFactor: true,
    developmentEmailPreview:
      !config.isProduction && config.email.transport === 'console',
  })
})
export { handler as GET }
