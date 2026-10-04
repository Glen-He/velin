'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { InputHTMLAttributes, Ref } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string
  inputRef?: Ref<HTMLInputElement>
}

// 每个字段独立管理密码可见性，CSS 保留尾部动作槽位。
export function PasswordField({ label, inputRef, ...props }: Props) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="code-field has-toggle">
      <input
        {...props}
        ref={inputRef}
        className="web-field"
        type={visible ? 'text' : 'password'}
        placeholder={label}
        aria-label={label}
        aria-required={props.required}
      />
      <button
        className="auth-field-action"
        type="button"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </span>
  )
}
