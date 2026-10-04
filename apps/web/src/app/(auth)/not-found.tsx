import { ButtonLink } from '@velin/ui/Button.tsx'
export default function NotFound() {
  return (
    <main className="auth-page">
      <section className="auth-content">
        <h1>页面不存在</h1>
        <p>请检查地址，或返回 Velin 登录页。</p>
        <ButtonLink href="/sign-in" variant="primary">
          返回登录
        </ButtonLink>
      </section>
    </main>
  )
}
