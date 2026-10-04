import { isIP } from 'node:net'
export const clientAddressHeader = 'x-velin-client-address'

// 只有实际 socket 证明直接连接方，代理地址只在该连接方被明确信任时采用。
export function trustedClientAddress(
  address: string | undefined,
  forwarded: string | string[] | undefined,
  trustedPeers: readonly string[],
) {
  if (!address || !isIP(address)) return null
  const peer =
    address.startsWith('::ffff:') && isIP(address.slice(7)) === 4
      ? address.slice(7)
      : address
  if (!trustedPeers.includes(peer) || typeof forwarded !== 'string') return peer
  const chain = forwarded.split(',').map((item) => item.trim())
  return chain.length > 0 && chain.every((item) => isIP(item))
    ? chain.at(-1)!
    : peer
}
