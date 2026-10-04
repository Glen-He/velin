'use client'

import { Children, isValidElement } from 'react'
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
} from 'react'
import { buttonWidthTier } from './button-policy'
import './button.css'
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'accent'
  | 'danger'
  | 'danger-primary'
type Appearance = {
  children: ReactNode
  sizeLabel?: string
  variant?: ButtonVariant
  size?: 'compact' | 'regular'
  stretch?: boolean
}
function labelText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number')
        return String(child)
      return isValidElement<{ children?: ReactNode }>(child)
        ? labelText(child.props.children)
        : ''
    })
    .join('')
}
function appearance(
  {
    children,
    sizeLabel,
    variant = 'primary',
    size = 'compact',
    stretch = false,
  }: Appearance,
  className?: string,
  style?: CSSProperties,
) {
  return {
    className: ['pill-button', className].filter(Boolean).join(' '),
    'data-variant': variant,
    'data-size': size,
    'data-stretch': stretch || undefined,
    style: {
      '--action-label-units': buttonWidthTier(sizeLabel ?? labelText(children)),
      ...style,
    } as CSSProperties,
  }
}
export function Button({
  children,
  sizeLabel,
  variant,
  size,
  stretch,
  className,
  style,
  type = 'button',
  ...props
}: Appearance & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type={type}
      {...appearance(
        { children, sizeLabel, variant, size, stretch },
        className,
        style,
      )}
    >
      {children}
    </button>
  )
}
export function ButtonLink({
  children,
  sizeLabel,
  variant,
  size,
  stretch,
  className,
  style,
  ...props
}: Appearance & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      {...appearance(
        { children, sizeLabel, variant, size, stretch },
        className,
        style,
      )}
    >
      {children}
    </a>
  )
}
// 同组按钮取最长的稳定标签档；执行中文案通过 sizeLabel 保持原尺寸。
export function ActionGroup({
  children,
  className = '',
  stretch = false,
}: {
  children: ReactNode
  className?: string
  stretch?: boolean
}) {
  const units = Math.max(
    2,
    ...Children.toArray(children).map((child) =>
      isValidElement<Appearance>(child)
        ? buttonWidthTier(
            child.props.sizeLabel ?? labelText(child.props.children),
          )
        : 2,
    ),
  )
  return (
    <div
      className={`action-group ${className}`}
      data-stretch={stretch || undefined}
      style={{ '--action-group-label-units': units } as CSSProperties}
    >
      {children}
    </div>
  )
}
