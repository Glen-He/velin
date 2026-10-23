export function normalizeDocumentText(value: string) {
  const lines = value
    .replaceAll('\u0000', '\uFFFD')
    .replace(/[\uD800-\uDFFF]/gu, '\uFFFD')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
  while (lines.length > 0 && !lines[0]?.trim()) lines.shift()
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop()
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function meaningfulCharacterCount(value: string) {
  return value.replace(/\s/gu, '').length
}
