import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ZipFile } from 'yazl'
import { afterEach } from 'vitest'

const servers: Server[] = []

/** Serves in-memory files over http://127.0.0.1 so download paths run for real without internet. */
export async function fileServer(files: Record<string, Buffer>) {
  const hits: string[] = []
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    hits.push(path)
    const body = files[path]
    if (!body) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-length': body.length, 'content-type': 'application/octet-stream' })
    res.end(req.method === 'HEAD' ? undefined : body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const { port } = server.address() as AddressInfo
  return { url: (path: string) => `http://127.0.0.1:${port}${path}`, hits }
}

export function sha1(buf: Buffer) {
  return createHash('sha1').update(buf).digest('hex')
}

export function zipBuffer(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new ZipFile()
  for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), name)
  zip.end()
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
}

/** Minimal Fabric mod jar readable by @xmcl/mod-parser. */
export function fabricModJar(id: string, version: string, name = id) {
  return zipBuffer({
    'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id, version, name, description: `${name} test mod` }),
  })
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!
    await new Promise((r) => s.close(r))
  }
})
