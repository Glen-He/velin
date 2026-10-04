// 进程内标记从不返回客户端；内部凭据验证
// 已由外层路由按账号限制尝试次数。
const marker = crypto.randomUUID()
const header = 'x-velin-internal-verification'
export function markInternalVerification(headers: Headers) {
  headers.set(header, marker)
}
export function isInternalVerification(request: Request) {
  return request.headers.get(header) === marker
}
