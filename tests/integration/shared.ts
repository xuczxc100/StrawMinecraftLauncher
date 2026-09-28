import { resolve } from 'node:path'
import { createContext } from '../../src/main/context'

/** Persistent between runs so the shared .minecraft cache is reused (gitignored). */
export const INTEGRATION_ROOT = resolve(import.meta.dirname, '../../.smcl-test/integration')

export function integrationContext() {
  return createContext({ dataRoot: INTEGRATION_ROOT, version: '0.0.0-integration', env: {} })
}

export async function ensureInstance(
  ctx: Awaited<ReturnType<typeof integrationContext>>,
  name: string,
  input: { minecraft: string; loader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'; loaderVersion?: string },
) {
  const existing = ctx.instances.list().find((i) => i.name === name)
  if (existing) {
    const sameVersion =
      existing.minecraft === input.minecraft && existing.loader === input.loader && (input.loader === 'vanilla' || existing.loaderVersion === input.loaderVersion)
    if (sameVersion) return existing
    await ctx.instances.remove(existing.id)
  }
  return ctx.instances.create({ name, ...input })
}
