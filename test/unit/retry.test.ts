/**
 * Retry semantics: a repeated request id must return the committed facts and
 * must not run the mutation again, even with the stale revision the original
 * caller held.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { ExcalidrawService } from '../../src/host/service.ts'

const directories: string[] = []

after(async () => {
  await Promise.all(directories.map(dir => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })))
})

async function service(): Promise<ExcalidrawService> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-excalidraw-retry-'))
  directories.push(dir)
  const instance = new ExcalidrawService({ rootDir: join(dir, 'drawings'), limits: {}, version: 'test' })
  await instance.ready()
  await instance.create({ name: 'retry', elements: [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] })
  return instance
}

test('apply retry returns the committed revision without mutating twice', async () => {
  const instance = await service()
  const first = await instance.apply('retry', {
    expectedRevision: 1,
    requestId: 'apply-1',
    operations: [{ op: 'add', element: { type: 'ellipse', x: 20, y: 20, width: 30, height: 30 } }],
  })
  assert.equal(first.record.revision, 2)
  assert.equal(first.record.duplicate, false)
  const second = await instance.apply('retry', {
    expectedRevision: 1,
    requestId: 'apply-1',
    operations: [{ op: 'add', element: { type: 'text', x: 0, y: 0, text: 'should not be added' } }],
  })
  assert.equal(second.record.revision, 2)
  assert.equal(second.record.duplicate, true)
  const record = await instance.read('retry')
  assert.equal(record.revision, 2)
  assert.deepEqual(record.scene.elements.map(element => element.type).sort(), ['ellipse', 'rectangle'])
})

test('a repeated save request id is idempotent and does not bump the revision', async () => {
  const instance = await service()
  const current = await instance.read('retry')
  const scene = current.scene
  const first = await instance.save('retry', {
    scene,
    expectedRevision: 1,
    requestId: 'save-1',
    actor: 'ui',
  })
  assert.equal(first.record.revision, 2)
  const second = await instance.save('retry', { scene, expectedRevision: 1, requestId: 'save-1', actor: 'ui' })
  assert.equal(second.record.revision, 2)
  assert.equal(second.record.duplicate, true)
  assert.equal((await instance.read('retry')).revision, 2)
})

test('apply merges the app-state subset without dropping stored keys', async () => {
  const instance = await service()
  await instance.apply('retry', {
    expectedRevision: 1,
    appState: { viewBackgroundColor: '#fffbe6', gridSize: 20 },
    operations: [{ op: 'update', id: (await instance.read('retry')).scene.elements[0]!.id, patch: { x: 5 } }],
  })
  const record = await instance.read('retry')
  assert.equal(record.scene.appState.viewBackgroundColor, '#fffbe6')
  assert.equal(record.scene.appState.gridSize, 20)
})
