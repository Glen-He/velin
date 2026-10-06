import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync(new URL('../src/themes.css', import.meta.url), 'utf8')
function declarations(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  )
}
const blocks = [...css.matchAll(/:root[^{}]*\{([^{}]*)\}/g)].map((match) =>
  declarations(match[1]),
)

function luminance(hex: string) {
  assert.match(hex, /^#[\da-f]{6}$/i)
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

test('neutral, link and primary text satisfy 4.5:1 on their intended surfaces', () => {
  for (const theme of ['light', 'dark']) {
    const tokens = { ...blocks[0], ...(theme === 'dark' ? blocks[1] : {}) }
    function color(name: string): string {
      const value = tokens[`--${name}`]
      assert.ok(value, name)
      return value.startsWith('var(') ? color(value.slice(6, -1)) : value
    }
    const pairs = [
      ['color-ink', 'color-canvas'],
      ['color-ink', 'color-surface'],
      ['color-secondary', 'color-sidebar'],
      ['color-secondary', 'color-sunken'],
      ['color-blue-text', 'color-blue-soft'],
      ['color-blue-text', 'color-surface'],
      ['color-on-primary', 'color-primary'],
      ['color-on-primary', 'color-ink-hover'],
      ['color-on-accent', 'color-accent-fill'],
      ['color-success-text', 'color-surface'],
    ]
    for (const [foreground, background] of pairs) {
      const [low, high] = [
        luminance(color(foreground)),
        luminance(color(background)),
      ].sort((a, b) => a - b)
      const ratio = (high + 0.05) / (low + 0.05)
      assert.ok(ratio >= 4.5, `${theme} ${foreground}/${background}: ${ratio}`)
    }
  }
})

test('system dark mode and explicit dark mode resolve the same palette', () => {
  assert.deepEqual(blocks[1], blocks[2])
})

test('danger icon hover pairs danger foreground and background without overriding disabled state', () => {
  const panelCss = readFileSync(
    new URL('../src/panel.css', import.meta.url),
    'utf8',
  )
  const hover = panelCss.match(
    /\.panel-icon-action\[data-tone='danger'\]:hover:not\(:disabled\)\s*\{([^}]+)\}/,
  )?.[1]
  assert.ok(hover, 'danger hover must exclude disabled controls')
  assert.match(hover, /background:\s*var\(--color-danger-soft\);/)
  assert.match(hover, /color:\s*var\(--color-danger-text\);/)
  assert.match(
    panelCss,
    /\.panel-icon-action:disabled\s*\{[^}]*color:\s*var\(--color-secondary\);/,
  )
})

test('default danger roles use the Apple system red without darkening', () => {
  assert.equal(blocks[0]['--color-danger'], '#ff383c')
  assert.equal(blocks[0]['--palette-dark-color-danger'], '#ff4245')
  assert.equal(blocks[0]['--color-danger-text'], 'var(--color-danger)')
  assert.equal(blocks[0]['--color-danger-fill'], 'var(--color-danger)')
  assert.equal(
    blocks[0]['--palette-dark-color-danger-text'],
    'var(--palette-dark-color-danger)',
  )
})

test('enhanced contrast danger roles satisfy 4.5:1 on actual surfaces', () => {
  assert.ok(
    css.indexOf('@media (prefers-contrast: more)') >
      css.indexOf('@media (prefers-color-scheme: dark)'),
  )
  assert.deepEqual(blocks[4], blocks[5])
  for (const theme of ['light', 'dark']) {
    const tokens = {
      ...blocks[0],
      ...(theme === 'dark' ? blocks[1] : {}),
      ...blocks[3],
      ...(theme === 'dark' ? blocks[4] : {}),
    }
    function color(name: string): string {
      const value = tokens[`--${name}`]
      assert.ok(value, name)
      return value.startsWith('var(') ? color(value.slice(6, -1)) : value
    }
    for (const [foreground, background] of [
      ['color-danger-text', 'color-danger-soft'],
      ['color-danger-text', 'color-surface'],
      ['color-on-accent', 'color-danger-fill'],
    ]) {
      const [low, high] = [
        luminance(color(foreground)),
        luminance(color(background)),
      ].sort((a, b) => a - b)
      const ratio = (high + 0.05) / (low + 0.05)
      assert.ok(ratio >= 4.5, `${theme} ${foreground}/${background}: ${ratio}`)
    }
  }
})
