import type { ReactNode } from 'react'
import { TruncatedText } from './TruncatedText'
export function PanelCard({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`panel-card ${className}`}>{children}</div>
}
export function PanelGroup({
  children,
  title,
  className = '',
}: {
  children: ReactNode
  title: string
  className?: string
}) {
  return (
    <section className={`panel-group ${className}`}>
      <h2 className="panel-group-title">{title}</h2>
      {children}
    </section>
  )
}
export function PanelRow({
  children,
  title,
  description,
  className = '',
}: {
  children?: ReactNode
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={`panel-row ${className}`}>
      <div className="panel-row-copy">
        <TruncatedText className="panel-row-title">{title}</TruncatedText>
        {description ? (
          <TruncatedText className="panel-row-description">
            {description}
          </TruncatedText>
        ) : null}
      </div>
      {children ? <div className="panel-row-control">{children}</div> : null}
    </div>
  )
}
