import { isProxy, toRaw } from 'vue'
import type { SmclArgs, SmclChannel, SmclEvent, SmclEvents, SmclResult } from '@shared/ipc'

/**
 * Deep copy that unwraps Vue proxies so IPC structured clone accepts the value.
 * Unlike a JSON round trip it keeps `undefined` properties, which `instance:update` uses to clear fields.
 */
export function toPlain<T>(value: T): T {
  const raw = isProxy(value) ? toRaw(value) : value
  if (Array.isArray(raw)) return raw.map((item) => toPlain(item)) as T
  if (raw && typeof raw === 'object' && Object.getPrototypeOf(raw) === Object.prototype) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, toPlain(v)])) as T
  }
  return raw
}

export function invoke<C extends SmclChannel>(channel: C, ...args: SmclArgs<C>): Promise<SmclResult<C>> {
  return window.smcl.invoke(channel, ...(args.map((a) => toPlain(a)) as SmclArgs<C>))
}

export function on<E extends SmclEvent>(event: E, listener: (payload: SmclEvents[E]) => void): () => void {
  return window.smcl.on(event, listener)
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export function errorCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code
}
