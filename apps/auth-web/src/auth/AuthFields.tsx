import { Mail } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode } from 'react'

export function EmailField({
  email,
  setEmail,
  withPasskey = false,
}: {
  email: string
  setEmail: (email: string) => void
  withPasskey?: boolean
}) {
  return (
    <AuthField
      id="auth-email"
      label="邮箱"
      icon={Mail}
      focusHint="name@example.com"
      autoCapitalize="none"
      autoComplete={withPasskey ? 'username webauthn' : 'email'}
      inputMode="email"
      required
      type="email"
      value={email}
      onChange={(event) => setEmail(event.target.value)}
    />
  )
}

type AuthFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'placeholder'
> & {
  code?: boolean
  floating?: boolean
  error?: string
  focusHint?: string
  icon: LucideIcon
  label: string
  trailingAction?: ReactNode
}

export function AuthField({
  code = false,
  floating = !code,
  error = '',
  focusHint = '',
  icon: Icon,
  id,
  label,
  trailingAction,
  ...inputProps
}: AuthFieldProps) {
  return (
    <div className="auth-field-row">
      <div className="auth-field">
        <span className="auth-field-icon" aria-hidden="true">
          <Icon />
        </span>
        <input
          {...inputProps}
          id={id}
          aria-label={floating ? inputProps['aria-label'] : label}
          aria-invalid={error ? true : inputProps['aria-invalid']}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`auth-field-input${error ? ' is-error' : ''}${
            trailingAction ? ' has-trailing-action' : ''
          }${code ? ' is-code' : ''}`}
          placeholder={floating ? focusHint || ' ' : label}
        />
        {floating ? (
          <label className="auth-floating-label" htmlFor={id}>
            {label}
          </label>
        ) : null}
        {trailingAction}
      </div>
      <p
        id={`${id}-error`}
        className="auth-field-error"
        role={error ? 'alert' : undefined}
      >
        {error}
      </p>
    </div>
  )
}
