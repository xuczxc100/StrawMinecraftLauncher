// Mirrors VERSION (a.b.c.d) into package.json as semver: a.b.c (release) or a.b.c-preview.d
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'VERSION'), 'utf8').trim()
const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(raw)
if (!match) {
  console.error(`VERSION must be a.b.c.d, got "${raw}"`)
  process.exit(1)
}
const [, a, b, c, d] = match
const semver = d === '0' ? `${a}.${b}.${c}` : `${a}.${b}.${c}-preview.${d}`
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
if (pkg.version !== semver) {
  pkg.version = semver
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`package.json version -> ${semver}`)
}
