import { LoaderCircle } from 'lucide-react'

export function Spinner() {
  return <LoaderCircle className="spinner" aria-label="处理中" />
}

export function LoadingState({ label }: { label: string }) {
  return (
    <main className="auth-page">
      <div className="loading-state">
        <Spinner />
        <span>{label}</span>
      </div>
    </main>
  )
}
