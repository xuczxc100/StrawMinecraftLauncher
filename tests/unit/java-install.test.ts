import { describe, expect, it } from 'vitest'
import type { JavaInstall } from '@shared/types'
import { compareLooseVersion, neoForgePrefix } from '../../src/main/services/InstallService'
import { getRuntimePlatformKey, pickJava, runtimeMajorVersion } from '../../src/main/services/JavaService'
import { BMCLAPI, getMirrorOptions } from '../../src/main/util/mirrors'

const java = (major: number, version: string, source: JavaInstall['source'] = 'system', path = `/j/${version}`): JavaInstall => ({
  majorVersion: major,
  version,
  source,
  path,
})

describe('pickJava', () => {
  const installs = [java(8, '1.8.0_392'), java(17, '17.0.9'), java(17, '17.0.12', 'managed'), java(21, '21.0.4'), java(25, '25.0.1')]

  it('prefers the exact major, SMCL-managed first', () => {
    expect(pickJava(installs, 17)?.version).toBe('17.0.12')
    expect(pickJava(installs, 21)?.version).toBe('21.0.4')
  })

  it('uses exactly Java 8 for legacy versions and never a newer one', () => {
    expect(pickJava(installs, 8)?.version).toBe('1.8.0_392')
    expect(pickJava([java(17, '17.0.9')], 8)).toBeUndefined()
  })

  it('accepts the closest newer major for modern requirements', () => {
    expect(pickJava([java(21, '21.0.4'), java(25, '25.0.1')], 16)?.majorVersion).toBe(21)
    expect(pickJava([java(17, '17.0.1')], 21)).toBeUndefined()
  })
})

describe('Mojang runtime names', () => {
  it('parses major versions from runtime names', () => {
    expect(runtimeMajorVersion('17.0.15')).toBe(17)
    expect(runtimeMajorVersion('21.0.7')).toBe(21)
    expect(runtimeMajorVersion('8u202')).toBe(8)
    expect(runtimeMajorVersion('1.8.0_202')).toBe(8)
    expect(runtimeMajorVersion('16.0.1.9.1')).toBe(16)
    expect(runtimeMajorVersion('')).toBeUndefined()
  })
})

describe('Java runtime platform keys', () => {
  it('maps Node platforms to Mojang runtime keys', () => {
    expect(getRuntimePlatformKey('win32', 'x64')).toBe('windows-x64')
    expect(getRuntimePlatformKey('win32', 'arm64')).toBe('windows-arm64')
    expect(getRuntimePlatformKey('darwin', 'arm64')).toBe('mac-os-arm64')
    expect(getRuntimePlatformKey('darwin', 'x64')).toBe('mac-os')
    expect(getRuntimePlatformKey('linux', 'x64')).toBe('linux')
    expect(getRuntimePlatformKey('linux', 'arm64')).toBeUndefined()
  })
})

describe('NeoForge version mapping', () => {
  it('maps Minecraft versions to NeoForge prefixes', () => {
    expect(neoForgePrefix('1.20.2')).toBe('20.2.')
    expect(neoForgePrefix('1.21.1')).toBe('21.1.')
    expect(neoForgePrefix('1.21')).toBe('21.0.')
    expect(neoForgePrefix('26.3')).toBe('26.3.0.')
    expect(neoForgePrefix('26.3.1')).toBe('26.3.1.')
    expect(neoForgePrefix('24w14a')).toBeUndefined()
  })

  it('orders loose versions numerically', () => {
    const sorted = ['21.1.9', '21.1.100', '21.1.10-beta', '21.1.2'].sort(compareLooseVersion)
    expect(sorted).toEqual(['21.1.2', '21.1.9', '21.1.10-beta', '21.1.100'])
  })
})

describe('mirrors', () => {
  it('uses official sources by default', () => {
    const m = getMirrorOptions('official')
    expect(m.versionManifest).toContain('mojang.com')
    expect(m.assetsHost).toBeUndefined()
  })

  it('prepends BMCLAPI and keeps official fallbacks', () => {
    const m = getMirrorOptions('bmclapi')
    expect(JSON.stringify(m)).toContain(BMCLAPI)
    expect(m.assetsHost?.[0]).toContain(BMCLAPI)
    expect(m.assetsHost?.at(-1)).toContain('resources.download.minecraft.net')
  })
})
