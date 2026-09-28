import { CurseforgeV1Client, type File as CfFile, type Mod as CfMod } from '@xmcl/curseforge'
import { ModrinthV2Client, type ProjectVersion, type SearchResultHit } from '@xmcl/modrinth'
import type {
  DependencyType,
  LoaderType,
  ResourceHit,
  ResourceKind,
  ResourceSearchQuery,
  ResourceSearchResult,
  ResourceSource,
  ResourceVersion,
} from '@shared/types'
import { SmclError } from '../util/errors'

export interface VersionFilter {
  gameVersion?: string
  loader?: LoaderType
}

export interface ResourceProvider {
  readonly source: ResourceSource
  search(query: ResourceSearchQuery, signal?: AbortSignal): Promise<ResourceSearchResult>
  versions(projectId: string, kind: ResourceKind, filter: VersionFilter, signal?: AbortSignal): Promise<ResourceVersion[]>
  version(projectId: string, versionId: string, signal?: AbortSignal): Promise<ResourceVersion>
  titles(projectIds: string[], signal?: AbortSignal): Promise<Record<string, { title: string; kind?: ResourceKind }>>
}

/** Loaders whose mods an instance can load (Quilt also runs Fabric mods). */
export function compatibleLoaders(loader?: LoaderType): string[] {
  switch (loader) {
    case 'fabric':
      return ['fabric']
    case 'quilt':
      return ['quilt', 'fabric']
    case 'forge':
      return ['forge']
    case 'neoforge':
      return ['neoforge']
    default:
      return []
  }
}

// ---------------------------------------------------------------- Modrinth

const MODRINTH_PROJECT_TYPE: Record<ResourceKind, string> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shader: 'shader',
  modpack: 'modpack',
}

export function modrinthFacets(query: Pick<ResourceSearchQuery, 'kind' | 'gameVersion' | 'loader'>): string {
  const facets: string[][] = [[`project_type:${MODRINTH_PROJECT_TYPE[query.kind]}`]]
  if (query.gameVersion) facets.push([`versions:${query.gameVersion}`])
  if (query.kind === 'mod' || query.kind === 'modpack') {
    const loaders = compatibleLoaders(query.loader)
    if (loaders.length) facets.push(loaders.map((l) => `categories:${l}`))
  }
  return JSON.stringify(facets)
}

export function mapModrinthHit(hit: SearchResultHit): ResourceHit {
  const typeSegment = hit.project_type === 'resourcepack' ? 'resourcepack' : hit.project_type
  return {
    source: 'modrinth',
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    author: hit.author,
    iconUrl: hit.icon_url || undefined,
    downloads: hit.downloads,
    categories: hit.categories ?? [],
    pageUrl: `https://modrinth.com/${typeSegment}/${hit.slug}`,
  }
}

export function mapModrinthVersion(v: ProjectVersion): ResourceVersion {
  return {
    source: 'modrinth',
    projectId: v.project_id,
    versionId: v.id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions ?? [],
    loaders: v.loaders ?? [],
    releaseType: v.version_type === 'beta' || v.version_type === 'alpha' ? v.version_type : 'release',
    published: v.date_published,
    files: (v.files ?? []).map((f) => ({
      filename: f.filename,
      url: f.url,
      size: f.size,
      sha1: f.hashes?.sha1,
      primary: f.primary,
    })),
    dependencies: (v.dependencies ?? [])
      .filter((d) => d.project_id)
      .map((d) => ({ projectId: d.project_id, versionId: d.version_id ?? undefined, type: d.dependency_type })),
  }
}

export class ModrinthProvider implements ResourceProvider {
  readonly source = 'modrinth' as const
  private readonly client: ModrinthV2Client

  constructor(userAgent: string, fetchFn?: typeof fetch) {
    this.client = new ModrinthV2Client({ headers: { 'User-Agent': userAgent }, fetch: fetchFn })
  }

  async search(query: ResourceSearchQuery, signal?: AbortSignal): Promise<ResourceSearchResult> {
    const result = await this.client.searchProjects(
      {
        query: query.query || undefined,
        facets: modrinthFacets(query),
        index: query.sort,
        offset: query.offset,
        limit: query.limit,
      },
      signal,
    )
    return { hits: result.hits.map(mapModrinthHit), total: result.total_hits, offset: result.offset }
  }

  async versions(projectId: string, kind: ResourceKind, filter: VersionFilter, signal?: AbortSignal) {
    const loaders = kind === 'mod' || kind === 'modpack' ? compatibleLoaders(filter.loader) : []
    const list = await this.client.getProjectVersions(
      projectId,
      {
        loaders: loaders.length ? loaders : undefined,
        gameVersions: filter.gameVersion ? [filter.gameVersion] : undefined,
      },
      signal,
    )
    return list.map(mapModrinthVersion)
  }

  async version(_projectId: string, versionId: string, signal?: AbortSignal) {
    return mapModrinthVersion(await this.client.getProjectVersion(versionId, signal))
  }

  /** Look up Modrinth versions by file sha1 (used to turn local files into mrpack download entries). */
  async versionsBySha1(hashes: string[], signal?: AbortSignal): Promise<Record<string, ResourceVersion>> {
    if (!hashes.length) return {}
    const found = await this.client.getProjectVersionsByHash(hashes, 'sha1', signal)
    return Object.fromEntries(Object.entries(found).map(([hash, v]) => [hash, mapModrinthVersion(v)]))
  }

  async titles(projectIds: string[], signal?: AbortSignal) {
    if (!projectIds.length) return {}
    const projects = await this.client.getProjects(projectIds, signal)
    const kinds: Record<string, ResourceKind> = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader', modpack: 'modpack' }
    return Object.fromEntries(projects.map((p) => [p.id, { title: p.title, kind: kinds[p.project_type] }]))
  }
}

