/**
 * Store tests: durability, revision fencing, idempotency, crash recovery and
 * path containment. Every test runs against a fresh temporary directory.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { SceneStore, sha256 } from '../../src/core/store.ts'
import { createScene, serializeScene } from '../../src/core/scene.ts'
import { SceneError } from '../../src/core/errors.ts'

const directories: string[] = []

async function makeStore(name = 'store'): Promise<{ store: SceneStore; dir: string; root: string }> {
  const dir = await fs.mkdtemp(join(tmpdir(), `dsh-excalidraw-${name}-`))
  directories.push(dir)
  const root = join(dir, 'drawings')
  const store = new SceneStore({ rootDir: root })
  await store.init()
  return { store, dir, root }
}

async function makeScene(label = 'box') {
  return createScene({
    elements: [{ type: 'rectangle', id: label, x: 0, y: 0, width: 100, height: 60 }],
  })
}

after(async () => {
  await Promise.all(directories.map(dir => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })))
})

test('create writes bytes + metadata and reports verified evidence', async () => {
  const { store, root } = await makeStore('create')
  const scene = await makeScene()
  const record = await store.create('demo', scene, { actor: 'test', requestId: 'req-1' })
  assert.equal(record.revision, 1)
  assert.equal(record.duplicate, false)
  const text = await fs.readFile(join(root, 'demo.excalidraw'), 'utf8')
  assert.equal(sha256(text), record.sha256)
  assert.deepEqual(JSON.parse(text), scene)
  const meta = await store.readMeta('demo')
  assert.equal(meta?.revision, 1)
  assert.equal(meta?.updatedBy, 'test')
  assert.ok(meta?.recentRequests.some(entry => entry.id === 'req-1'))
  const stat = await fs.stat(join(root, 'demo.excalidraw'))
  assert.equal(stat.mode & 0o777, 0o600)
  const leftovers = (await fs.readdir(root)).filter(entry => entry.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
})

test('read returns the same revision and scene', async () => {
  const { store } = await makeStore('read')
  const scene = await makeScene()
  await store.create('demo', scene)
  const record = await store.read('demo')
  assert.equal(record.revision, 1)
  assert.deepEqual(record.scene, scene)
  assert.equal(record.elementCount, 1)
})

test('stale revision is rejected and the file is untouched', async () => {
  const { store, root } = await makeStore('conflict')
  await store.create('demo', await makeScene())
  await store.save('demo', await makeScene(), { expectedRevision: 1, actor: 'test' })
  const before = await fs.readFile(join(root, 'demo.excalidraw'), 'utf8')
  await assert.rejects(
    store.save('demo', await makeScene(), { expectedRevision: 1, actor: 'test' }),
    (error: unknown) => error instanceof SceneError
      && error.code === 'revision_conflict'
      && (error.details as { currentRevision: number }).currentRevision === 2,
  )
  const after = await fs.readFile(join(root, 'demo.excalidraw'), 'utf8')
  assert.equal(sha256(after), sha256(before))
})

test('a repeated request id is idempotent even with a stale fence', async () => {
  const { store, root } = await makeStore('idempotent')
  await store.create('demo', await makeScene())
  const saved = await store.save('demo', await makeScene(), { expectedRevision: 1, requestId: 'write-1' })
  assert.equal(saved.revision, 2)
  const bytes = await fs.readFile(join(root, 'demo.excalidraw'), 'utf8')
  const again = await store.save('demo', await makeScene(), { expectedRevision: 1, requestId: 'write-1' })
  assert.equal(again.revision, 2)
  assert.equal(again.duplicate, true)
  assert.equal(await fs.readFile(join(root, 'demo.excalidraw'), 'utf8'), bytes)
})

test('two store instances cannot both win the same revision', async () => {
  const { store, dir, root } = await makeStore('concurrent')
  await store.create('demo', await makeScene())
  const second = new SceneStore({ rootDir: root })
  await second.init()
  const results = await Promise.allSettled([
    store.save('demo', await makeScene(), { expectedRevision: 1, actor: 'a' }),
    second.save('demo', await makeScene(), { expectedRevision: 1, actor: 'b' }),
  ])
  const fulfilled = results.filter(result => result.status === 'fulfilled')
  const rejected = results.filter(result => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal((rejected[0] as PromiseRejectedResult).reason.code, 'revision_conflict')
  const meta = await store.readMeta('demo')
  assert.equal(meta?.revision, 2)
  void dir
})

test('leftover temp files are ignored by list and read', async () => {
  const { store, root } = await makeStore('temp')
  await store.create('demo', await makeScene())
  await fs.writeFile(join(root, 'demo.excalidraw.tmp-deadbeef'), '{not json')
  const list = await store.list()
  assert.deepEqual(list.map(entry => entry.name), ['demo'])
  const record = await store.read('demo')
  assert.equal(record.revision, 1)
})

test('a corrupt scene is recovered from the newest backup', async () => {
  const { store, root } = await makeStore('recovery')
  await store.create('demo', await makeScene('original'))
  await store.save('demo', await makeScene('second'), { expectedRevision: 1 })
  const backups = await fs.readdir(join(root, '.dsh-excalidraw', 'backups'))
  assert.ok(backups.length >= 1)
  await fs.writeFile(join(root, 'demo.excalidraw'), '{ this is not a scene')
  const record = await store.read('demo')
  assert.equal(record.updatedBy, 'recovery')
  assert.equal(record.revision, 3)
  assert.equal(record.scene.elements[0]?.type, 'rectangle')
  const healed = await fs.readFile(join(root, 'demo.excalidraw'), 'utf8')
  assert.doesNotThrow(() => JSON.parse(healed))
})

test('a meta/scene hash mismatch is reconciled and the file wins', async () => {
  const { store, root } = await makeStore('reconcile')
  await store.create('demo', await makeScene('first'))
  const replacement = await makeScene('external')
  await fs.writeFile(join(root, 'demo.excalidraw'), serializeScene(replacement))
  const record = await store.read('demo')
  assert.equal(record.revision, 2)
  assert.equal(record.updatedBy, 'recovery')
  assert.equal(record.scene.elements[0]?.id, 'external')
})

test('scene names cannot escape the drawings root', async () => {
  const { store } = await makeStore('paths')
  for (const name of ['../evil', 'a/b', '', '.', 'UPPER', 'a b', 'a\\b']) {
    await assert.rejects(
      store.read(name),
      (error: unknown) => error instanceof SceneError && error.code === 'invalid_name',
      `name ${JSON.stringify(name)} must be rejected`,
    )
  }
})

test('symlinked scene files are refused', async () => {
  const { store, dir, root } = await makeStore('symlink')
  const outside = join(dir, 'outside.excalidraw')
  await fs.writeFile(outside, serializeScene(await makeScene()))
  await fs.symlink(outside, join(root, 'linked.excalidraw'))
  await assert.rejects(
    store.read('linked'),
    (error: unknown) => error instanceof SceneError && error.code === 'permission_denied',
  )
})

test('unknown scenes fail with not_found', async () => {
  const { store } = await makeStore('missing')
  await assert.rejects(
    store.read('nope'),
    (error: unknown) => error instanceof SceneError && error.code === 'not_found',
  )
})

test('list reports invalid files without failing the whole listing', async () => {
  const { store, root } = await makeStore('listing')
  await store.create('good', await makeScene())
  await fs.writeFile(join(root, 'bad.excalidraw'), '{oops')
  const list = await store.list()
  assert.deepEqual(list.map(entry => [entry.name, entry.valid]), [['bad', false], ['good', true]])
})
