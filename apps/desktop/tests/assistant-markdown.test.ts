import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

// Node 检查真实 React 渲染；样式和实际几何另在浏览器验证。
const styles = registerHooks({
  load(url, context, nextLoad) {
    return new URL(url).pathname.endsWith('.css')
      ? { format: 'module', source: 'export {}', shortCircuit: true }
      : nextLoad(url, context)
  },
})
const { default: AssistantMarkdown } = (await tsImport(
  '../src/renderer/features/chat/AssistantMarkdown.tsx',
  {
    parentURL: import.meta.url,
    tsconfig: fileURLToPath(new URL('../tsconfig.app.json', import.meta.url)),
  },
)) as typeof import('../src/renderer/features/chat/AssistantMarkdown')
styles.deregister()

function render(content: string, isStreaming = false) {
  return renderToStaticMarkup(
    createElement(AssistantMarkdown, { content, isStreaming }),
  )
}

test('CJK punctuation preserves emphasis and ends bare links before Chinese prose', () => {
  const html = render(
    '**重要提示（Important Notice）：**请注意。\n\n链接：https://example.com。这是说明。',
  )
  assert.match(
    html,
    /data-streamdown="strong">重要提示（Important Notice）：<\/span>/,
  )
  assert.doesNotMatch(html, /\*\*/)
  assert.match(html, /href="https:\/\/example.com\/"/)
  assert.match(html, /<\/a>。这是说明。/)
})

test('code keeps indentation and exposes an accessible copy action without a tooltip', () => {
  const html = render('```typescript\nfunction greet() {\n  return 42\n}\n```')
  assert.match(html, /data-language="typescript"/)
  assert.match(html, /  return 42/)
  const button = html.match(/<button[^>]*>/)?.[0]
  assert.ok(button)
  assert.match(button, /aria-label="复制代码"/)
  assert.doesNotMatch(button, /title=|disabled=/)
  const streaming = render('```typescript\nconst unfinished =', true)
  assert.match(
    streaming,
    /data-streamdown="code-block-copy-button" disabled=""/,
  )
  assert.match(streaming, /const unfinished =/)
})

test('tables preserve alignment and offer a named keyboard scroll region', () => {
  const html = render('| 左 | 右 |\n| :--- | ---: |\n| 内容 | 42 |')
  assert.match(html, /class="markdown-table-scroll" role="region"/)
  assert.match(html, /aria-label="表格，可左右滚动查看" tabindex="0"/)
  assert.match(html, /<th[^>]*style="text-align:right">右<\/th>/)
  assert.match(html, /<td[^>]*style="text-align:right">42<\/td>/)
})

test('inline and block math render with semantic MathML', () => {
  const html = render('行内：$E=mc^2$\n\n$$\n\\frac{a}{b}\n$$')
  assert.equal((html.match(/<math /g) ?? []).length, 2)
  assert.match(html, /class="katex-display"/)
  assert.match(
    html,
    /<annotation encoding="application\/x-tex">E=mc\^2<\/annotation>/,
  )
})

test('untrusted content cannot inject script, credential links or remote image requests', () => {
  const html = render(
    '<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)\n\n[凭据](https://name:secret@example.com/)\n\n![图片说明](https://example.com/pixel.png)',
  )
  assert.doesNotMatch(html, /<script|javascript:|https:\/\/name:secret|<img /)
  assert.match(html, /图片：图片说明/)
})

test('incomplete and oversized diagrams retain readable source without server-side rendering', () => {
  const streaming = render('```mermaid\nflowchart LR\n  A -->', true)
  assert.match(streaming, /markdown-diagram/)
  assert.match(streaming, /flowchart LR/)
  assert.doesNotMatch(streaming, /<svg|dangerouslySetInnerHTML/)
  const oversized = render('```mermaid\n' + 'A'.repeat(12_001) + '\n```')
  assert.match(oversized, /图表较大，已显示原始内容。/)
  assert.match(oversized, /A{12001}/)
  assert.doesNotMatch(oversized, /<svg/)
})
