// 服务配置不能携带凭据、路径或查询；开发 HTTP 只允许回环主机。
export function serviceOrigin(
  value: string,
  allowLoopbackHttp: boolean,
): string {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    value.trim() !== value ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (allowLoopbackHttp && loopback && url.protocol === 'http:')
    )
  )
    throw new Error(
      'Service URL must be an HTTPS origin or an explicitly allowed loopback HTTP origin.',
    )
  return url.origin
}
