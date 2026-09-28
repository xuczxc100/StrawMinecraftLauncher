import type { SmclBridge } from '../shared/ipc'

declare global {
  interface Window {
    smcl: SmclBridge
  }
}

export {}
