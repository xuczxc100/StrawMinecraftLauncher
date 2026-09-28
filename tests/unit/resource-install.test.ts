import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceVersion } from '@shared/types'
import { fabricModJar, fileServer, sha1 } from './fixtures'
import { testContext } from './helpers'

function modVersion(projectId: string, versionId: string, url: string, body: Buffer, deps: ResourceVersion['dependencies'] = []): ResourceVersion {
  return {
    source: 'modrinth',
    projectId,
    versionId,
    name: `${projectId} ${versionId}`,
    versionNumber: versionId,
    gameVersions: ['1.20.1'],
    loaders: ['fabric'],
    releaseType: 'release',
    published: '2024-01-01',
    files: [{ filename: `${projectId}-${versionId}.jar`, url, size: body.length, sha1: sha1(body), primary: true }],
    dependencies: deps,
  }
}

async function setup() {
  const ctx = await testContext()
  const inst = await ctx.instances.create({ name: 'Fabric', minecraft: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0' })
  const coolV1 = await fabricModJar('coolmod', '1.0.0', 'Cool Mod')
  const coolV2 = await fabricModJar('coolmod', '2.0.0', 'Cool Mod')
  const lib = await fabricModJar('corelib', '1.0.0', 'Core Lib')
  const server = await fileServer({ '/cool-1.jar': coolV1, '/cool-2.jar': coolV2, '/lib.jar': lib, '/corrupt.jar': Buffer.from('nope') })
  const versions: Record<string, ResourceVersion> = {
    'cool@1': modVersion('cool', '1', server.url('/cool-1.jar'), coolV1, [{ projectId: 'lib', type: 'required' }]),
    'cool@2': modVersion('cool', '2', server.url('/cool-2.jar'), coolV2, [{ projectId: 'lib', type: 'required' }]),
    'lib@1': modVersion('lib', '1', server.url('/lib.jar'), lib),
  }
  const modrinth = ctx.resources.modrinth
  const versionsSpy = vi.spyOn(modrinth, 'versions').mockImplementation(async (id) => (id === 'lib' ? [versions['lib@1']] : [versions['cool@2']]))
  vi.spyOn(modrinth, 'version').mockImplementation(async (id, vid) => versions[`${id}@${vid}`])
  vi.spyOn(modrinth, 'titles').mockResolvedValue({ cool: { title: 'Cool Mod', kind: 'mod' }, lib: { title: 'Core Lib', kind: 'mod' } })
  return { ctx, inst, versions, server, versionsSpy }
}

describe('ResourceService install/manage', () => {
  it('installs a mod with its required dependency, filtered by instance version and loader', async () => {
    const { ctx, inst, versionsSpy } = await setup()
    const result = await ctx.resources.install(inst.id, 'mod', 'modrinth', 'cool', '1')
    expect(result.installed.map((i) => i.projectId)).toEqual(['cool', 'lib'])
    expect(versionsSpy).toHaveBeenCalledWith('lib', 'mod', { gameVersion: '1.20.1', loader: 'fabric' }, expect.anything())
    const local = await ctx.resources.listLocal(inst.id, 'mod')
    expect(local.map((m) => [m.name, m.version, m.origin?.projectId])).toEqual([
      ['Cool Mod', '1.0.0', 'cool'],
      ['Core Lib', '1.0.0', 'lib'],
    ])
  })

  it('replaces the previous version of the same project on update and skips installed deps', async () => {
    const { ctx, inst, server } = await setup()
    await ctx.resources.install(inst.id, 'mod', 'modrinth', 'cool', '1')
    const before = server.hits.filter((h) => h === '/lib.jar').length
    const result = await ctx.resources.install(inst.id, 'mod', 'modrinth', 'cool')
    expect(result.installed.map((i) => i.fileName)).toEqual(['cool-2.jar'])
    expect(server.hits.filter((h) => h === '/lib.jar').length).toBe(before)
    const files = await readdir(ctx.resources.dir(inst.id, 'mod'))
    expect(files.sort()).toEqual(['cool-2.jar', 'lib-1.jar'])
  })

  it('rejects files whose sha1 does not match and leaves no partial file', async () => {
    const { ctx, inst, versions, server } = await setup()
    vi.spyOn(ctx.resources.modrinth, 'version').mockResolvedValue({
      ...versions['lib@1'],
      files: [{ ...versions['lib@1'].files[0], url: server.url('/corrupt.jar'), size: 4 }],
    })
    await expect(ctx.resources.install(inst.id, 'mod', 'modrinth', 'lib', '1')).rejects.toMatchObject({ code: 'ChecksumMismatch' })
    expect(await readdir(ctx.resources.dir(inst.id, 'mod'))).toEqual([])
  })

  it('skips files without a download url instead of bypassing author restrictions', async () => {
    const { ctx, inst, versions } = await setup()
    vi.spyOn(ctx.resources.modrinth, 'version').mockResolvedValue({ ...versions['lib@1'], files: [{ ...versions['lib@1'].files[0], url: undefined }] })
    const result = await ctx.resources.install(inst.id, 'mod', 'modrinth', 'lib', '1')
    expect(result.installed).toEqual([])
    expect(result.skipped[0].reason).toMatch(/third-party/)
  })

  it('toggles and deletes local files, keeping origin metadata across toggles', async () => {
    const { ctx, inst } = await setup()
    await ctx.resources.install(inst.id, 'mod', 'modrinth', 'cool', '1')
    let list = await ctx.resources.toggle(inst.id, 'mod', 'cool-1.jar', false)
    const disabled = list.find((m) => m.fileName === 'cool-1.jar.disabled')!
    expect(disabled.enabled).toBe(false)
    expect(disabled.origin?.projectId).toBe('cool')
    list = await ctx.resources.toggle(inst.id, 'mod', 'cool-1.jar.disabled', true)
    expect(list.find((m) => m.fileName === 'cool-1.jar')?.enabled).toBe(true)
    list = await ctx.resources.remove(inst.id, 'mod', 'cool-1.jar')
    expect(list.map((m) => m.fileName)).toEqual(['lib-1.jar'])
    expect(Object.keys(await ctx.resources.readMeta(inst.id))).toEqual(['mod/lib-1.jar'])
  })

  it('refuses path traversal in file names', async () => {
    const { ctx, inst } = await setup()
    await writeFile(join(ctx.instances.dir(inst.id), 'secret.txt'), 'x')
    await expect(ctx.resources.remove(inst.id, 'mod', '../secret.txt')).rejects.toMatchObject({ code: 'UnsafePath' })
  })

  it('requires a CurseForge key before using CurseForge', async () => {
    const { ctx } = await setup()
    expect(() => ctx.resources.provider('curseforge')).toThrow(expect.objectContaining({ code: 'CurseforgeNotConfigured' }))
    await ctx.config.set({ curseforgeApiKey: 'k' })
    expect(ctx.resources.provider('curseforge').source).toBe('curseforge')
  })
})
