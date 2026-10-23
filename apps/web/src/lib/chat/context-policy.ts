import type { MessageStatus } from '@velin/contracts/chat'
import { truncateText } from '@velin/contracts/policy'

export const contextPolicy = {
  version: 2,
  inputTokens: 262_144,
  recentTokens: 48_000,
  summaryCharacters: 10_000,
  summaryBatchCharacters: 100_000,
  documentCharacters: 18_000,
  recalledCharacters: 8_000,
  chunkCharacters: 1_000,
} as const

// UTF-8 字节数作为保守上界，不把字符数伪装成精确 tokenizer 结果。
export function tokenUpperBound(text: string) {
  return new TextEncoder().encode(text).length + 8
}

const stopWords = new Set([
  '什么',
  '怎么',
  '如何',
  '请问',
  '这个',
  '那个',
  '我们',
  '你们',
  '一个',
  '一下',
  '可以',
  '需要',
  '告诉',
  '请',
  '的',
  '是',
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
])
export function retrievalTerms(text: string) {
  const normalized = text.normalize('NFKC').toLowerCase()
  const terms = new Set<string>()
  for (const match of normalized.matchAll(
    /[a-z0-9_-]{2,64}|[\p{Script=Han}]{2,}/gu,
  )) {
    const word = match[0]
    if (!stopWords.has(word)) terms.add(truncateText(word, 64))
    if (/\p{Script=Han}/u.test(word)) {
      const characters = [...word]
      for (let i = 0; i < characters.length - 1 && terms.size < 500; i++) {
        const part = characters[i] + characters[i + 1]
        if (!stopWords.has(part)) terms.add(part)
      }
    }
    if (terms.size >= 500) break
  }
  return [...terms].slice(0, 500)
}

export function splitDocument(text: string) {
  const chunks: Array<{
    position: number
    page: number | null
    content: string
    terms: string[]
  }> = []
  let page: number | null = null
  const sections = text.split(/(?=\[第 \d+ 页)/u)
  for (const section of sections) {
    const pageMatch = /^\[第 (\d+) 页/u.exec(section)
    if (pageMatch) page = Number(pageMatch[1])
    for (
      let start = 0;
      start < section.length;
      start += contextPolicy.chunkCharacters - 160
    ) {
      // UTF-16 预算不截断代理对，避免把无效 Unicode 写入 PostgreSQL JSON。
      const low = section.charCodeAt(start)
      const previous = section.charCodeAt(start - 1)
      const begin =
        low >= 0xdc00 &&
        low <= 0xdfff &&
        previous >= 0xd800 &&
        previous <= 0xdbff
          ? start - 1
          : start
      let end = begin + contextPolicy.chunkCharacters
      const last = section.charCodeAt(end - 1)
      const next = section.charCodeAt(end)
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
        end--
      const content = section.slice(begin, end)
      if (content.trim())
        chunks.push({
          position: chunks.length,
          page,
          content,
          terms: retrievalTerms(content),
        })
    }
  }
  return chunks
}

export type ContextMessage = {
  id: string
  sequence: string
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
}
export function selectRecentTurns(messages: ContextMessage[]) {
  const groups: ContextMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user') groups.push([message])
    else groups.at(-1)?.push(message)
  }
  const selected: ContextMessage[] = []
  let tokens = 0
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]
    const cost = group.reduce(
      (sum, message) => sum + tokenUpperBound(message.content),
      0,
    )
    if (selected.length && tokens + cost > contextPolicy.recentTokens) break
    selected.unshift(...group)
    tokens += cost
  }
  return selected
}

export function messageForContext(message: ContextMessage) {
  return message.role === 'assistant' && message.status !== 'completed'
    ? `[上次回复${message.status === 'cancelled' ? '已停止' : '未完整完成'}，以下是部分内容，不代表已完成核实]\n${message.content}`
    : message.content
}
