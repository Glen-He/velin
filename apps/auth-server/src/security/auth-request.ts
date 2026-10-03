import { isIP } from 'node:net'
import { isRecord } from '@velin/contracts/value'

export const clientAddressHeader = 'x-velin-client-address'

// Only the Node adapter's socket proves the immediate peer. Browser-supplied
// address headers are discarded unless that peer is explicitly trusted.
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
