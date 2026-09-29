import type { VelinApi } from './shared/velin-api'

declare global {
  interface Window {
    velin: VelinApi
  }
}

export {}
