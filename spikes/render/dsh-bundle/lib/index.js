/**
 * Node half of the spike client package.
 *
 * The DSH package-asset route (`./assets/*` -> `plugins/<pkg>/assets/<path>`)
 * only serves images: `PACKAGE_ASSET_MEDIA_TYPES` in
 * packages/client/modules/src/assets.ts is exactly
 * svg/png/webp/jpg/jpeg, and every other extension answers 404. Excalidraw
 * needs 234 `.woff2` files, so the fonts cannot ride the standard asset route.
 *
 * This Node half registers a dedicated prefix route on the Host web server,
 * which is what the real plugin must do as well. The browser URL is
 * document-relative: `plugins/@local/dsh-excalidraw/assets/<path>`.
 *
 * For a real install: ship the assets next to this file (`lib/assets/`, with
 * `lib/assets/fonts/` from the Excalidraw package), and set
 * `window.EXCALIDRAW_ASSET_PATH` to the absolute form of that route (the
 * client half does this from document.baseURI; see README).
 */
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis services this half needs: the Host web server only. */
export const inject = ['webServer']

/** Route prefix; must match the document-relative base the client half uses. */
export const ASSET_ROUTE = '/plugins/@local/dsh-excalidraw/assets'

const ASSET_ROOT = fileURLToPath(new URL('./assets/', import.meta.url))

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/**
 * Answer one asset request (fonts, images) from the package's asset directory.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function serveAsset(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const pathname = new URL(request.url).pathname
  const relative = decodeURIComponent(pathname.slice(ASSET_ROUTE.length + 1))
  const file = resolve(join(ASSET_ROOT, normalize(relative)))
  if (!file.startsWith(resolve(ASSET_ROOT) + sep)) return new Response(null, { status: 403 })
  try {
    const info = await stat(file)
    if (!info.isFile()) return new Response(null, { status: 404 })
    const type = MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream'
    const body = request.method === 'HEAD' ? null : await readFile(file)
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(info.size),
        // Fonts are content-addressed by package version, so cache them hard.
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}

/**
 * Register the asset route on the Host web server.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ASSET_ROUTE,
    resource: serveAsset,
  }))
}
