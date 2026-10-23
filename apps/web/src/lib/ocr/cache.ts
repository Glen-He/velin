import 'server-only'

import { databasePool } from '../database/connection'

// 300 页文档约占 300 行；单用户保留约 20 份、全体保留约 66 份识别结果。
export const pdfPageCacheLimits = {
  totalRows: 20_000,
  userRows: 6_000,
} as const

type PdfPageCacheLimits = {
  totalRows: number
  userRows: number
}

export async function prunePdfPageCache(
  userId: string,
  limits: PdfPageCacheLimits = pdfPageCacheLimits,
) {
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    const total = await client.query(
      `delete from chat_pdf_page_cache
       where ctid in (
         select ctid from chat_pdf_page_cache
         order by updated_at desc, user_id, sha256, engine_version, page_number
         offset $1::int
       )`,
      [limits.totalRows],
    )
    const user = await client.query(
      `delete from chat_pdf_page_cache
       where ctid in (
         select ctid from chat_pdf_page_cache
         where user_id = $1
         order by updated_at desc, sha256, engine_version, page_number
         offset $2::int
       )`,
      [userId, limits.userRows],
    )
    await client.query('commit')
    return {
      totalDeleted: total.rowCount ?? 0,
      userDeleted: user.rowCount ?? 0,
    }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
