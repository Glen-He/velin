import { lazy, Suspense } from 'react'
import { LoadingState } from './LoadingState'
const AccountPage = lazy(() =>
  import('./account/AccountPage').then((module) => ({
    default: module.AccountPage,
  })),
)
const SessionsPage = lazy(() =>
  import('./account/SessionsPage').then((module) => ({
    default: module.SessionsPage,
  })),
)
const SecurityPage = lazy(() =>
  import('./security/SecurityPage').then((module) => ({
    default: module.SecurityPage,
  })),
)
const PasskeysPage = lazy(() =>
  import('./security/PasskeysPage').then((module) => ({
    default: module.PasskeysPage,
  })),
)
const SignInPage = lazy(() =>
  import('./auth/SignInPage').then((module) => ({
    default: module.SignInPage,
  })),
)

function RouteContent() {
  const pathname = window.location.pathname

  if (pathname === '/security') {
    return <SecurityPage />
  }

  if (pathname === '/security/passkeys') {
    return <PasskeysPage />
  }

  if (pathname === '/account/sessions') {
    return <SessionsPage />
  }

  if (pathname === '/account') {
    return <AccountPage />
  }

  return <SignInPage />
}

export default function App() {
  return (
    <Suspense fallback={<LoadingState label="正在加载…" />}>
      <RouteContent />
    </Suspense>
  )
}
