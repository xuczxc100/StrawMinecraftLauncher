import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  SMCL_EVENTS,
  SMCL_INVOKE_CHANNELS,
  type SmclBridge,
  type SmclChannel,
  type SmclEvent,
  type SmclResponse,
} from '@shared/ipc'

const allowedChannels = new Set<string>(SMCL_INVOKE_CHANNELS)
const allowedEvents = new Set<string>(SMCL_EVENTS)

class SmclInvokeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SmclInvokeError'
  }
}

const bridge: SmclBridge = {
  async invoke(channel: SmclChannel, ...args: unknown[]) {
    if (!allowedChannels.has(channel)) throw new Error(`Unknown channel ${channel}`)
    const response = (await ipcRenderer.invoke(channel, ...args)) as SmclResponse<never>
    if (response.ok) return response.data
    throw new SmclInvokeError(response.error.code, response.error.message)
  },
  on(event: SmclEvent, listener: (payload: unknown) => void) {
    if (!allowedEvents.has(event)) throw new Error(`Unknown event ${event}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.off(event, wrapped)
  },
} as SmclBridge

contextBridge.exposeInMainWorld('smcl', bridge)
