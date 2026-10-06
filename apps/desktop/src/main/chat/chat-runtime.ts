import { serviceUrl, authClient } from '../auth/auth-client'
import { ChatStreamRuntime } from './stream-runtime'

// 只有适配层读取 Main 的会话；流式生命周期可以独立验证。
export class ChatRuntime extends ChatStreamRuntime {
  constructor(onUnauthorized: () => void) {
    super({
      endpoint: `${serviceUrl}/api/chat/stream`,
      getCookie: () => authClient.getCookie(),
      onUnauthorized,
    })
  }
}
