import { isIP } from 'node:net'
import { isRecord } from '@velin/contracts/value'

export const clientAddressHeader = 'x-velin-client-address'

// 只有 Node adapter 的 socket 能证明直接连接方；
// 除非该连接方被明确设为可信代理，否则丢弃浏览器传入的地址头。
export function authRequestWithAddress(
  request: Request,
  bindings: unknown,
  trustedPeers: readonly string[],
) {
  const env =
    isRecord(bindings) && isRecord(bindings.server) ? bindings.server : bindings
  const incoming = isRecord(env) ? env.incoming : null
  const socket = isRecord(incoming) ? incoming.socket : null
  const address = isRecord(socket) ? socket.remoteAddress : null
  const headers = new Headers(request.headers)
  headers.delete(clientAddressHeader)
  if (typeof address === 'string' && isIP(address)) {
    const peer =
      address.startsWith('::ffff:') && isIP(address.slice(7)) === 4
        ? address.slice(7)
        : address
    const forwarded = headers.get('x-forwarded-for')
    headers.set(
      clientAddressHeader,
      trustedPeers.includes(peer) && forwarded ? forwarded : peer,
    )
  }
  return new Request(request, { headers })
}
