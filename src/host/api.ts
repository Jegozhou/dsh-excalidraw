/**
 * HTTP API for the browser half, served through the Harness web carrier.
 *
 * Every request is first admitted by the Harness `connection` service; the
 * plugin never invents a second authentication scheme. Routes are exact and
 * live under one prefix. Errors use a stable `{error:{code,message,details}}`
 * envelope so the UI can render the Host's exact reason.
 * @module host/api
 */

import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSceneError, SceneError } from '../core/errors.ts'
import type { ExcalidrawService } from './service.ts'

/** Base path of the JSON API. */
export const API_PREFIX = '/dsh-excalidraw/api'
/** Base path of static editor assets (fonts, locales). */
export const ASSET_PREFIX = '/dsh-excalidraw/assets'
/** Maximum accepted request body. */
const MAX_BODY_BYTES = 24 * 1024 * 1024

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: (body: Record<string, unknown>, params: Record<string, string>, req: IncomingMessage) => Promise<unknown>
}

/** One API server bound to a service. */
export class ApiServer {
  private readonly service: ExcalidrawService
  private readonly admit: (req: IncomingMessage) => number | undefined
  private readonly log: (message: string, error?: unknown) => void
  private readonly routes: Route[] = []

  constructor(deps: {
    service: ExcalidrawService
    admit: (req: IncomingMessage) => number | undefined
    log?: (message: string, error?: unknown) => void
  }) {
    this.service = deps.service
    this.admit = deps.admit
    this.log = deps.log ?? (() => undefined)
    this.register()
  }

  private route(
    method: string,
    template: string,
    handler: Route['handler'],
  ): void {
    const keys: string[] = []
    const pattern = new RegExp(`^${template.replace(/:([A-Za-z0-9_]+)/gu, (_match, key: string) => {
      keys.push(key)
      return '([^/]+)'
    })}$`, 'u')
    this.routes.push({ method, pattern, keys, handler })
  }

  private register(): void {
    const service = this.service

    this.route('GET', '/health', async () => service.health())

    this.route('GET', '/scenes', async () => ({ scenes: await service.list() }))

    this.route('GET', '/scenes/:name', async (_body, params) => {
      const record = await service.read(params.name!)
      return {
        ok: true,
        name: params.name,
        revision: record.revision,
        sha256: record.sha256,
        byteLength: record.byteLength,
        elementCount: record.elementCount,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        scene: record.scene,
      }
    })

    this.route('POST', '/scenes', async (body) => {
      const created = await service.create({
        name: String(body.name ?? ''),
        elements: body.elements,
        scene: body.scene,
        appState: body.app_state,
        files: body.files as never,
        requestId: typeof body.request_id === 'string' ? body.request_id : undefined,
        actor: 'ui',
      })
      return {
        ok: true,
        name: created.name,
        revision: created.record.revision,
        sha256: created.record.sha256,
        elementCount: created.record.elementCount,
        savedAt: created.record.updatedAt,
        summary: created.summary,
      }
    })

    this.route('PUT', '/scenes/:name', async (body, params) => {
      const saved = await service.save(params.name!, {
        scene: body.scene,
        expectedRevision: typeof body.expected_revision === 'number' ? body.expected_revision : undefined,
        requestId: typeof body.request_id === 'string' ? body.request_id : undefined,
        force: body.force === true,
        actor: 'ui',
      })
      return {
        ok: true,
        name: params.name,
        revision: saved.record.revision,
        sha256: saved.record.sha256,
        byteLength: saved.record.byteLength,
        elementCount: saved.record.elementCount,
        savedAt: saved.record.updatedAt,
        duplicate: saved.record.duplicate === true,
        summary: saved.summary,
      }
    })

    this.route('POST', '/editor-status', async (body) => ({
      ok: true,
      editor: this.service.reportEditor(body),
    }))
  }

  /** Handle one request and own the full response lifecycle. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const rejection = this.admit(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { error: { code: 'unauthorized', message: 'this page is not authenticated for the Harness API' } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh-excalidraw.invalid')
      const path = url.pathname.slice(API_PREFIX.length) || '/'
      const method = String(req.method ?? 'GET').toUpperCase()
      const match = this.routes.find(route => route.method === method && route.pattern.test(path))
      if (!match) {
        sendJson(res, 404, { error: { code: 'not_found', message: `no route for ${method} ${path}` } })
        return
      }
      const values = match.pattern.exec(path)?.slice(1) ?? []
      const params = Object.fromEntries(match.keys.map((key, index) => [key, decodeURIComponent(values[index] ?? '')]))
      const query = Object.fromEntries(url.searchParams.entries())
      const body = method === 'GET' ? query : { ...query, ...(await readJson(req)) }
      const result = await match.handler(body, params, req)
      sendJson(res, 200, result ?? { ok: true })
    } catch (error) {
      const status = isSceneError(error) ? error.status : (error instanceof SceneError ? error.status : 500)
      const code = isSceneError(error) ? error.code : 'internal'
      const message = error instanceof Error ? error.message : String(error)
      if (status >= 500) this.log(`api: ${req.method} ${req.url} failed — ${message}`, error)
      sendJson(res, status, {
        error: {
          code,
          message,
          ...(error instanceof SceneError && error.details !== undefined ? { details: error.details } : {}),
        },
      })
    }
  }
}

/** Read a JSON body with a hard size cap. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new SceneError('too_large', `request body exceeds ${MAX_BODY_BYTES} bytes`)
    chunks.push(buffer)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SceneError('invalid_scene', 'the request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SceneError('invalid_scene', 'the request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Send a JSON response with no-store and sniffing protections. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(payload)
}

const CONTENT_TYPES: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** Serve the editor's local font/locale assets from the package directory. */
export function createAssetHandler(
  assetsDir: string,
  admit: (req: IncomingMessage) => number | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const root = resolve(assetsDir)
  return async (req, res) => {
    try {
      const rejection = admit(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { error: { code: 'unauthorized', message: 'not authenticated' } })
        return
      }
      if (String(req.method ?? 'GET').toUpperCase() !== 'GET') {
        sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'assets are read-only' } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh-excalidraw.invalid')
      let relative = decodeURIComponent(url.pathname.slice(ASSET_PREFIX.length))
      if (relative.startsWith('/')) relative = relative.slice(1)
      if (relative.length === 0 || relative.includes('\0') || relative.split('/').includes('..')) {
        sendJson(res, 404, { error: { code: 'not_found', message: 'asset not found' } })
        return
      }
      const target = resolve(join(root, normalize(relative)))
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        sendJson(res, 403, { error: { code: 'permission_denied', message: 'asset path escaped its root' } })
        return
      }
      const extension = extname(target).toLowerCase()
      const contentType = CONTENT_TYPES[extension]
      if (contentType === undefined) {
        sendJson(res, 404, { error: { code: 'not_found', message: 'unsupported asset type' } })
        return
      }
      const bytes = await readFile(target)
      res.statusCode = 200
      res.setHeader('content-type', contentType)
      res.setHeader('cache-control', 'public, max-age=3600')
      res.setHeader('x-content-type-options', 'nosniff')
      res.end(bytes)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        sendJson(res, 404, { error: { code: 'not_found', message: 'asset not found' } })
        return
      }
      sendJson(res, 500, { error: { code: 'io_error', message: error instanceof Error ? error.message : String(error) } })
    }
  }
}
