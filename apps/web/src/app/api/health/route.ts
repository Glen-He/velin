import { withApiBoundary } from '@/lib/http/api-handler'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(async () => {
  const { databasePool } = await import('@/lib/database/connection')
  await databasePool.query('select 1')
  return Response.json({ status: 'ok' })
})
export { handler as GET }
