// This process-local marker is never returned to a client. Internal credential
// validation is already guarded by account-scoped limits at the outer route.
const marker = crypto.randomUUID()
const header = 'x-velin-internal-verification'
export function markInternalVerification(headers: Headers) {
  headers.set(header, marker)
}
export function isInternalVerification(request: Request) {
  return request.headers.get(header) === marker
}
