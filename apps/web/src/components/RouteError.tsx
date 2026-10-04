'use client'
import { Button, ButtonLink, ActionGroup } from '@velin/ui/Button.tsx'
export function RouteError({ reset }: { reset: () => void }) {
  return (
    <main className="auth-page">
      <section className="auth-content">
        <h1>页面加载失败</h1>
        <p role="alert">服务暂时不可用，请稍后重试。</p>
        <ActionGroup>
          <Button variant="primary" onClick={reset}>
            重试
          </Button>
          <ButtonLink href="/sign-in" variant="outline">
            返回登录
          </ButtonLink>
        </ActionGroup>
      </section>
    </main>
  )
}
