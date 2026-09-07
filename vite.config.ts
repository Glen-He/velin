import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

// 某些基于 Electron 的 IDE 终端会注入此变量；否则插件会把 Electron 解析为 Node。
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  server: {
    strictPort: true,
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        async onstart({ startup }) {
          const environment = { ...process.env }
          delete environment.ELECTRON_RUN_AS_NODE
          await startup(undefined, { env: environment })
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
