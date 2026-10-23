import 'server-only'

import { jsonResponse } from '../http/response'

export function chatJson(body: unknown, status = 200) {
  return jsonResponse(body, status, { 'Cache-Control': 'no-store' })
}

// 会话历史只供持有会话 Cookie 的桌面 Main 使用；浏览器的跨站页面
// 不能在 Origin 存在时读取或修改账号的聊天内容。
export function rejectBrowserChatRequest(request: Request) {
  if (request.headers.get('origin')) {
    return chatJson({ message: '请求来源无效。' }, 403)
  }
  return null
}

export async function getChatSession(request: Request) {
  const { auth } = await import('../auth/server')
  return auth.api.getSession({ headers: request.headers })
}
