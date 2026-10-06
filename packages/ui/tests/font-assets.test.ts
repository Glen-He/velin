import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const manifest = JSON.parse(
  readFileSync(new URL('../fonts/manifest.json', import.meta.url), 'utf8'),
) as {
  subsets: {
    file: string
    bytes: number
    sha256: string
    unicodeRange: string
  }[]
}
const css = readFileSync(
  new URL('../src/chinese-fonts.css', import.meta.url),
  'utf8',
)
const compactCss = css.replace(/\s/g, '')

function codePoints(range: string) {
  return range.split(',').flatMap((part) => {
    const [start, end = start] = part.replace('U+', '').split('-')
    const first = Number.parseInt(start, 16)
    const last = Number.parseInt(end, 16)
    return Array.from(
      { length: last - first + 1 },
      (_, offset) => first + offset,
    )
  })
}

test('self-hosted font subsets are intact, disjoint and do not replace Latin glyphs', () => {
  const covered = new Set<number>()
  for (const part of manifest.subsets) {
    const bytes = readFileSync(
      new URL(`../fonts/${part.file}`, import.meta.url),
    )
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2')
    assert.equal(bytes.length, part.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256)
    assert.ok(css.includes(`url('../fonts/${part.file}')`))
    assert.ok(compactCss.includes(`unicode-range:${part.unicodeRange};`))
    for (const point of codePoints(part.unicodeRange)) {
      assert.ok(point >= 0x2000, 'CJK subsets must not replace Latin glyphs')
      assert.ok(!covered.has(point), `Duplicated font range: ${point}`)
      covered.add(point)
    }
  }
  // 常用界面文字、全角标点和字库支持的罕见汉字都必须可用，不能仅按当前 UI 裁字。
  for (const char of '账号密码设置退出登录，。𠮷') {
    assert.ok(covered.has(char.codePointAt(0)!))
  }
  assert.doesNotMatch(css, /https?:|data:/)
  assert.equal(
    (css.match(/font-display: swap;/g) ?? []).length,
    manifest.subsets.length,
  )
})

test('font attribution and full license accompany the shared resources', () => {
  const license = readFileSync(
    new URL('../fonts/LICENSE.txt', import.meta.url),
    'utf8',
  )
  assert.match(license, /Copyright 2014-2025 Adobe/)
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/)
  assert.match(license, /Reserved Font/)
})

test('Inter ships intact Latin subsets with real italic and its full license', () => {
  const inter = JSON.parse(
    readFileSync(
      new URL('../fonts/inter-manifest.json', import.meta.url),
      'utf8',
    ),
  ) as {
    subsets: {
      file: string
      bytes: number
      sha256: string
      style: string
      unicodeRange: string
    }[]
  }
  const latinCss = readFileSync(
    new URL('../src/latin-fonts.css', import.meta.url),
    'utf8',
  )
  const compactLatinCss = latinCss.replace(/\s/g, '')
  assert.deepEqual(inter.subsets.map((part) => part.style).sort(), [
    'italic',
    'normal',
  ])
  for (const part of inter.subsets) {
    const bytes = readFileSync(
      new URL(`../fonts/${part.file}`, import.meta.url),
    )
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2')
    assert.equal(bytes.length, part.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256)
    assert.ok(latinCss.includes(`url('../fonts/${part.file}')`))
    assert.ok(compactLatinCss.includes(`unicode-range:${part.unicodeRange};`))
    const covered = new Set(codePoints(part.unicodeRange))
    for (let point = 0x20; point <= 0x7e; point += 1)
      assert.ok(covered.has(point))
    for (const char of 'éüñ€£“”') assert.ok(covered.has(char.codePointAt(0)!))
    for (const point of covered)
      assert.ok(point < 0x2e80, 'Latin fonts must not take over CJK text')
  }
  assert.doesNotMatch(latinCss, /https?:|data:/)
  assert.equal((latinCss.match(/font-display: swap;/g) ?? []).length, 2)
  const license = readFileSync(
    new URL('../fonts/INTER-LICENSE.txt', import.meta.url),
    'utf8',
  )
  assert.match(license, /Copyright \(c\) 2016 The Inter Project Authors/)
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/)
})

test('font roles prefer Apple native faces, share Inter elsewhere and preserve monospace code', () => {
  const tokens = readFileSync(
    new URL('../src/tokens.css', import.meta.url),
    'utf8',
  )
  const sans = tokens.match(/--font-sans:([^;]+);/)![1]
  assert.ok(sans.indexOf('-apple-system') < sans.indexOf('Velin Inter'))
  assert.ok(sans.indexOf('PingFang SC') < sans.indexOf('Velin Inter'))
  assert.ok(sans.indexOf('Velin Inter') < sans.indexOf('system-ui'))
  assert.ok(sans.indexOf('Velin Han Sans') < sans.indexOf('system-ui'))
  assert.doesNotMatch(tokens.match(/--font-mono:([^;]+);/)![1], /Inter/)
  assert.match(tokens, /font-optical-sizing: auto/)
})
