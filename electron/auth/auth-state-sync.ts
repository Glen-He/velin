import type { AuthState, AuthUser } from '@velin/contracts/auth-protocol'

// 显式登录、退出和过期事件比后台读取优先；同一代读取只有最新结果可发布。
export function createAuthStateSync(
  readUser: () => Promise<AuthUser | null>,
  publish: (state: AuthState) => void,
) {
  let stateVersion = 0
  let readVersion = 0
  function emit(state: AuthState) {
    stateVersion += 1
    publish(state)
  }
  async function refresh() {
    const expectedState = stateVersion
    const expectedRead = ++readVersion
    try {
      const user = await readUser()
      if (expectedState === stateVersion && expectedRead === readVersion) {
        emit({ user })
      }
    } catch {
      // 后台网络失败不覆盖已知登录状态；明确的未登录结果仍正常发布。
    }
  }
  return { emit, refresh }
}
