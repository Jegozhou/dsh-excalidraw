/**
 * Golden-corpus tests over the upstream-derived `.excalidraw` fixtures.
 *
 * These are not copied drawings: the upstream checkout contains no drawing
 * payloads, so the corpus was generated with the MIT Excalidraw 0.18.145
 * runtime (see fixtures/upstream/README.md and manifest.json). The tests assert
 * that our parser preserves every field the fixtures exercise, that
 * normalization is a fixed point, and that references stay intact.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseScene, serializeScene, summarizeScene } from '../../src/core/scene.ts'
import { validateScene } from '../../src/core/elements.ts'
import type { Scene, SceneElement } from '../../src/core/types.ts'

const ROOT = join(process.cwd(), 'fixtures', 'upstream')

/** Fixtures that wrap a plain scene JSON document. */
async function plainFixtures(): Promise<Array<{ path: string; category: string; contains: string[] }>> {
  const manifest = JSON.parse(await fs.readFile(join(ROOT, 'manifest.json'), 'utf8'))
  return manifest.entries
    .filter((entry: { wrappers?: string[] }) => Array.isArray(entry.wrappers) && entry.wrappers.includes('excalidraw'))
    .map((entry: { path: string; category: string; contains: string[] }) => ({
      path: join(process.cwd(), entry.path),
      category: entry.category,
      contains: entry.contains,
    }))
}

/** All element ids referenced by an arrow binding. */
function bindingTargets(elements: SceneElement[]): Array<{ arrow: string; target: string }> {
  const out: Array<{ arrow: string; target: string }> = []
  for (const element of elements) {
    for (const binding of [element.startBinding, element.endBinding]) {
      if (binding && typeof binding === 'object' && 'elementId' in binding) {
        out.push({ arrow: element.id, target: String(binding.elementId) })
      }
    }
  }
  return out
}

test('every plain fixture parses, validates and is normalization-stable', async () => {
  const fixtures = await plainFixtures()
  assert.ok(fixtures.length >= 4, `expected at least four plain fixtures, saw ${fixtures.length}`)
  for (const fixture of fixtures) {
    const text = await fs.readFile(fixture.path, 'utf8')
    const first = parseScene(text)
    assert.equal(first.type, 'excalidraw', fixture.path)
    assert.equal(first.version, 2, fixture.path)
    assert.ok(first.elements.length > 0, `${fixture.path} has no elements`)
    const validation = validateScene(first)
    assert.equal(validation.valid, true, `${fixture.path}: ${JSON.stringify(validation.diagnostics)}`)
    assert.deepEqual(validation.stats.unsupportedTypes, [], fixture.path)
    const second = parseScene(serializeScene(first))
    assert.deepEqual(second, first, `${fixture.path} did not survive a serialize/parse round-trip`)
    const summary = summarizeScene(first)
    assert.equal(summary.elements, first.elements.length)
    assert.ok(summary.files >= 0)
  }
})

test('fixtures exercise the documented compatibility categories', async () => {
  const fixtures = await plainFixtures()
  const all = []
  for (const fixture of fixtures) {
    const scene = parseScene(await fs.readFile(fixture.path, 'utf8'))
    all.push(scene)
  }
  const types = new Set(all.flatMap(scene => scene.elements.map(element => element.type)))
  for (const expected of ['rectangle', 'ellipse', 'diamond', 'arrow', 'text', 'image', 'freedraw']) {
    assert.ok(types.has(expected), `corpus does not cover element type ${expected}`)
  }
  const allElements = all.flatMap(scene => scene.elements)
  assert.ok(allElements.some(element => element.containerId), 'corpus has no bound text')
  assert.ok(allElements.some(element => element.startBinding || element.endBinding), 'corpus has no bound arrow')
  assert.ok(allElements.some(element => element.customData !== undefined), 'corpus has no customData')
  assert.ok(allElements.some(element => typeof element.link === 'string' && element.link.length > 0), 'corpus has no element link')
  assert.ok(all.some(scene => Object.keys(scene.files).length > 0), 'corpus has no attachment')
  assert.ok(allElements.some(element => element.type === 'freedraw' && Array.isArray(element.pressures)), 'corpus has no pressure data')
})

test('Fixtures preserve identity and every binding target', async () => {
  for (const fixture of await plainFixtures()) {
    const scene = parseScene(await fs.readFile(fixture.path, 'utf8'))
    const ids = new Set(scene.elements.map(element => element.id))
    assert.equal(ids.size, scene.elements.length, `${fixture.path} lost or duplicated ids`)
    for (const { arrow, target } of bindingTargets(scene.elements)) {
      assert.ok(ids.has(target), `${fixture.path}: arrow ${arrow} points at missing element ${target}`)
    }
    for (const element of scene.elements) {
      if (element.type === 'image') {
        assert.ok(typeof element.fileId === 'string' && element.fileId.length > 0, `${fixture.path}: image without fileId`)
        assert.ok(scene.files[element.fileId!], `${fixture.path}: image file ${element.fileId} is missing from files`)
        assert.match(scene.files[element.fileId!]!.dataURL, /^data:image\//u)
      }
      if (element.type === 'text') {
        assert.equal(typeof element.text, 'string', `${fixture.path}: text element without text`)
        assert.equal(typeof element.originalText, 'string', `${fixture.path}: text element without originalText`)
        assert.equal(typeof element.fontSize, 'number')
      }
    }
  }
})

test('file attachments survive a normalize/serialize round-trip byte-for-byte', async () => {
  const scene = parseScene(await fs.readFile(join(ROOT, 'image-attachment.excalidraw'), 'utf8'))
  const before = JSON.stringify(scene.files)
  const after = JSON.stringify(parseScene(serializeScene(scene)).files)
  assert.equal(after, before)
  const fileId = Object.keys(scene.files)[0]!
  assert.match(fileId, /^[0-9a-f]{40}$/u, 'the upstream fileId convention is a 40-char sha1')
  assert.ok(scene.files[fileId]!.dataURL.length > 100)
})

test('Obsidian Markdown envelopes are explicitly outside the supported range', async () => {
  for (const name of ['compressed-attachment.excalidraw.md', 'metadata-uncompressed.excalidraw.md']) {
    const text = await fs.readFile(join(ROOT, name), 'utf8')
    assert.throws(
      () => parseScene(text),
      (error: unknown) => error instanceof Error && error.message.includes('not valid JSON'),
      `${name} must be rejected with a format explanation`,
    )
  }
})

test('a fixture can be persisted by the real store and read back semantically equal', async () => {
  const { SceneStore } = await import('../../src/core/store.ts')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-golden-'))
  try {
    const store = new SceneStore({ rootDir: dir })
    await store.init()
    const scene: Scene = parseScene(await fs.readFile(join(ROOT, 'arrows-bindings.excalidraw'), 'utf8'))
    const created = await store.create('golden', scene)
    const read = await store.read('golden')
    assert.equal(read.sha256, created.sha256)
    assert.deepEqual(read.scene, scene)
    assert.equal(read.revision, 1)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
