/**
 * HTTP API integration tests against a real loopback server.
 * Proves the browser surface and the agent surface agree on validation,
 * revision fencing and idempotency.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { ApiServer, API_PREFIX, createAssetHandler, ASSET_PREFIX } from '../../src/host/api.ts'
import { ExcalidrawService } from '../../src/host/service.ts'
import { createElement } from '../../src/core/elements.ts'

let server: Server
let base: string
let service: ExcalidrawService
let workDir: string
let reject: boolean

before(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), 'dsh-excalidraw-api-'))
  service = new ExcalidrawService({ rootDir: join(workDir, 'drawings'), limits: {}, version: '0.1.0-test' })
  await service.ready()
  const api = new ApiServer({
    service,
    admit: () => (reject ? 403 : undefined),
    log: () => undefined,
  })
  const assets = createAssetHandler(join(process.cwd(), 'assets'), () => (reject ? 403 : undefined))
  server = createServer((req, res) => {
    if (req.url?.startsWith(API_PREFIX)) {
      void api.handle(req, res)
      return
    }
    if (req.url?.startsWith(ASSET_PREFIX)) {
      void assets(req, res)
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  base = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  await fs.rm(workDir, { recursive: true, force: true })
})

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${API_PREFIX}${path}`, init)
  const body = await response.json()
  return { status: response.status, body }
}

test('health reports the drawings directory and limits', async () => {
  const { status, body } = await call('/health')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.plugin, 'dsh-excalidraw')
  assert.match(body.drawingsDir, /drawings/u)
  assert.equal(body.limits.maxElements, 5000)
})

test('create -> list -> read -> save -> read', async () => {
  const create = await call('/scenes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'first', elements: [{ type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }] }),
  })
  assert.equal(create.status, 200)
  assert.equal(create.body.revision, 1)
  assert.equal(create.body.verified, undefined) // HTTP surface does not claim verified; it returns ok

  const list = await call('/scenes')
  assert.equal(list.status, 200)
  assert.equal(list.body.scenes.length, 1)
  assert.equal(list.body.scenes[0].name, 'first')

  const read = await call('/scenes/first')
  assert.equal(read.status, 200)
  assert.equal(read.body.scene.elements.length, 1)
  assert.equal(read.body.revision, 1)

  const scene = read.body.scene
  scene.elements.push(createElement({ type: 'text', id: 't1', x: 10, y: 10, text: 'hello' }))
  const save = await call('/scenes/first', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene, expected_revision: 1, request_id: 'http-1' }),
  })
  assert.equal(save.status, 200)
  assert.equal(save.body.revision, 2)
  assert.equal(save.body.duplicate, false)

  const again = await call('/scenes/first', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene, expected_revision: 1, request_id: 'http-1' }),
  })
  assert.equal(again.status, 200)
  assert.equal(again.body.revision, 2)
  assert.equal(again.body.duplicate, true)
})

test('stale save returns 409 with the current revision', async () => {
  const read = await call('/scenes/first')
  const scene = read.body.scene
  scene.appState.viewBackgroundColor = '#fffbe6'
  const stale = await call('/scenes/first', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene, expected_revision: 1 }),
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.code, 'revision_conflict')
  assert.equal(stale.body.error.details.currentRevision, 2)
})

test('invalid name and unknown scene use precise codes', async () => {
  const bad = await call('/scenes/..%2Fescape')
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'invalid_name')
  const missing = await call('/scenes/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error.code, 'not_found')
})

test('invalid scene payload is rejected without writing', async () => {
  const response = await call('/scenes/first', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: { type: 'excalidraw', version: 2, elements: [{ id: 'x' }] }, expected_revision: 2 }),
  })
  assert.equal(response.status, 422)
  assert.equal(response.body.error.code, 'invalid_scene')
})

test('editor status records mount evidence and exposes it in health', async () => {
  const report = await call('/editor-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'mounted', build: 'test', width: 800, height: 600, sceneName: 'first' }),
  })
  assert.equal(report.status, 200)
  assert.equal(report.body.editor.mounted, true)
  assert.equal(report.body.editor.width, 800)
  const health = await call('/health')
  assert.equal(health.body.editor.sceneName, 'first')
  assert.equal(health.body.editor.build, 'test')
})

test('the connection fence rejects every API and asset request', async () => {
  reject = true
  try {
    const health = await call('/health')
    assert.equal(health.status, 403)
    assert.equal(health.body.error.code, 'unauthorized')
    const asset = await fetch(`${base}${ASSET_PREFIX}/excalidraw.css`)
    assert.equal(asset.status, 403)
  } finally {
    reject = false
  }
})

test('assets are served with the right content type and traversal is refused', async () => {
  const css = await fetch(`${base}${ASSET_PREFIX}/excalidraw.css`)
  assert.equal(css.status, 200)
  assert.match(css.headers.get('content-type') ?? '', /text\/css/u)
  const font = await fetch(`${base}${ASSET_PREFIX}/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2`)
  assert.equal(font.status, 200)
  assert.equal(font.headers.get('content-type'), 'font/woff2')
  const traversal = await fetch(`${base}${ASSET_PREFIX}/%2e%2e/%2e%2e/etc/passwd`)
  assert.ok(traversal.status === 403 || traversal.status === 404)
})

test('unknown API routes and methods fail closed', async () => {
  const unknown = await call('/nope')
  assert.equal(unknown.status, 404)
  const method = await call('/health', { method: 'DELETE' })
  assert.equal(method.status, 404)
})

test('oversized request bodies are rejected', async () => {
  const huge = 'x'.repeat(25 * 1024 * 1024)
  const response = await fetch(`${base}${API_PREFIX}/scenes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'huge', elements: [], padding: huge }),
  })
  assert.equal(response.status, 413)
})

test('service direct API matches HTTP semantics for apply', async () => {
  const read = await service.read('first')
  const result = await service.apply('first', {
    expectedRevision: read.revision,
    operations: [{ op: 'add', element: { type: 'ellipse', x: 20, y: 20, width: 40, height: 40 } }],
    requestId: 'agent-1',
    actor: 'agent',
  })
  assert.equal(result.record.revision, read.revision + 1)
  assert.equal(result.operations.added, 1)
  const reread = await service.read('first')
  assert.ok(reread.scene.elements.some(element => element.type === 'ellipse'))
})
