import type { VelinApi } from '@velin/contracts/velin-api'

declare global {
  interface Window {
    velin: VelinApi
  }
}

export {}
