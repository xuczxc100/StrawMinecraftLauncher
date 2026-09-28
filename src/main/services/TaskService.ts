import { randomUUID } from 'node:crypto'
import type { TaskInfo } from '@shared/types'
import { errorMessage, SmclError } from '../util/errors'
import type { EventBus } from '../util/events'

interface ProgressSource {
  readonly progress: number
  readonly total: number
}

const EMIT_INTERVAL_MS = 200

export class TaskHandle {
  readonly controller = new AbortController()
  private source?: { tracker: ProgressSource; expected: number }
  private timer?: NodeJS.Timeout
  private lastEmit = 0

  constructor(
    readonly info: TaskInfo,
    private readonly emit: (info: TaskInfo) => void,
  ) {}

  get id() {
    return this.info.id
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  setDetail(detail: string) {
    this.info.detail = detail
    this.flush(true)
  }

  update(progress: number, total: number, unit: TaskInfo['unit'] = this.info.unit) {
    this.info.progress = progress
    this.info.total = total
    this.info.unit = unit
    this.flush()
  }

  /** Poll a download tracker (bytes) until `untrack` or task end. */
  track(tracker: ProgressSource, expectedBytes = 0) {
    this.source = { tracker, expected: expectedBytes }
    this.info.unit = 'bytes'
    this.stopTimer()
    this.timer = setInterval(() => this.pull(), EMIT_INTERVAL_MS)
  }

  untrack() {
    this.pull()
    this.stopTimer()
    this.source = undefined
  }

  throwIfCancelled() {
    if (this.signal.aborted) throw new SmclError('Cancelled', 'Task cancelled')
  }

  finish(status: 'success' | 'failed' | 'cancelled', error?: unknown) {
    if (this.info.status !== 'running') return
    this.pull()
    this.stopTimer()
    this.info.status = status
    this.info.endedAt = Date.now()
    if (status === 'success' && this.info.total > 0) this.info.progress = this.info.total
    if (error !== undefined) this.info.error = errorMessage(error)
    this.flush(true)
  }

  private pull() {
    if (!this.source) return
    const { tracker, expected } = this.source
    this.info.progress = tracker.progress
    this.info.total = Math.max(tracker.total, expected, tracker.progress)
    this.flush()
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private flush(force = false) {
    const now = Date.now()
    if (!force && now - this.lastEmit < EMIT_INTERVAL_MS) return
    this.lastEmit = now
    this.emit({ ...this.info })
  }
}

export class TaskService {
  private readonly tasks = new Map<string, TaskHandle>()

  constructor(private readonly bus: EventBus) {}

  create(title: string, detail?: string): TaskHandle {
    const info: TaskInfo = {
      id: randomUUID(),
      title,
      detail,
      status: 'running',
      progress: 0,
      total: 0,
      unit: 'none',
      startedAt: Date.now(),
    }
    const handle = new TaskHandle(info, (snapshot) => this.bus.emit('task:update', snapshot))
    this.tasks.set(info.id, handle)
    this.bus.emit('task:update', { ...info })
    return handle
  }

  /** Run `fn` as a task; status is set from the outcome and errors are rethrown. */
  async run<T>(title: string, fn: (task: TaskHandle) => Promise<T>, detail?: string): Promise<T> {
    const task = this.create(title, detail)
    try {
      const result = await fn(task)
      task.finish('success')
      return result
    } catch (e) {
      task.finish(task.signal.aborted ? 'cancelled' : 'failed', e)
      if (task.signal.aborted && !(e instanceof SmclError && e.code === 'Cancelled')) {
        throw new SmclError('Cancelled', 'Task cancelled', { cause: e })
      }
      throw e
    }
  }

  list(): TaskInfo[] {
    return [...this.tasks.values()].map((t) => ({ ...t.info })).sort((a, b) => b.startedAt - a.startedAt)
  }

  cancel(id: string) {
    const task = this.tasks.get(id)
    if (task && task.info.status === 'running') task.controller.abort()
  }

  clearFinished() {
    for (const [id, task] of this.tasks) {
      if (task.info.status !== 'running') this.tasks.delete(id)
    }
  }
}
