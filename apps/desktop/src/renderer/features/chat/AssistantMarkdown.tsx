import { Check, Copy } from 'lucide-react'
import { cloneElement, isValidElement, memo } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { code } from '@streamdown/code'
import { cjk } from '@streamdown/cjk'
import { copyFeedbackDurationMs } from '@velin/ui/clipboard-feedback.ts'
import { createMathPlugin } from '@streamdown/math'
import {
  CodeBlock,
  CodeBlockCopyButton,
  Streamdown,
  useIsCodeFenceIncomplete,
} from 'streamdown'
import type {
  Components,
  ControlsConfig,
  ExtraProps,
  IconMap,
  StreamdownTranslations,
} from 'streamdown'
import 'katex/dist/katex.min.css'
import './assistant-markdown.css'
import AssistantDiagram from './AssistantDiagram'

const streamdownPlugins = {
  code,
  cjk,
  math: createMathPlugin({
    singleDollarTextMath: true,
    errorColor: 'var(--color-secondary)',
  }),
}
const streamdownControls = {
  code: { copy: true, download: false },
  table: false,
  image: false,
} satisfies ControlsConfig
const streamdownTranslations = {
  copyCode: '复制代码',
  copied: '已复制',
} satisfies Partial<StreamdownTranslations>
const streamdownIcons = {
  CopyIcon: Copy,
  CheckIcon: Check,
} satisfies Partial<IconMap>

function externalHttpUrl(value: string | undefined) {
  if (!value) return null

  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

function MarkdownCode({
  children,
  className,
  'data-block': isBlock,
}: ComponentProps<'code'> & ExtraProps & { 'data-block'?: boolean }) {
  const incomplete = useIsCodeFenceIncomplete()
  if (!isBlock || typeof children !== 'string')
    return <code className={className}>{children}</code>
  const language = className?.match(/\blanguage-([^\s]+)/)?.[1] ?? ''
  return (
    <CodeBlock
      code={children.replace(/\n$/, '')}
      language={language}
      isIncomplete={incomplete}
      lineNumbers={false}
    >
      {/* 复用上游复制与反馈生命周期，仅移除重复的原生操作提示。 */}
      <CodeBlockCopyButton title={undefined} timeout={copyFeedbackDurationMs} />
    </CodeBlock>
  )
}

const markdownComponents = {
  code: MarkdownCode,
  pre({ children }) {
    if (
      !isValidElement<{
        className?: string
        children?: ReactNode
        'data-block'?: boolean
      }>(children)
    )
      return children
    if (
      children.props.className?.split(/\s+/).includes('language-mermaid') &&
      typeof children.props.children === 'string'
    )
      return <AssistantDiagram source={children.props.children} />
    return cloneElement(children, { 'data-block': true })
  },
  table({ children, node: _node, ...props }) {
    return (
      <div
        className="markdown-table-scroll"
        role="region"
        aria-label="表格，可左右滚动查看"
        tabIndex={0}
      >
        <table {...props}>{children}</table>
      </div>
    )
  },
  a({ href, children }) {
    const url = externalHttpUrl(href)
    if (!url) return <span>{children}</span>

    return (
      <a
        href={url}
        onClick={(event) => {
          event.preventDefault()
          void window.velin.chat.openExternalLink(url)
        }}
      >
        {children}
      </a>
    )
  },
  img({ alt, src }) {
    const url = externalHttpUrl(src)
    return url ? (
      <span className="markdown-image-reference">图片：{alt || url}</span>
    ) : null
  },
} satisfies Components

const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  isStreaming,
}: {
  content: string
  isStreaming: boolean
}) {
  if (!content) return null

  return (
    <Streamdown
      animated={false}
      className="assistant-markdown"
      components={markdownComponents}
      codeBlockMaxHeight={0}
      controls={streamdownControls}
      icons={streamdownIcons}
      isAnimating={isStreaming}
      lineNumbers={false}
      mode={isStreaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={isStreaming}
      plugins={streamdownPlugins}
      translations={streamdownTranslations}
    >
      {content}
    </Streamdown>
  )
})

export default AssistantMarkdown
