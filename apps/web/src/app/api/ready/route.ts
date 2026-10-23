import { withApiBoundary } from '@/lib/http/api-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = withApiBoundary(async () => {
  const { databasePool } = await import('@/lib/database/connection')
  const { assertDatabaseSchema } = await import('@/lib/database/schema')
  try {
    await assertDatabaseSchema(databasePool)
    const heartbeat =
      await databasePool.query(`select service from service_heartbeat
      where service in ('ocr', 'maintenance') and updated_at > now() - interval '120 seconds'`)
    if (heartbeat.rowCount !== 2)
      return Response.json({ status: 'unavailable' }, { status: 503 })
    return Response.json({ status: 'ready' })
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 })
  }
})
