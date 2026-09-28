import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { createContext, type ContextOptions } from '../../src/main/context'

const dirs: string[] = []

export async function tempDir(prefix = 'smcl-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

export async function testContext(options: Partial<ContextOptions> = {}) {
  const dataRoot = options.dataRoot ?? (await tempDir())
  return createContext({ version: '0.0.0-test', env: {}, ...options, dataRoot })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
