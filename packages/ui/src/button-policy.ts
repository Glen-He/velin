// 标签按 grapheme 计数，拉丁字符估算字宽；奇数字向上归档，长标签继续取偶数档。
const segments = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
export function buttonWidthTier(label: string): number {
  const units = [...segments.segment(label.trim())].reduce(
    (total, { segment }) => total + (/^[\x20-\x7e]+$/.test(segment) ? 0.6 : 1),
    0,
  )
  return Math.max(2, Math.ceil(units / 2) * 2)
}
