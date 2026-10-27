/**
 * Core element and scene tests. These prove the authored subset is well formed
 * and that agent operations are atomic and reference-safe.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createElement,
  isReadableType,
  measureText,
  normalizeElement,
  sanitizeLink,
  validateScene,
} from '../../src/core/elements.ts'
import { applyOperations, createScene, normalizeScene, parseScene, serializeScene } from '../../src/core/scene.ts'
import { SceneError } from '../../src/core/errors.ts'

const deterministicRandom = () => 0.5

test('rectangle factory emits the full Excalidraw common field set', () => {
  const element = createElement({ type: 'rectangle', x: 10, y: 20, width: 100, height: 60 }, { random: deterministicRandom, now: 1000 })
  assert.equal(element.type, 'rectangle')
  assert.equal(element.x, 10)
  assert.equal(element.y, 20)
  assert.equal(element.width, 100)
  assert.equal(element.height, 60)
  assert.equal(element.angle, 0)
  assert.equal(element.strokeColor, '#1e1e1e')
  assert.equal(element.backgroundColor, 'transparent')
  assert.equal(element.fillStyle, 'solid')
  assert.equal(element.strokeWidth, 2)
  assert.equal(element.strokeStyle, 'solid')
  assert.equal(element.roughness, 1)
  assert.equal(element.opacity, 100)
  assert.deepEqual(element.groupIds, [])
  assert.deepEqual(element.roundness, { type: 3 })
  assert.equal(element.isDeleted, false)
  assert.equal(element.version, 1)
  assert.equal(element.updated, 1000)
  assert.equal(typeof element.id, 'string')
  assert.ok(element.id.length === 20)
})

test('arrow factory computes bounds from relative points and defaults the head', () => {
  const arrow = createElement({
    type: 'arrow',
    x: 0,
    y: 0,
    points: [[0, 0], [120, 60], [200, 30]],
  })
  assert.deepEqual(arrow.points, [[0, 0], [120, 60], [200, 30]])
  assert.equal(arrow.width, 200)
  assert.equal(arrow.height, 60)
  assert.equal(arrow.endArrowhead, 'arrow')
  assert.equal(arrow.startArrowhead, null)
  assert.equal(arrow.elbowed, false)
})

test('text factory measures multiline text and uses Excalifont by default', () => {
  const element = createElement({ type: 'text', x: 0, y: 0, text: 'Hello\n世界' }, { random: deterministicRandom })
  assert.equal(element.text, 'Hello\n世界')
  assert.equal(element.originalText, 'Hello\n世界')
  assert.equal(element.fontFamily, 5)
  assert.equal(element.fontSize, 20)
  assert.equal(element.textAlign, 'left')
  assert.equal(element.lineHeight, 1.25)
  assert.equal(element.height, Math.ceil(2 * 20 * 1.25))
  assert.ok(element.width > 0)
  const measured = measureText('Hello\n世界', 20)
  assert.equal(element.width, measured.width)
})

test('image elements require an explicit fileId', () => {
  assert.throws(
    () => createElement({ type: 'image', x: 0, y: 0, width: 10, height: 10 }),
    (error: unknown) => error instanceof SceneError && error.code === 'invalid_operation',
  )
  const image = createElement({ type: 'image', x: 0, y: 0, width: 10, height: 10, fileId: 'file-a' })
  assert.equal(image.fileId, 'file-a')
  assert.equal(image.status, 'saved')
})

test('unsafe links are dropped, http and element links survive', () => {
  assert.equal(sanitizeLink('javascript:alert(1)'), null)
  assert.equal(sanitizeLink('https://example.com'), 'https://example.com')
  assert.equal(sanitizeLink('#element-1'), '#element-1')
  assert.equal(sanitizeLink('[[note]]'), '[[note]]')
})

test('prototype-polluting keys are rejected', () => {
  const payload = JSON.parse('{"type":"rectangle","x":0,"y":0,"__proto__":{"polluted":true}}')
  assert.throws(
    () => normalizeElement(payload),
    (error: unknown) => error instanceof SceneError && error.code === 'invalid_scene',
  )
})

test('normalizeElement preserves unknown well-formed fields for round-trip fidelity', () => {
  const element = normalizeElement({
    id: 'abc',
    type: 'rectangle',
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    angle: 0,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 7,
    versionNonce: 2,
    isDeleted: false,
    boundElements: null,
    updated: 99,
    link: null,
    locked: false,
    customData: { keep: true },
  })
  assert.equal(element.version, 7)
  assert.deepEqual(element.customData, { keep: true })
  assert.equal(element.seed, 1)
})

test('scene creation and serialization are stable', () => {
  const scene = createScene({ elements: [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] })
  assert.equal(scene.type, 'excalidraw')
  assert.equal(scene.version, 2)
  assert.equal(scene.elements.length, 1)
  const text = serializeScene(scene)
  assert.ok(text.endsWith('\n'))
  const reparsed = parseScene(text)
  assert.deepEqual(reparsed, scene)
})

test('apply add/update/delete is atomic and repairs bindings', () => {
  const scene = createScene({ elements: [{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 100, height: 60 }] })
  const added = applyOperations(scene, [
    { op: 'add', element: { type: 'arrow', x: 0, y: 30, points: [[0, 0], [140, 0]], startElementId: 'box' } },
  ])
  const arrow = added.scene.elements.find(element => element.type === 'arrow')!
  const box = added.scene.elements.find(element => element.id === 'box')!
  assert.equal((arrow.startBinding as { elementId: string }).elementId, 'box')
  assert.ok(box.boundElements?.some(entry => entry.id === arrow.id))
  const updated = applyOperations(added.scene, [{ op: 'update', id: arrow.id, patch: { strokeColor: '#ff0000' } }])
  assert.equal(updated.scene.elements.find(element => element.id === arrow.id)!.strokeColor, '#ff0000')
  const deleted = applyOperations(updated.scene, [{ op: 'delete', id: 'box' }])
  assert.equal(deleted.scene.elements.find(element => element.id === 'box')!.isDeleted, true)
  assert.equal(deleted.scene.elements.find(element => element.id === arrow.id)!.startBinding, null)
})

test('apply rejects unknown patch fields and changes atomically', () => {
  const scene = createScene({ elements: [{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 10, height: 10 }] })
  assert.throws(
    () => applyOperations(scene, [{ op: 'update', id: 'box', patch: { fillStyle: 'solid', surprise: true } as never }]),
    (error: unknown) => error instanceof SceneError && error.code === 'invalid_operation',
  )
  assert.equal(scene.elements[0]!.fillStyle, 'solid')
})

test('validateScene reports duplicate ids and unsupported types', () => {
  const result = validateScene({
    type: 'excalidraw',
    version: 2,
    elements: [
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
      { id: 'b', type: 'hologram', x: 0, y: 0, width: 1, height: 1 },
    ],
    appState: {},
    files: {},
  })
  assert.equal(result.valid, false)
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'duplicate_id'))
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'unsupported_element'))
})

test('readable types are a documented superset of creatable types', () => {
  assert.equal(isReadableType('frame'), true)
  assert.equal(isReadableType('hologram'), false)
})
