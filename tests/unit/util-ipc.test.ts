import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SMCL_EVENTS, SMCL_INVOKE_CHANNELS } from '@shared/ipc'
import { splitArgs } from '../../src/main/services/LaunchService'
import { TaskService } from '../../src/main/services/TaskService'
import { SmclError, toErrorPayload } from '../../src/main/util/errors'
import { EventBus } from '../../src/main/util/events'
import { safeJoin, sanitizeFileName } from '../../src/main/util/fs'
import { testContext } from './helpers'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(async () => '') },
}))

describe('safeJoin', () => {
  const root = resolve('/data/instances/a')
  it('allows nested relative paths', () => {
    expect(safeJoin(root, 'mods/x.jar')).toBe(resolve(root, 'mods/x.jar'))
    expect(safeJoin(root, 'config\\sub\\a.toml')).toBe(resolve(root, 'config/sub/a.toml'))
  })
  it.each(['../x', 'mods/../../x', '/etc/passwd', 'C:/Windows/x', 'C:\\x', '', '.'])('rejects %j', (p) => {
    expect(() => safeJoin(root, p)).toThrow(expect.objectContaining({ code: 'UnsafePath' }))
  })
})

describe('helpers', () => {
  it('sanitizes instance names', () => {
    expect(sanitizeFileName('a/b:c*?')).toBe('a_b_c__')
    expect(sanitizeFileName('...hidden')).toBe('hidden')
    expect(sanitizeFileName('   ')).toBe('instance')
  })

  it('splits argument strings with quotes', () => {
    expect(splitArgs('-Xss2m "-Dfoo=a b" \'-Dbar=c d\'  --x')).toEqual(['-Xss2m', '-Dfoo=a b', '-Dbar=c d', '--x'])
    expect(splitArgs(undefined)).toEqual([])
  })

  it('serializes errors with codes', () => {
    expect(toErrorPayload(new SmclError('NoAccount', 'x'))).toEqual({ code: 'NoAccount', message: 'x' })
    expect(toErrorPayload(new Error('boom')).message).toBe('boom')
  })
})

describe('TaskService', () => {
  it('emits running → success and failed with error text', async () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.on('task:update', (t) => seen.push(`${t.title}:${t.status}`))
    const tasks = new TaskService(bus)
    await expect(tasks.run('ok', async () => 1)).resolves.toBe(1)
    await expect(tasks.run('bad', async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope')
    expect(seen).toEqual(['ok:running', 'ok:success', 'bad:running', 'bad:failed'])
    expect(tasks.list().find((t) => t.title === 'bad')?.error).toBe('nope')
    tasks.clearFinished()
    expect(tasks.list()).toEqual([])
  })

  it('cancels through the abort signal', async () => {
    const tasks = new TaskService(new EventBus())
    let id = ''
    const run = tasks.run('long', async (task) => {
      id = task.id
      await new Promise((_, reject) => task.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    await new Promise((r) => setTimeout(r, 10))
    tasks.cancel(id)
    await expect(run).rejects.toMatchObject({ code: 'Cancelled' })
    expect(tasks.list()[0].status).toBe('cancelled')
  })
})

describe('IPC contract', () => {
  it('registers exactly one handler per whitelisted channel', async () => {
    const { createHandlers } = await import('../../src/main/ipc')
    const ctx = await testContext()
    const handlers = createHandlers(ctx, () => undefined)
    expect(Object.keys(handlers).sort()).toEqual([...SMCL_INVOKE_CHANNELS].sort())
    expect(new Set(SMCL_INVOKE_CHANNELS).size).toBe(SMCL_INVOKE_CHANNELS.length)
    expect(SMCL_EVENTS).toContain('task:update')
  })

  it('reports key availability and wires handlers to services', async () => {
    const { createHandlers } = await import('../../src/main/ipc')
    const ctx = await testContext()
    const h = createHandlers(ctx, () => undefined)
    const info = await h['app:info']()
    expect(info).toMatchObject({ name: 'StrawMinecraftLauncher', msLoginAvailable: false, curseforgeAvailable: false })
    await h['config:set']({ curseforgeApiKey: 'x' })
    expect((await h['app:info']()).curseforgeAvailable).toBe(true)
    const inst = await h['instance:create']({ name: 'IPC', minecraft: '1.20.1', loader: 'vanilla' })
    expect((await h['instance:list']()).map((i) => i.id)).toEqual([inst.id])
    await h['account:addOffline']('IpcUser')
    expect((await h['account:list']()).accounts[0].name).toBe('IpcUser')
  })

  it('only opens https links externally', async () => {
    const { createHandlers } = await import('../../src/main/ipc')
    const h = createHandlers(await testContext(), () => undefined)
    await expect(h['shell:openExternal']('file:///etc/passwd')).rejects.toMatchObject({ code: 'BlockedUrl' })
    await expect(h['shell:openExternal']('https://modrinth.com')).resolves.toBeUndefined()
  })
})
