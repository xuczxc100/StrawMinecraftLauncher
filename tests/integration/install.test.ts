import { existsSync } from 'node:fs'
import { MinecraftFolder, Version } from '@xmcl/core'
import { diagnoseInstallation } from '@xmcl/installer'
import { describe, expect, it } from 'vitest'
import { ensureInstance, integrationContext } from './shared'

const MC = '1.20.1'

async function diagnose(ctx: Awaited<ReturnType<typeof integrationContext>>, versionId: string) {
  const resolved = await Version.parse(MinecraftFolder.from(ctx.paths.minecraft), versionId)
  return { resolved, issue: await diagnoseInstallation(resolved) }
}

describe('real installs (network)', () => {
  it(`installs vanilla ${MC} with no missing files`, async () => {
    const ctx = await integrationContext()
    const inst = await ensureInstance(ctx, 'IT Vanilla', { minecraft: MC, loader: 'vanilla' })
    const installed = await ctx.install.installInstance(inst.id)
    expect(installed.versionId).toBe(MC)
    const { resolved, issue } = await diagnose(ctx, MC)
    expect(issue).toBeUndefined()
    expect(resolved.javaVersion.majorVersion).toBe(17)
  })

  it(`installs Fabric for ${MC} with no missing files`, async () => {
    const ctx = await integrationContext()
    const loaders = await ctx.install.listLoaders('fabric', MC)
    expect(loaders.length).toBeGreaterThan(10)
    const inst = await ensureInstance(ctx, 'IT Fabric', { minecraft: MC, loader: 'fabric', loaderVersion: loaders[0] })
    const installed = await ctx.install.installInstance(inst.id)
    expect(installed.versionId).toContain('fabric')
    const { resolved, issue } = await diagnose(ctx, installed.versionId!)
    expect(issue).toBeUndefined()
    expect(resolved.libraries.some((l) => l.name.startsWith('net.fabricmc:fabric-loader'))).toBe(true)
    expect(resolved.mainClass).toContain('fabricmc')
  })

  it('lists loader versions for Forge, NeoForge and Quilt', async () => {
    const ctx = await integrationContext()
    const forge = await ctx.install.listLoaders('forge', MC)
    expect(forge[0]).toMatch(/^47\./)
    const neo = await ctx.install.listLoaders('neoforge', '1.21.1')
    expect(neo.length).toBeGreaterThan(0)
    expect(neo.every((v) => v.startsWith('21.1.'))).toBe(true)
    const neoLegacy = await ctx.install.listLoaders('neoforge', MC)
    expect(neoLegacy.every((v) => v.startsWith('1.20.1-'))).toBe(true)
    const quilt = await ctx.install.listLoaders('quilt', MC)
    expect(quilt.length).toBeGreaterThan(0)
  })

  it.runIf(process.env.SMCL_INTEGRATION_FORGE === '1')(`installs Forge for ${MC} (runs installer processors)`, async () => {
    const ctx = await integrationContext()
    const [latest] = await ctx.install.listLoaders('forge', MC)
    const inst = await ensureInstance(ctx, 'IT Forge', { minecraft: MC, loader: 'forge', loaderVersion: latest })
    const installed = await ctx.install.installInstance(inst.id)
    expect(installed.versionId).toContain('forge')
    const { issue } = await diagnose(ctx, installed.versionId!)
    expect(issue).toBeUndefined()
  })

  it('downloads a Mojang Java runtime into the SMCL folder', async () => {
    const ctx = await integrationContext()
    const java = await ctx.java.install(17)
    expect(java.majorVersion).toBe(17)
    expect(java.source).toBe('managed')
    expect(java.path.startsWith(ctx.paths.javaRuntimes)).toBe(true)
    expect(existsSync(java.path)).toBe(true)
  })
})
