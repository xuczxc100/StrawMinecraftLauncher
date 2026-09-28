import type { ResolvedVersion } from '@xmcl/core'
import {
  DEFAULT_META_URL_FABRIC,
  DEFAULT_RESOURCE_ROOT_URL,
  DEFAULT_VERSION_MANIFEST_URL,
  type MinecraftVersionBaseInfo,
} from '@xmcl/installer'
import type { MirrorSource } from '@shared/types'

export const BMCLAPI = 'https://bmclapi2.bangbang93.com'

const MOJANG_META_HOST = /^https:\/\/(piston-meta|launchermeta|launcher)\.mojang\.com/

export interface MirrorOptions {
  versionManifest: string
  /** Extra URLs tried before the official one; the installer appends the original URL as fallback. */
  json?: (version: MinecraftVersionBaseInfo) => string[]
  client?: (version: ResolvedVersion) => string[]
  /** Used as-is by the installer (no implicit fallback), so the official host must be listed explicitly. */
  assetsHost?: string[]
  assetsIndexUrl?: (version: ResolvedVersion) => string[]
  mavenHost?: string[]
  fabricMeta: string[]
}

export function getMirrorOptions(mirror: MirrorSource): MirrorOptions {
  if (mirror !== 'bmclapi') {
    return { versionManifest: DEFAULT_VERSION_MANIFEST_URL, fabricMeta: [DEFAULT_META_URL_FABRIC] }
  }
  return {
    versionManifest: `${BMCLAPI}/mc/game/version_manifest.json`,
    json: (version) => [version.url.replace(MOJANG_META_HOST, BMCLAPI)],
    client: (version) => [`${BMCLAPI}/version/${version.minecraftVersion}/client`],
    assetsHost: [`${BMCLAPI}/assets`, DEFAULT_RESOURCE_ROOT_URL],
    assetsIndexUrl: (version) => (version.assetIndex ? [version.assetIndex.url.replace(MOJANG_META_HOST, BMCLAPI)] : []),
    mavenHost: [`${BMCLAPI}/maven`],
    fabricMeta: [`${BMCLAPI}/fabric-meta`, DEFAULT_META_URL_FABRIC],
  }
}
