// 请求既绑定凭据快照，也绑定登录代次；A → 退出 → A 不能复用旧响应。
export function createCredentialScope(readCookie: () => string) {
  let generation = 0
  let controller = new AbortController()
  return {
    invalidate() {
      generation += 1
      controller.abort()
      controller = new AbortController()
    },
    capture() {
      const expectedGeneration = generation
      const cookie = readCookie()
      return {
        cookie,
        signal: controller.signal,
        isCurrent: () =>
          generation === expectedGeneration && readCookie() === cookie,
      }
    },
  }
}
