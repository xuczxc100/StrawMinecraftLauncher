import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LaunchLogLine, LaunchState } from '@shared/types'
import { ensureInstance, integrationContext } from './shared'

const READY = /Setting user: SmclTester|Backend library: LWJGL|LWJGL version/
const LOG_FILE = resolve(import.meta.dirname, '../../test-results/launch-smoke.log')

describe.runIf(Boolean(process.env.DISPLAY))('offline launch smoke test (xvfb)', () => {
  it('launches vanilla 1.20.1 with an offline account until the game initialises', async () => {
    const ctx = await integrationContext()
    const inst = await ensureInstance(ctx, 'IT Vanilla', { minecraft: '1.20.1', loader: 'vanilla' })
    await ctx.instances.update(inst.id, { maxMemory: 2048, resolution: { width: 854, height: 480, fullscreen: false } })
    const account = await ctx.accounts.addOffline('SmclTester')
    await ctx.accounts.select(account.id)

    const lines: LaunchLogLine[] = []
    const states: LaunchState['status'][] = []
    ctx.bus.on('launch:log', (l) => lines.push(l))
    ctx.bus.on('launch:state', (s) => states.push(s.status))

    const ready = new Promise<string>((res, rej) => {
      const timer = setTimeout(() => rej(new Error('game did not initialise within 240s')), 240_000)
      ctx.bus.on('launch:log', (l) => {
        if (READY.test(l.line)) {
          clearTimeout(timer)
          res(l.line)
        }
      })
      ctx.bus.on('launch:state', (s) => {
        if (s.status === 'crashed' || s.status === 'failed') {
          clearTimeout(timer)
          rej(new Error(`game ${s.status}: ${s.error ?? s.exitCode}`))
        }
      })
    })

    const finalStatus = new Promise<LaunchState['status']>((res) =>
      ctx.bus.on('launch:state', (s) => ['exited', 'crashed'].includes(s.status) && res(s.status)),
    )
    try {
      const state = await ctx.launcher.start(inst.id)
      expect(state.pid).toBeGreaterThan(0)
      const readyLine = await ready
      expect(readyLine).toMatch(READY)
      // give the client a moment to create the GL context before stopping it
      await new Promise((r) => setTimeout(r, 8000))
      expect(ctx.launcher.states().find((s) => s.instanceId === inst.id)?.status).toBe('running')
    } finally {
      await mkdir(resolve(LOG_FILE, '..'), { recursive: true })
      await writeFile(LOG_FILE, lines.map((l) => `[${l.stream}] ${l.line}`).join('\n'))
      ctx.launcher.kill(inst.id)
    }
    expect(await Promise.race([finalStatus, new Promise((r) => setTimeout(() => r('timeout'), 15_000))])).toBe('exited')
    expect(states).toContain('preparing')
    expect(states).toContain('running')
    expect(lines.some((l) => l.stream === 'smcl' && l.line.startsWith('Java '))).toBe(true)
  })
})
