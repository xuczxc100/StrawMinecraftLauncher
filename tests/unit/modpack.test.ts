import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { open, readAllEntries, readEntry } from '@xmcl/unzip'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceVersion } from '@shared/types'
import {
  curseforgeInstanceInput,
  mrpackInstanceInput,
  parseMrpackIndex,
  type MrpackIndex,
} from '../../src/main/services/ModpackService'
import type { SmclContext } from '../../src/main/context'
import { fabricModJar, fileServer, sha1, zipBuffer } from './fixtures'
import { tempDir, testContext } from './helpers'

async function readZip(file: string) {
  const zip = await open(file)
  const entries = await readAllEntries(zip)
  const out: Record<string, string> = {}
  for (const e of entries) if (!e.fileName.endsWith('/')) out[e.fileName] = (await readEntry(zip, e)).toString('utf8')
  zip.close()
  return out
}

function fakeInstall(ctx: SmclContext) {
  return vi.spyOn(ctx.install, 'installInstance').mockImplementation(async (id) => ctx.instances.update(id, { versionId: 'installed' }))
}

describe('modpack formats', () => {
  it('validates modrinth.index.json', () => {
    expect(() => parseMrpackIndex({ formatVersion: 2, game: 'minecraft' })).toThrow(expect.objectContaining({ code: 'InvalidModpack' }))
    expect(() => parseMrpackIndex({ formatVersion: 1, game: 'minecraft', dependencies: {}, files: [] })).toThrow()
  })

  it('maps mrpack dependencies to an instance', () => {
    const base = { formatVersion: 1 as const, game: 'minecraft' as const, versionId: '1', name: 'P', files: [] }
    expect(mrpackInstanceInput({ ...base, dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.0' } })).toEqual({
      name: 'P',
      minecraft: '1.20.1',
      loader: 'fabric',
      loaderVersion: '0.16.0',
    })
    expect(mrpackInstanceInput({ ...base, dependencies: { minecraft: '1.21.1', neoforge: '21.1.77' } }).loader).toBe('neoforge')
    expect(mrpackInstanceInput({ ...base, dependencies: { minecraft: '1.20.1', 'quilt-loader': '0.26.0' } }).loader).toBe('quilt')
    expect(mrpackInstanceInput({ ...base, dependencies: { minecraft: '1.20.1' } }).loader).toBe('vanilla')
  })

  it('maps CurseForge manifest loaders', () => {
    const m = (id: string) => ({ minecraft: { version: '1.20.1', modLoaders: [{ id, primary: true }] }, name: 'CF', files: [] })
    expect(curseforgeInstanceInput(m('forge-47.2.0'))).toMatchObject({ loader: 'forge', loaderVersion: '47.2.0' })
    expect(curseforgeInstanceInput(m('neoforge-21.1.77'))).toMatchObject({ loader: 'neoforge', loaderVersion: '21.1.77' })
    expect(curseforgeInstanceInput(m('fabric-0.16.0'))).toMatchObject({ loader: 'fabric', loaderVersion: '0.16.0' })
    expect(() => curseforgeInstanceInput(m('rift-1.0'))).toThrow(expect.objectContaining({ code: 'InvalidModpack' }))
  })
})

describe('mrpack export → import round trip', () => {
  it('exports Modrinth-known files as downloads, the rest as overrides, and re-imports identically', async () => {
    const ctx = await testContext()
    const src = await ctx.instances.create({ name: 'Round Trip', minecraft: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0' })
    const dir = ctx.instances.dir(src.id)
    const known = await fabricModJar('known', '1.0.0')
    const unknown = await fabricModJar('unknown', '1.0.0')
    const server = await fileServer({ '/known.jar': known })
    await writeFile(join(dir, 'mods/known.jar'), known)
    await writeFile(join(dir, 'mods/unknown.jar'), unknown)
    await writeFile(join(dir, 'mods/off.jar.disabled'), 'disabled')
    await writeFile(join(dir, 'config/test.json'), '{"a":1}')
    await mkdir(join(dir, 'saves/World'), { recursive: true })
    await writeFile(join(dir, 'saves/World/level.dat'), 'save')

    const match: ResourceVersion = {
      source: 'modrinth',
      projectId: 'known',
      versionId: 'k1',
      name: 'Known',
      versionNumber: '1.0.0',
      gameVersions: ['1.20.1'],
      loaders: ['fabric'],
      releaseType: 'release',
      published: '',
      files: [{ filename: 'known.jar', url: server.url('/known.jar'), size: known.length, sha1: sha1(known), primary: true }],
      dependencies: [],
    }
    const bySha = vi.spyOn(ctx.resources.modrinth, 'versionsBySha1').mockResolvedValue({ [sha1(known)]: match })

    const destination = join(await tempDir(), 'pack.mrpack')
    await ctx.modpacks.exportMrpack(src.id, { name: 'Round Trip', version: '1.2.3', include: ['mods', 'config'], destination })
    expect(bySha).toHaveBeenCalled()

    const zip = await readZip(destination)
    const index = JSON.parse(zip['modrinth.index.json']) as MrpackIndex
    expect(index).toMatchObject({ formatVersion: 1, game: 'minecraft', name: 'Round Trip', versionId: '1.2.3' })
    expect(index.dependencies).toEqual({ minecraft: '1.20.1', 'fabric-loader': '0.16.0' })
    expect(index.files.map((f) => [f.path, f.downloads[0]])).toEqual([['mods/known.jar', server.url('/known.jar')]])
    expect(Object.keys(zip).sort()).toEqual(['modrinth.index.json', 'overrides/config/test.json', 'overrides/mods/unknown.jar'])

    const install = fakeInstall(ctx)
    const result = await ctx.modpacks.importFile(destination)
    expect(install).toHaveBeenCalledOnce()
    const imported = result.instance
    expect(imported.id).not.toBe(src.id)
    expect(imported).toMatchObject({ minecraft: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0', modpack: { name: 'Round Trip', version: '1.2.3' } })
    const out = ctx.instances.dir(imported.id)
    expect(await readFile(join(out, 'mods/known.jar'))).toEqual(known)
    expect(await readFile(join(out, 'mods/unknown.jar'))).toEqual(unknown)
    expect(await readFile(join(out, 'config/test.json'), 'utf8')).toBe('{"a":1}')
    expect(server.hits).toContain('/known.jar')
  })

  it('rejects zip entries that escape the instance folder', async () => {
    const ctx = await testContext()
    fakeInstall(ctx)
    const file = join(await tempDir(), 'evil.mrpack')
    const index = { formatVersion: 1, game: 'minecraft', versionId: '1', name: 'Evil', files: [], dependencies: { minecraft: '1.20.1' } }
    // yazl refuses ".." names, so write a same-length placeholder and patch the name bytes afterwards.
    const buf = await zipBuffer({ 'modrinth.index.json': JSON.stringify(index), 'overrides/@@/@@/escape.txt': 'x' })
    await writeFile(file, Buffer.from(buf.toString('latin1').replaceAll('overrides/@@/@@/', 'overrides/../../'), 'latin1'))
    await expect(ctx.modpacks.importFile(file)).rejects.toMatchObject({ code: 'InvalidModpack' })
    expect(ctx.instances.list()).toEqual([])
  })

  it('rejects index file paths that escape the instance folder and removes the half-created instance', async () => {
    const ctx = await testContext()
    fakeInstall(ctx)
    const file = join(await tempDir(), 'evil2.mrpack')
    const index = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: '1',
      name: 'Evil2',
      files: [{ path: '../../evil.jar', hashes: { sha1: 'a' }, downloads: ['http://127.0.0.1:1/x'], fileSize: 1 }],
      dependencies: { minecraft: '1.20.1' },
    }
    await writeFile(file, await zipBuffer({ 'modrinth.index.json': JSON.stringify(index) }))
    await expect(ctx.modpacks.importFile(file)).rejects.toMatchObject({ code: 'UnsafePath' })
    expect(ctx.instances.list()).toEqual([])
  })

  it('reports non-modpack files clearly', async () => {
    const ctx = await testContext()
    const file = join(await tempDir(), 'random.zip')
    await writeFile(file, await zipBuffer({ 'readme.txt': 'hi' }))
    await expect(ctx.modpacks.importFile(file)).rejects.toMatchObject({ code: 'InvalidModpack' })
    await writeFile(file, 'not a zip')
    await expect(ctx.modpacks.importFile(file)).rejects.toMatchObject({ code: 'InvalidModpack' })
  })
})

describe('CurseForge modpack import', () => {
  it('downloads allowed files, records author-restricted files as skipped', async () => {
    const ctx = await testContext()
    await ctx.config.set({ curseforgeApiKey: 'test-key' })
    fakeInstall(ctx)
    const jar = await fabricModJar('cfmod', '1.0.0')
    const server = await fileServer({ '/cfmod.jar': jar })
    const cf = ctx.resources.curseforge()
    vi.spyOn(cf, 'getFiles').mockResolvedValue([
      { id: 1, modId: 10, fileName: 'cfmod.jar', downloadUrl: server.url('/cfmod.jar'), fileLength: jar.length, hashes: [{ algo: 1, value: sha1(jar) }] },
      { id: 2, modId: 20, fileName: 'restricted.jar', downloadUrl: null, fileLength: 1, hashes: [] },
      { id: 3, modId: 30, fileName: 'pack.zip', downloadUrl: server.url('/cfmod.jar'), fileLength: jar.length, hashes: [] },
    ] as never)
    vi.spyOn(cf, 'getMods').mockResolvedValue([
      { id: 10, classId: 6 },
      { id: 20, classId: 6 },
      { id: 30, classId: 12 },
    ] as never)
    const manifest = {
      minecraft: { version: '1.20.1', modLoaders: [{ id: 'fabric-0.16.0', primary: true }] },
      manifestType: 'minecraftModpack',
      name: 'CF Pack',
      version: '2.0',
      files: [
        { projectID: 10, fileID: 1, required: true },
        { projectID: 20, fileID: 2, required: true },
        { projectID: 30, fileID: 3, required: true },
      ],
      overrides: 'overrides',
    }
    const file = join(await tempDir(), 'cf.zip')
    await writeFile(file, await zipBuffer({ 'manifest.json': JSON.stringify(manifest), 'overrides/options.txt': 'lang:zh_tw' }))
    const result = await ctx.modpacks.importFile(file)
    expect(result.skippedFiles).toEqual(['restricted.jar'])
    const out = ctx.instances.dir(result.instance.id)
    expect(await readFile(join(out, 'mods/cfmod.jar'))).toEqual(jar)
    expect(await readFile(join(out, 'resourcepacks/pack.zip'))).toEqual(jar)
    expect(await readFile(join(out, 'options.txt'), 'utf8')).toBe('lang:zh_tw')
    expect(await readFile(join(out, 'SMCL-skipped-files.txt'), 'utf8')).toBe('restricted.jar')
  })
})
