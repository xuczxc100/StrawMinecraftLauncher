import { EventEmitter } from 'node:events'
import type { SmclEvent, SmclEvents } from '@shared/ipc'

/** In-process event bus; the IPC layer forwards every event to all renderer windows. */
export class EventBus {
  private readonly emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(50)
  }

  emit<E extends SmclEvent>(event: E, payload: SmclEvents[E]): void {
    this.emitter.emit(event, payload)
    this.emitter.emit('*', event, payload)
  }

  on<E extends SmclEvent>(event: E, listener: (payload: SmclEvents[E]) => void): () => void {
    this.emitter.on(event, listener)
    return () => this.emitter.off(event, listener)
  }

  onAny(listener: (event: SmclEvent, payload: unknown) => void): () => void {
    this.emitter.on('*', listener)
    return () => this.emitter.off('*', listener)
  }
}
