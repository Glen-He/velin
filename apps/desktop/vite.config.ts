import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import { randomBytes } from 'node:crypto'

const electronOutput = '**/dist-electron/**'

// 某些基于 Electron 的 IDE 终端会注入此变量；否则插件会把 Electron 解析为 Node。
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig(({ command }) => {
  const developmentNonce =
    command === 'serve' ? randomBytes(16).toString('base64') : undefined

  return {
    html: { cspNonce: developmentNonce },
    server: {
      port: 5173,
      strictPort: true,
      headers: { 'Content-Security-Policy': "frame-ancestors 'none'" },
      watch: {
        ignored: [electronOutput, '**/apps/*/dist/**', '**/.review.local/**'],
      },
    },
    plugins: [
      {
        name: 'velin:development-csp',
        apply: 'serve',
        transformIndexHtml: {
          order: 'pre',
          handler(html, context) {
            const serverUrl = context.server?.resolvedUrls?.local[0]
            if (!serverUrl || !developmentNonce) {
              throw new Error('Development CSP requires a running Vite server.')
            }
            const websocketUrl = new URL(serverUrl)
            websocketUrl.protocol =
              websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
            // 仅开发服务放行 HMR 与 React 的带 nonce 前导脚本；任何 build mode 均保持严格策略。
            return html
              .replace(
                "script-src 'self'",
                `script-src 'self' 'nonce-${developmentNonce}'`,
              )
              .replace(
                "connect-src 'self'",
                `connect-src 'self' ${websocketUrl.origin}`,
              )
          },
        },
      },
      react(),
      electron({
        main: {
          entry: 'src/main/index.ts',
          vite: {
            build: {
              rolldownOptions: { output: { entryFileNames: 'main.js' } },
              watch: command === 'serve' ? { exclude: electronOutput } : null,
            },
          },
          async onstart({ startup }) {
            const environment = { ...process.env }
            delete environment.ELECTRON_RUN_AS_NODE
            // 插件默认添加 --no-sandbox；开发环境也必须保留 Chromium 沙箱。
            await startup(['.'], { env: environment })
          },
        },
        preload: {
          input: 'src/preload/index.ts',
          vite: {
            build: {
              rolldownOptions: {
                output: { format: 'cjs', entryFileNames: 'preload.cjs' },
              },
              watch: command === 'serve' ? { exclude: electronOutput } : null,
            },
          },
        },
      }),
    ],
  }
})
