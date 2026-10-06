import { useEffect, useId, useState } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'

type DiagramResult = {
  source: string
  svg?: string
  failed?: boolean
}

const diagramCharacterLimit = 12_000
const diagramConfig = {
  securityLevel: 'strict' as const,
  theme: 'neutral' as const,
  fontFamily: 'var(--font-sans)',
  flowchart: { htmlLabels: false },
}

// 图表库只在真正出现图表时加载，普通文字回复不承担它的解析与下载成本。
let diagramModule: Promise<typeof import('@streamdown/mermaid')> | undefined
function loadDiagramModule() {
  diagramModule ??= import('@streamdown/mermaid').catch((error: unknown) => {
    diagramModule = undefined
    throw error
  })
  return diagramModule
}

export default function AssistantDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const incomplete = useIsCodeFenceIncomplete()
  const oversized = source.length > diagramCharacterLimit
  const [result, setResult] = useState<DiagramResult | null>(null)
  const current = result?.source === source ? result : null

  useEffect(() => {
    if (incomplete || oversized) return
    let active = true
    void loadDiagramModule()
      .then(async ({ mermaid }) => {
        // 当前可见源文本已触发需要的字体分片，等其稳定后再计算图表标签宽度。
        await document.fonts.ready
        if (!active) return null
        return mermaid
          .getMermaid(diagramConfig)
          .render(`velin-diagram-${id}`, source)
      })
      .then((rendered) => {
        if (active && rendered) setResult({ source, svg: rendered.svg })
      })
      .catch(() => {
        if (active) setResult({ source, failed: true })
      })
    // 切换会话、更新源内容或卸载后，已开始的渲染不能更新新视图。
    return () => {
      active = false
    }
  }, [id, source, incomplete, oversized])

  return (
    <figure className="markdown-diagram">
      <figcaption>图表</figcaption>
      {current?.svg ? (
        <div
          className="markdown-diagram-canvas"
          role="img"
          aria-label="根据回复内容生成的图表"
          // Mermaid 在 strict 模式下生成并清理 SVG，不直接注入模型提供的 HTML。
          dangerouslySetInnerHTML={{ __html: current.svg }}
        />
      ) : (
        <div className="markdown-diagram-fallback">
          <p role="status">
            {oversized
              ? '图表较大，已显示原始内容。'
              : current?.failed
                ? '图表暂时无法显示，原始内容如下。'
                : '正在生成图表…'}
          </p>
          <pre>
            <code>{source}</code>
          </pre>
        </div>
      )}
      {current?.svg ? (
        <details className="markdown-diagram-source">
          <summary>查看图表代码</summary>
          <pre>
            <code>{source}</code>
          </pre>
        </details>
      ) : null}
    </figure>
  )
}