// ---------------------------------------------------------------- CurseForge

export const CURSEFORGE_GAME_ID = 432
export const CURSEFORGE_CLASS: Record<ResourceKind, number> = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 }
const CURSEFORGE_CLASS_KIND: Record<number, ResourceKind> = { 6: 'mod', 12: 'resourcepack', 6552: 'shader', 4471: 'modpack' }
const CURSEFORGE_LOADER: Partial<Record<LoaderType, number>> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const CURSEFORGE_SORT: Record<ResourceSearchQuery['sort'], number> = { relevance: 2, downloads: 6, updated: 3, newest: 11 }
const CURSEFORGE_RELATION: Record<number, DependencyType | undefined> = { 1: 'embedded', 2: 'optional', 3: 'required', 5: 'incompatible' }
const CURSEFORGE_RELEASE: Record<number, ResourceVersion['releaseType']> = { 1: 'release', 2: 'beta', 3: 'alpha' }
const CURSEFORGE_LOADER_NAMES = ['forge', 'fabric', 'quilt', 'neoforge']

export function curseforgeLoaderType(loader?: LoaderType): number | undefined {
  return loader ? CURSEFORGE_LOADER[loader] : undefined
}

export function mapCurseforgeMod(mod: CfMod): ResourceHit {
  return {
    source: 'curseforge',
    projectId: String(mod.id),
    slug: mod.slug,
    title: mod.name,
    description: mod.summary,
    author: mod.authors?.[0]?.name ?? '',
    iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url || undefined,
    downloads: mod.downloadCount,
    categories: (mod.categories ?? []).map((c) => c.name),
    pageUrl: mod.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`,
  }
}

export function mapCurseforgeFile(file: CfFile): ResourceVersion {
  const sha1 = file.hashes?.find((h) => h.algo === 1)?.value
  return {
    source: 'curseforge',
    projectId: String(file.modId),
    versionId: String(file.id),
    name: file.displayName,
    versionNumber: file.displayName,
    gameVersions: (file.gameVersions ?? []).filter((v) => /^\d/.test(v)),
    loaders: (file.gameVersions ?? []).map((v) => v.toLowerCase()).filter((v) => CURSEFORGE_LOADER_NAMES.includes(v)),
    releaseType: CURSEFORGE_RELEASE[file.releaseType] ?? 'release',
    published: file.fileDate,
    // downloadUrl is null when the author disallows third-party downloads; callers must skip it.
    files: [{ filename: file.fileName, url: file.downloadUrl || undefined, size: file.fileLength, sha1, primary: true }],
    dependencies: (file.dependencies ?? []).flatMap((d) => {
      const type = CURSEFORGE_RELATION[d.relationType]
      return type ? [{ projectId: String(d.modId), type }] : []
    }),
  }
}

export class CurseforgeProvider implements ResourceProvider {
  readonly source = 'curseforge' as const
  private readonly client: CurseforgeV1Client

  constructor(apiKey: string, fetchFn?: typeof fetch) {
    if (!apiKey) throw new SmclError('CurseforgeNotConfigured', 'Set a CurseForge API key in Settings to use CurseForge')
    this.client = new CurseforgeV1Client(apiKey, { fetch: fetchFn })
  }

  async search(query: ResourceSearchQuery, signal?: AbortSignal): Promise<ResourceSearchResult> {
    const loaderType = query.kind === 'mod' || query.kind === 'modpack' ? curseforgeLoaderType(query.loader) : undefined
    const result = await this.client.searchMods(
      {
        gameId: CURSEFORGE_GAME_ID,
        classId: CURSEFORGE_CLASS[query.kind],
        searchFilter: query.query || undefined,
        gameVersion: query.gameVersion,
        modLoaderType: loaderType as never,
        sortField: CURSEFORGE_SORT[query.sort] as never,
        sortOrder: 'desc',
        index: query.offset,
        pageSize: Math.min(query.limit, 50),
      },
      signal,
    )
    return {
      hits: result.data.map(mapCurseforgeMod),
      total: result.pagination.totalCount,
      offset: result.pagination.index,
    }
  }

  async versions(projectId: string, kind: ResourceKind, filter: VersionFilter, signal?: AbortSignal) {
    const loaderType = kind === 'mod' || kind === 'modpack' ? curseforgeLoaderType(filter.loader) : undefined
    const { data } = await this.client.getModFiles(
      { modId: Number(projectId), gameVersion: filter.gameVersion, modLoaderType: loaderType as never, pageSize: 50 },
      signal,
    )
    return data
      .filter((f) => f.isAvailable !== false)
      .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))
      .map(mapCurseforgeFile)
  }

  async version(projectId: string, versionId: string, signal?: AbortSignal) {
    return mapCurseforgeFile(await this.client.getModFile(Number(projectId), Number(versionId), signal))
  }

  async titles(projectIds: string[], signal?: AbortSignal) {
    if (!projectIds.length) return {}
    const mods = await this.client.getMods(projectIds.map(Number), signal)
    return Object.fromEntries(mods.map((m) => [String(m.id), { title: m.name, kind: CURSEFORGE_CLASS_KIND[m.classId ?? 6] }]))
  }

  getFiles(fileIds: number[], signal?: AbortSignal) {
    return this.client.getFiles(fileIds, signal)
  }

  getMods(modIds: number[], signal?: AbortSignal) {
    return this.client.getMods(modIds, signal)
  }
}

/** Kind of a CurseForge class id (defaults to mod). */
export function curseforgeKind(classId: number | null | undefined): ResourceKind {
  return CURSEFORGE_CLASS_KIND[classId ?? 6] ?? 'mod'
}
