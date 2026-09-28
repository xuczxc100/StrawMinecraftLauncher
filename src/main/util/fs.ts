import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { SmclError } from './errors'

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw e
  }
}

/** Write via temp file + rename so a crash never leaves a truncated JSON file. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, file)
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export function hashFile(file: string, algorithm: 'sha1' | 'sha512' = 'sha1'): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash(algorithm)
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')))
  })
}

/**
 * Resolve `untrusted` (a relative path from an archive or remote manifest) inside `root`.
 * Throws on absolute paths or `..` traversal so archives cannot write outside the instance.
 */
export function safeJoin(root: string, untrusted: string): string {
  const normalized = untrusted.replace(/\\/g, '/')
  if (!normalized || isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new SmclError('UnsafePath', `Refusing unsafe path: ${untrusted}`)
  }
  const target = resolve(root, normalized)
  const rel = relative(resolve(root), target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new SmclError('UnsafePath', `Refusing path outside target: ${untrusted}`)
  }
  return target
}

export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows file names
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned.replace(/^\.+/, '').slice(0, 80) || 'instance'
}
