import 'server-only'

import { avatarLimits } from '@velin/contracts/policy'
import { isAvatarJpeg } from '@velin/contracts/avatar'
import { createHash } from 'node:crypto'
import { jsonResponse } from './http/response'
import { auth } from './auth/server'
import { config } from './config'
import { databasePool } from './database/connection'
import { logger } from './logging'

// Better Auth 的用户 ID 是 32 位随机串，不是 UUID。
const authUserIdPattern = /^[A-Za-z0-9_-]{16,64}$/

// 头像由客户端统一转成 JPEG 后上传；服务端只接受声明与实际字节一致的 JPEG，
// 图片与用户引用在同一条 SQL 中保存；读取端按内容 ETag 重新验证缓存。
export async function uploadAvatar(request: Request) {
  // 浏览器请求会带 Origin；Electron Main 不会。带 Origin 时必须来自可信前端。
  const origin = request.headers.get('origin')
  if (origin && origin !== config.appUrl) {
    return jsonResponse({ message: '请求来源无效。' }, 403)
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  })
  if (!session) {
    return jsonResponse({ message: '请先登录后再上传头像。' }, 401)
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (
    !Number.isInteger(declaredLength) ||
    declaredLength <= 0 ||
    declaredLength > avatarLimits.uploadBytes ||
    contentType !== 'image/jpeg'
  ) {
    return jsonResponse({ message: '头像必须是 512KB 以内的 JPEG 图片。' }, 400)
  }

  const bytes = Buffer.from(await request.arrayBuffer())
  const hasJpegSignature =
    bytes.length === declaredLength && isAvatarJpeg(bytes)

  if (!hasJpegSignature) {
    return jsonResponse({ message: '头像必须是 512KB 以内的 JPEG 图片。' }, 400)
  }

  try {
    const userId = session.user.id
    const result = await databasePool.query<{ image: string }>(
      `with saved_avatar as (
           insert into "user_avatar" ("userId", "contentType", "data")
           values ($1, 'image/jpeg', $2)
           on conflict ("userId") do update
             set "contentType" = excluded."contentType",
                 "data" = excluded."data",
                 "updatedAt" = now()
           returning "userId", "updatedAt"
         )
         update "user" as account
         set "image" = '/api/avatars/' || avatar."userId" || '?v=' ||
             floor(extract(epoch from avatar."updatedAt") * 1000)::bigint::text,
             "updatedAt" = now()
         from saved_avatar as avatar
         where account."id" = avatar."userId"
         returning account."image"`,
      [userId, bytes],
    )

    return jsonResponse({ image: result.rows[0].image })
  } catch (error) {
    logger.error('avatar.save_failed', { error })
    return jsonResponse({ message: '头像保存失败，请稍后重试。' }, 500)
  }
}

export async function readAvatar(request: Request, userId: string) {
  if (!authUserIdPattern.test(userId)) {
    return jsonResponse({ message: '头像不存在。' }, 404)
  }

  try {
    const result = await databasePool.query<{
      contentType: string
      data: Buffer
    }>(`select "contentType", "data" from "user_avatar" where "userId" = $1`, [
      userId,
    ])

    if (result.rows.length === 0) {
      return jsonResponse({ message: '头像不存在。' }, 404)
    }

    const row = result.rows[0]
    const bytes = new Uint8Array(row.data)
    const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`
    const headers = {
      'Content-Type': row.contentType,
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: etag,
    }
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }

    return new Response(bytes, { status: 200, headers })
  } catch (error) {
    logger.error('avatar.read_failed', { error })
    return jsonResponse({ message: '头像读取失败，请稍后重试。' }, 500)
  }
}
