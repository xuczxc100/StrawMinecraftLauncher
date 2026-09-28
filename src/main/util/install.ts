import {
  createDefaultNodeInstallRuntime,
  executeInstallManifest,
  executeInstallWorkflow,
  ProgressTrackerMultiple,
  type InstallManifest,
  type InstallWorkflow,
} from '@xmcl/installer'
import type { TaskHandle } from '../services/TaskService'

export interface InstallExecContext {
  task: TaskHandle
  concurrency: number
}

function expectedBytes(plan: InstallManifest): number {
  let total = 0
  for (const t of plan.tasks) {
    if (t.type === 'files') for (const f of t.files) total += f.size ?? 0
  }
  return total
}

function makeRuntime(ctx: InstallExecContext, tracker: ProgressTrackerMultiple) {
  return createDefaultNodeInstallRuntime({
    signal: ctx.task.signal,
    tracker,
    maxConcurrency: ctx.concurrency,
  })
}

/** Execute one manifest while mirroring byte progress into the task. */
export async function runManifest(ctx: InstallExecContext, plan: InstallManifest, detail?: string) {
  ctx.task.throwIfCancelled()
  if (detail) ctx.task.setDetail(detail)
  const tracker = new ProgressTrackerMultiple()
  ctx.task.track(tracker, expectedBytes(plan))
  try {
    return await executeInstallManifest(plan, makeRuntime(ctx, tracker), { signal: ctx.task.signal })
  } finally {
    ctx.task.untrack()
  }
}

/** Execute a multi-stage workflow; each stage gets a fresh tracker. */
export async function runWorkflow<T>(ctx: InstallExecContext, workflow: InstallWorkflow<T>, detail?: string): Promise<T> {
  ctx.task.throwIfCancelled()
  if (detail) ctx.task.setDetail(detail)
  const tracker = new ProgressTrackerMultiple()
  ctx.task.track(tracker)
  try {
    return await executeInstallWorkflow(workflow, makeRuntime(ctx, tracker), {
      signal: ctx.task.signal,
      onEvent: (event) => {
        if (event.type === 'task-start' && event.task.type === 'files') {
          ctx.task.track(tracker, expectedBytes({ schemaVersion: 1, tasks: [event.task] }))
        }
      },
    })
  } finally {
    ctx.task.untrack()
  }
}
