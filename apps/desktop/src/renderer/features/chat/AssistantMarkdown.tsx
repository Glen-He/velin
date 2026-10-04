import { Check, Copy } from 'lucide-react'
import { memo } from 'react'
import { code } from '@streamdown/code'
import { Streamdown } from 'streamdown'
import type {
  Components,
  ControlsConfig,
  IconMap,
  StreamdownTranslations,
} from 'streamdown'

const streamdownPlugins = { code }
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

const markdownComponents = {
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
