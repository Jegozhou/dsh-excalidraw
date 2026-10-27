/**
 * Static server for the spike pages.
 *
 * Routes:
 *   /                                       standalone page (React 19, compiled-in)
 *   /dsh                                    DSH __ModuleLoader__ harness page (React 18.3.1)
 *   /build/*                                esbuild outputs
 *   /static/*                               harness JS/CSS
 *   /assets/*                               local Excalidraw fonts (no CDN)
 *   /plugins/@local/dsh-excalidraw/client.js        wrapped DSH-format bundle
 *   /plugins/@local/dsh-excalidraw/assets/*         package asset route emulation
 *
 * The /dsh document is served with a strict CSP so any accidental CDN fetch or
 * eval failure shows up in the evidence instead of working by accident.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { PUBLIC_DIR } from './lib.mjs'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

export const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const PLUGIN_PREFIX = '/plugins/@local/dsh-excalidraw'

function route(pathname) {
  if (pathname === '/') return { file: join(PUBLIC_DIR, 'standalone.html'), document: 'standalone' }
  if (pathname === '/dsh') return { file: join(PUBLIC_DIR, 'dsh.html'), document: 'dsh' }
  const mappings = [
    ['/build/', join(PUBLIC_DIR, 'build')],
    ['/static/', join(PUBLIC_DIR, 'static')],
    ['/assets/', join(PUBLIC_DIR, 'assets')],
    ['/lazy/', join(PUBLIC_DIR, 'lazy')],
  ]
  for (const [prefix, root] of mappings) {
    if (pathname.startsWith(prefix)) {
      const rel = normalize(decodeURIComponent(pathname.slice(prefix.length)))
      if (rel.startsWith('..' + sep) || rel === '..') return null
      return { file: resolve(root, rel), document: null }
    }
  }
  if (pathname === `${PLUGIN_PREFIX}/client.js`) {
    return { file: join(PUBLIC_DIR, 'build', 'dsh-client.js'), document: null }
  }
  if (pathname.startsWith(`${PLUGIN_PREFIX}/assets/`)) {
    const rel = normalize(decodeURIComponent(pathname.slice(`${PLUGIN_PREFIX}/assets/`.length)))
    if (rel.startsWith('..' + sep) || rel === '..') return null
    return { file: resolve(join(PUBLIC_DIR, 'assets'), rel), document: null }
  }
  return null
}

async function serveFile(file) {
  const info = await stat(file)
  if (!info.isFile()) throw new Error('not a file')
  return readFile(file)
}

/**
 * Start the spike server.
 * @param {{ port?: number, csp?: boolean }} options
 */
export async function startServer(options = {}) {
  const csp = options.csp !== false
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      const entry = route(pathname)
      if (entry === null) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
        return
      }
      const body = await serveFile(entry.file)
      const headers = {
        'content-type': MIME[extname(entry.file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      }
      if (entry.document === 'dsh' && csp) headers['content-security-policy'] = STRICT_CSP
      if (req.method === 'HEAD') {
        res.writeHead(200, { ...headers, 'content-length': body.byteLength }).end()
        return
      }
      res.writeHead(200, headers).end(body)
    } catch (error) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(String(error?.message ?? error))
    }
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(options.port ?? 0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    url: (path = '/') => `${origin}${path}`,
    csp,
    close: () => new Promise(resolveClose => server.close(resolveClose)),
  }
}

// `node scripts/server.mjs` serves on a fixed port for manual inspection.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 8787)
  const instance = await startServer({ port, csp: process.env.CSP !== '0' })
  console.log(`spike server: ${instance.origin}/ (standalone)  ${instance.origin}/dsh (DSH loader harness)`)
}
