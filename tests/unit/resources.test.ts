import { describe, expect, it } from 'vitest'
import type { ResourceVersion } from '@shared/types'
import {
  compatibleLoaders,
  curseforgeKind,
  mapCurseforgeFile,
  mapModrinthHit,
  mapModrinthVersion,
  modrinthFacets,
} from '../../src/main/services/resourceProviders'
import { metaKey, planInstall } from '../../src/main/services/ResourceService'

const version = (projectId: string, deps: ResourceVersion['dependencies'] = []): ResourceVersion => ({
  source: 'modrinth',
  projectId,
  versionId: `${projectId}-v1`,
  name: projectId,
  versionNumber: '1.0.0',
  gameVersions: ['1.20.1'],
  loaders: ['fabric'],
  releaseType: 'release',
  published: '2024-01-01T00:00:00Z',
  files: [{ filename: `${projectId}.jar`, url: `https://cdn/${projectId}.jar`, size: 1, primary: true }],
  dependencies: deps,
})

describe('planInstall (dependency resolution)', () => {
  it('walks required dependencies breadth-first, skipping optional and installed ones', async () => {
    const graph: Record<string, ResourceVersion> = {
      b: version('b', [{ projectId: 'd', type: 'required' }]),
      c: version('c'),
      d: version('d', [{ projectId: 'a', type: 'required' }]),
    }
    const root = version('a', [
      { projectId: 'b', type: 'required' },
      { projectId: 'c', type: 'required' },
      { projectId: 'opt', type: 'optional' },
      { projectId: 'installed', type: 'required' },
      { projectId: 'bad', type: 'incompatible' },
    ])
    const best = async (id: string) => graph[id]
    const plan = await planInstall(root, new Set(['installed']), { best, pinned: async () => version('never') })
    expect(plan.install.map((v) => v.projectId)).toEqual(['a', 'b', 'c', 'd'])
    expect(plan.skipped).toEqual([])
  })

  it('honours pinned dependency versions and reports unresolvable ones', async () => {
    const pinnedCalls: string[] = []
    const root = version('a', [
      { projectId: 'lib', versionId: 'lib-3', type: 'required' },
      { projectId: 'missing', type: 'required' },
    ])
    const plan = await planInstall(root, new Set(), {
      pinned: async (id, v) => {
        pinnedCalls.push(`${id}@${v}`)
        return { ...version(id), versionId: v }
      },
      best: async () => undefined,
    })
    expect(pinnedCalls).toEqual(['lib@lib-3'])
    expect(plan.install.map((v) => v.versionId)).toEqual(['a-v1', 'lib-3'])
    expect(plan.skipped).toEqual([{ projectId: 'missing', reason: 'No compatible version' }])
  })

  it('metaKey ignores the .disabled suffix so toggled files keep their origin', () => {
    expect(metaKey('mod', 'sodium.jar.disabled')).toBe(metaKey('mod', 'sodium.jar'))
  })
})

describe('Modrinth mapping', () => {
  it('lets Quilt instances use Fabric mods', () => {
    expect(compatibleLoaders('quilt')).toEqual(['quilt', 'fabric'])
    expect(compatibleLoaders('vanilla')).toEqual([])
  })

  it('builds facets: loader filter only for mods and modpacks', () => {
    expect(JSON.parse(modrinthFacets({ kind: 'mod', gameVersion: '1.20.1', loader: 'fabric' }))).toEqual([
      ['project_type:mod'],
      ['versions:1.20.1'],
      ['categories:fabric'],
    ])
    expect(JSON.parse(modrinthFacets({ kind: 'resourcepack', gameVersion: '1.20.1', loader: 'fabric' }))).toEqual([
      ['project_type:resourcepack'],
      ['versions:1.20.1'],
    ])
  })

  it('maps hits and versions', () => {
    const hit = mapModrinthHit({
      project_id: 'P7dR8mSH',
      slug: 'fabric-api',
      title: 'Fabric API',
      description: 'Core API',
      author: 'modmuss50',
      icon_url: '',
      downloads: 100,
      categories: ['library'],
      project_type: 'mod',
    } as never)
    expect(hit).toMatchObject({ source: 'modrinth', projectId: 'P7dR8mSH', pageUrl: 'https://modrinth.com/mod/fabric-api', iconUrl: undefined })
    const v = mapModrinthVersion({
      id: 'v1',
      project_id: 'P7dR8mSH',
      name: 'Fabric API 0.92',
      version_number: '0.92.0',
      game_versions: ['1.20.1'],
      loaders: ['fabric'],
      version_type: 'beta',
      date_published: '2024-01-01',
      files: [{ filename: 'fabric-api.jar', url: 'https://cdn.modrinth.com/x.jar', size: 10, primary: true, hashes: { sha1: 'abc' } }],
      dependencies: [{ project_id: 'dep', version_id: null, dependency_type: 'required' }, { project_id: null, dependency_type: 'embedded' }],
    } as never)
    expect(v.releaseType).toBe('beta')
    expect(v.files[0]).toMatchObject({ sha1: 'abc', primary: true })
    expect(v.dependencies).toEqual([{ projectId: 'dep', versionId: undefined, type: 'required' }])
  })
})

describe('CurseForge mapping', () => {
  it('keeps downloadUrl null as missing (author disallows third-party downloads)', () => {
    const v = mapCurseforgeFile({
      id: 5,
      modId: 42,
      displayName: 'JEI 15',
      fileName: 'jei.jar',
      releaseType: 2,
      fileDate: '2024-01-01',
      fileLength: 99,
      downloadUrl: null,
      gameVersions: ['1.20.1', 'Forge', 'Client'],
      hashes: [{ algo: 1, value: 'sha' }],
      dependencies: [{ modId: 7, relationType: 3 }, { modId: 8, relationType: 2 }, { modId: 9, relationType: 4 }],
    } as never)
    expect(v.files[0].url).toBeUndefined()
    expect(v.files[0].sha1).toBe('sha')
    expect(v.gameVersions).toEqual(['1.20.1'])
    expect(v.loaders).toEqual(['forge'])
    expect(v.releaseType).toBe('beta')
    expect(v.dependencies).toEqual([
      { projectId: '7', type: 'required' },
      { projectId: '8', type: 'optional' },
    ])
  })

  it('maps class ids to resource kinds', () => {
    expect(curseforgeKind(12)).toBe('resourcepack')
    expect(curseforgeKind(6552)).toBe('shader')
    expect(curseforgeKind(null)).toBe('mod')
    expect(curseforgeKind(99999)).toBe('mod')
  })
})
