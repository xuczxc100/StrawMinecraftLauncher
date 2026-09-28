import { describe, expect, it } from 'vitest'
import { ensureInstance, integrationContext } from './shared'

const FABRIC_API = 'P7dR8mSH'

describe('Modrinth (network)', () => {
  it('searches, installs Fabric API for a Fabric 1.20.1 instance and parses it with mod-parser', async () => {
    const ctx = await integrationContext()
    const [loader] = await ctx.install.listLoaders('fabric', '1.20.1')
    const inst = await ensureInstance(ctx, 'IT Fabric', { minecraft: '1.20.1', loader: 'fabric', loaderVersion: loader })

    const search = await ctx.resources.search({
      source: 'modrinth',
      kind: 'mod',
      query: 'fabric api',
      gameVersion: '1.20.1',
      loader: 'fabric',
      sort: 'relevance',
      offset: 0,
      limit: 10,
    })
    const hit = search.hits.find((h) => h.projectId === FABRIC_API)
    expect(hit?.slug).toBe('fabric-api')

    const versions = await ctx.resources.versions('modrinth', FABRIC_API, { gameVersion: '1.20.1', loader: 'fabric' })
    expect(versions.length).toBeGreaterThan(0)
    expect(versions.every((v) => v.gameVersions.includes('1.20.1') && v.loaders.includes('fabric'))).toBe(true)

    const result = await ctx.resources.install(inst.id, 'mod', 'modrinth', FABRIC_API)
    expect(result.installed[0].projectId).toBe(FABRIC_API)
    const local = await ctx.resources.listLocal(inst.id, 'mod')
    const mod = local.find((m) => m.origin?.projectId === FABRIC_API)
    expect(mod).toMatchObject({ modId: 'fabric-api', loaders: ['fabric'], enabled: true })
    expect(mod?.version).toMatch(/\+1\.20\.1$/)
  })

  it('filters resource packs by game version only', async () => {
    const ctx = await integrationContext()
    const res = await ctx.resources.search({ source: 'modrinth', kind: 'resourcepack', query: '', gameVersion: '1.20.1', sort: 'downloads', offset: 0, limit: 5 })
    expect(res.hits.length).toBe(5)
    expect(res.total).toBeGreaterThan(100)
  })
})
