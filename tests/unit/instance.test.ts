import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INSTANCE_SUBDIRS } from '../../src/main/services/InstanceService'
import { testContext } from './helpers'

describe('InstanceService', () => {
  it('creates an isolated game directory with standard sub-folders', async () => {
    const ctx = await testContext()
    const inst = await ctx.instances.create({ name: 'Fabric 1.20.1', minecraft: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0' })
    const dir = ctx.instances.dir(inst.id)
    expect(dir.startsWith(ctx.paths.instances)).toBe(true)
    for (const sub of INSTANCE_SUBDIRS) expect((await stat(join(dir, sub))).isDirectory()).toBe(true)
    const saved = JSON.parse(await readFile(ctx.paths.instanceConfig(inst.id), 'utf8'))
    expect(saved).toMatchObject({ name: 'Fabric 1.20.1', minecraft: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0' })
  })

  it('allocates unique, filesystem-safe ids', async () => {
    const ctx = await testContext()
    const a = await ctx.instances.create({ name: 'My/Pack:1', minecraft: '1.20.1', loader: 'vanilla' })
    const b = await ctx.instances.create({ name: 'My/Pack:1', minecraft: '1.20.1', loader: 'vanilla' })
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toMatch(/[/:]/)
  })

  it('keeps per-instance settings and reloads them from disk', async () => {
    const ctx = await testContext()
    const inst = await ctx.instances.create({ name: 'A', minecraft: '1.20.1', loader: 'vanilla' })
    await ctx.instances.update(inst.id, { maxMemory: 6144, jvmArgs: '-XX:+UseG1GC', server: { host: 'mc.example', port: 25566 } })
    const reloaded = await testContext({ dataRoot: ctx.paths.root })
    expect(reloaded.instances.get(inst.id)).toMatchObject({ maxMemory: 6144, jvmArgs: '-XX:+UseG1GC', server: { host: 'mc.example', port: 25566 } })
  })

  it('clears the installed version id when Minecraft or loader changes', async () => {
    const ctx = await testContext()
    const inst = await ctx.instances.create({ name: 'A', minecraft: '1.20.1', loader: 'vanilla' })
    await ctx.instances.update(inst.id, { versionId: '1.20.1' })
    expect((await ctx.instances.update(inst.id, { maxMemory: 2048 })).versionId).toBe('1.20.1')
    const changed = await ctx.instances.update(inst.id, { loader: 'fabric', loaderVersion: '0.16.0' })
    expect(changed.versionId).toBeUndefined()
  })

  it('validates loader versions and names', async () => {
    const ctx = await testContext()
    await expect(ctx.instances.create({ name: 'x', minecraft: '1.20.1', loader: 'forge' })).rejects.toMatchObject({ code: 'InvalidInstance' })
    await expect(ctx.instances.create({ name: '  ', minecraft: '1.20.1', loader: 'vanilla' })).rejects.toMatchObject({ code: 'InvalidInstance' })
    const inst = await ctx.instances.create({ name: 'A', minecraft: '1.20.1', loader: 'vanilla' })
    await expect(ctx.instances.update(inst.id, { loader: 'quilt' })).rejects.toMatchObject({ code: 'InvalidInstance' })
  })

  it('removes the instance and moves the selection', async () => {
    const ctx = await testContext()
    const a = await ctx.instances.create({ name: 'A', minecraft: '1.20.1', loader: 'vanilla' })
    const b = await ctx.instances.create({ name: 'B', minecraft: '1.20.1', loader: 'vanilla' })
    await ctx.instances.select(a.id)
    await ctx.instances.remove(a.id)
    expect(ctx.instances.list().map((i) => i.id)).toEqual([b.id])
    expect(ctx.config.get().selectedInstanceId).toBe(b.id)
    await expect(stat(ctx.paths.instance(a.id))).rejects.toThrow()
  })
})
