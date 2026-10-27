/**
 * Scene document construction, parsing, serialization and mutation.
 * All mutations are pure: callers receive a new scene and decide when to persist.
 * @module core/scene
 */

import { SceneError } from './errors.ts'
import {
  assertSafeKeys,
  bumpElement,
  createElement,
  isFiniteNumber,
  isLinearElement,
  isReadableType,
  measureText,
  normalizeAppState,
  normalizeElement,
  normalizeFile,
  sceneBounds,
  validateScene,
} from './elements.ts'
import { SCENE_SOURCE } from './elements.ts'
import type {
  Diagnostic,
  ElementInput,
  ElementPatch,
  Scene,
  SceneElement,
  SceneFile,
  SceneOperation,
  ValidationResult,
} from './types.ts'

/** Default structural limits; the Host config can only tighten them. */
export interface SceneLimits {
  maxElements: number
  maxFiles: number
  maxFileBytes: number
  maxTextLength: number
  /** Serialized scene size cap. */
  maxBytes: number
}

export const DEFAULT_LIMITS: SceneLimits = {
  maxElements: 5_000,
  maxFiles: 64,
  maxFileBytes: 8 * 1024 * 1024,
  maxTextLength: 20_000,
  maxBytes: 16 * 1024 * 1024,
}

/** Parse and normalize a serialized scene. */
export function parseScene(text: string | object, limits: SceneLimits = DEFAULT_LIMITS): Scene {
  let raw: unknown = text
  if (typeof text === 'string') {
    try {
      raw = JSON.parse(text)
    } catch (error) {
      throw new SceneError('invalid_scene', `the scene is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return normalizeScene(raw, limits)
}

/** Validate then normalize a scene object. */
export function normalizeScene(raw: unknown, limits: SceneLimits = DEFAULT_LIMITS): Scene {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SceneError('invalid_scene', 'the scene must be a JSON object')
  }
  assertSafeKeys(raw)
  const document = raw as Record<string, unknown>
  const result = validateScene(document, { maxElements: limits.maxElements })
  const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  if (errors.length > 0) {
    throw new SceneError('invalid_scene', errors[0]!.message, { diagnostics: errors })
  }
  const elements = (document.elements as unknown[]).map(entry => normalizeElement(entry))
  const files = normalizeFiles(document.files, limits)
  const appState = normalizeAppState(document.appState)
  const scene: Scene = {
    type: 'excalidraw',
    version: 2,
    source: typeof document.source === 'string' && document.source.length > 0 ? document.source : SCENE_SOURCE,
    elements,
    appState,
    files,
  }
  repairReferences(scene.elements)
  verifyFileReferences(scene, limits)
  return scene
}

/** Build a scene from the agent input subset. */
export function createScene(input: {
  elements?: ElementInput[]
  appState?: unknown
  files?: Record<string, SceneFile>
}, limits: SceneLimits = DEFAULT_LIMITS): Scene {
  if (input.elements !== undefined && !Array.isArray(input.elements)) {
    throw new SceneError('invalid_scene', 'elements must be an array')
  }
  const elements = (input.elements ?? []).map(entry => createElement(entry))
  if (elements.length > limits.maxElements) {
    throw new SceneError('too_many_elements', `scene has ${elements.length} elements; the limit is ${limits.maxElements}`)
  }
  const files = normalizeFiles(input.files ?? {}, limits)
  const scene: Scene = {
    type: 'excalidraw',
    version: 2,
    source: SCENE_SOURCE,
    elements,
    appState: normalizeAppState(input.appState),
    files,
  }
  repairReferences(scene.elements)
  verifyFileReferences(scene, limits)
  return scene
}

/** Normalize and cap the binary attachment map. */
function normalizeFiles(raw: unknown, limits: SceneLimits): Record<string, SceneFile> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SceneError('invalid_scene', 'scene.files must be an object')
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > limits.maxFiles) {
    throw new SceneError('too_large', `scene has ${entries.length} files; the limit is ${limits.maxFiles}`)
  }
  let total = 0
  const files: Record<string, SceneFile> = {}
  for (const [fileId, value] of entries) {
    const file = normalizeFile(value, fileId)
    total += file.dataURL.length
    if (total > limits.maxFileBytes) {
      throw new SceneError('too_large', `scene attachments exceed ${limits.maxFileBytes} characters`)
    }
    files[fileId] = file
  }
  return files
}

/** Ensure every image element points at an existing file. */
function verifyFileReferences(scene: Scene, limits: SceneLimits): void {
  for (const element of scene.elements) {
    if (element.type === 'image' && !element.isDeleted) {
      if (typeof element.fileId !== 'string' || element.fileId.length === 0 || scene.files[element.fileId] === undefined) {
        throw new SceneError('invalid_reference', `image element "${element.id}" references a missing file`, { elementId: element.id })
      }
    }
    if (element.type === 'text' && typeof element.text === 'string' && element.text.length > limits.maxTextLength) {
      throw new SceneError('too_large', `text element "${element.id}" exceeds ${limits.maxTextLength} characters`, { elementId: element.id })
    }
  }
}

/** Drop dangling bindings and restore missing reverse binding entries. */
export function repairReferences(elements: SceneElement[]): void {
  const live = new Map(elements.filter(element => !element.isDeleted).map(element => [element.id, element]))
  for (const element of elements) {
    if (element.isDeleted) continue
    if (isLinearElement(element)) {
      for (const key of ['startBinding', 'endBinding'] as const) {
        const binding = element[key]
        if (binding && !live.has(binding.elementId)) element[key] = null
      }
    }
    if (Array.isArray(element.boundElements)) {
      element.boundElements = element.boundElements.filter(entry => live.has(entry.id))
    }
  }
  for (const element of elements) {
    if (element.isDeleted || !isLinearElement(element)) continue
    for (const binding of [element.startBinding, element.endBinding]) {
      if (!binding) continue
      const target = live.get(binding.elementId)
      if (!target) continue
      if (!Array.isArray(target.boundElements)) target.boundElements = []
      if (!target.boundElements.some(entry => entry.id === element.id)) {
        target.boundElements.push({ id: element.id, type: element.type })
      }
    }
  }
}

/** Serialize a scene to the exact bytes that are persisted. */
export function serializeScene(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`
}

/** Deep-clone a scene through JSON, matching on-disk semantics. */
export function cloneScene(scene: Scene): Scene {
  return JSON.parse(JSON.stringify(scene)) as Scene
}

/** Apply agent operations atomically to a copy of the scene. */
export function applyOperations(
  scene: Scene,
  operations: SceneOperation[],
  options: { random?: () => number; now?: number } = {},
): { scene: Scene; summary: { added: number; updated: number; deleted: number; ids: string[] } } {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new SceneError('invalid_operation', 'operations must be a non-empty array')
  }
  if (operations.length > 500) {
    throw new SceneError('invalid_operation', 'at most 500 operations are accepted per call')
  }
  const next = cloneScene(scene)
  const byId = new Map(next.elements.map(element => [element.id, element]))
  const summary = { added: 0, updated: 0, deleted: 0, ids: [] as string[] }
  const now = options.now ?? Date.now()
  const random = options.random ?? Math.random

  for (const [index, operation] of operations.entries()) {
    if (operation === null || typeof operation !== 'object') {
      throw new SceneError('invalid_operation', `operation ${index} must be an object`)
    }
    if (operation.op === 'add') {
      const element = createElement(operation.element, { random, now })
      if (byId.has(element.id)) {
        throw new SceneError('duplicate_id', `element id "${element.id}" already exists`, { elementId: element.id })
      }
      if (next.elements.length >= 5_000) {
        throw new SceneError('too_many_elements', 'the scene reached the element limit')
      }
      next.elements.push(element)
      byId.set(element.id, element)
      summary.added += 1
      summary.ids.push(element.id)
      applyBindings(element, operation.element, byId)
    } else if (operation.op === 'update') {
      const element = byId.get(operation.id)
      if (!element || element.isDeleted) {
        throw new SceneError('not_found', `element "${operation.id}" does not exist`, { elementId: operation.id })
      }
      applyPatch(element, operation.patch, { now, random })
      summary.updated += 1
      summary.ids.push(element.id)
    } else if (operation.op === 'delete') {
      const element = byId.get(operation.id)
      if (!element || element.isDeleted) {
        throw new SceneError('not_found', `element "${operation.id}" does not exist`, { elementId: operation.id })
      }
      tombstone(next.elements, element.id, { now, random })
      summary.deleted += 1
      summary.ids.push(element.id)
    } else {
      throw new SceneError('invalid_operation', `operation ${index} has unknown op "${String((operation as { op?: unknown }).op)}"`)
    }
  }

  repairReferences(next.elements)
  verifyFileReferences(next, DEFAULT_LIMITS)
  const validation = validateScene(next)
  if (!validation.valid) {
    const first = validation.diagnostics.find(diagnostic => diagnostic.severity === 'error')
    throw new SceneError('invalid_scene', first?.message ?? 'the mutated scene is invalid', { diagnostics: validation.diagnostics })
  }
  return { scene: next, summary }
}

/** Bind an arrow to the elements named in its input. */
function applyBindings(
  element: SceneElement,
  input: ElementInput,
  byId: Map<string, SceneElement>,
): void {
  if (!isLinearElement(element)) return
  const bind = (elementId: string | null | undefined, side: 'start' | 'end'): void => {
    if (typeof elementId !== 'string' || elementId.length === 0) return
    const target = byId.get(elementId)
    if (!target || target.isDeleted) {
      throw new SceneError('invalid_reference', `cannot bind to missing element "${elementId}"`, { elementId })
    }
    const binding = { elementId, focus: 0, gap: 1 }
    if (side === 'start') element.startBinding = binding
    else element.endBinding = binding
    if (!Array.isArray(target.boundElements)) target.boundElements = []
    if (!target.boundElements.some(entry => entry.id === element.id)) {
      target.boundElements.push({ id: element.id, type: element.type })
    }
  }
  bind(input.startElementId, 'start')
  bind(input.endElementId, 'end')
}

/** Marker keys an update patch may change. */
const PATCH_KEYS = new Set<keyof ElementPatch>([
  'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor', 'fillStyle',
  'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'text', 'fontSize', 'fontFamily',
  'textAlign', 'verticalAlign', 'points', 'startArrowhead', 'endArrowhead', 'link',
  'locked', 'roundness',
])

/** Apply one typed patch to an element. */
function applyPatch(element: SceneElement, patch: ElementPatch, context: { now: number; random: () => number }): void {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new SceneError('invalid_operation', 'an update patch must be an object')
  }
  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.has(key as keyof ElementPatch)) {
      throw new SceneError('invalid_operation', `patch field "${key}" is not supported`, { field: key })
    }
  }
  if ((patch as Record<string, unknown>).type !== undefined) {
    throw new SceneError('invalid_operation', 'an element type cannot be changed by a patch')
  }
  const target = element as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (key === 'points') {
      if (!isLinearElement(element)) throw new SceneError('invalid_operation', 'points can only update linear elements')
      if (!Array.isArray(value) || value.length < 2) throw new SceneError('invalid_operation', 'points must have at least two points')
      const normalized = value.map((point) => {
        if (!Array.isArray(point) || point.length < 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) {
          throw new SceneError('invalid_operation', 'points must be finite pairs')
        }
        return [point[0], point[1]] as [number, number]
      })
      element.points = normalized
      const xs = normalized.map(point => point[0])
      const ys = normalized.map(point => point[1])
      element.width = Math.max(...xs) - Math.min(...xs)
      element.height = Math.max(...ys) - Math.min(...ys)
      continue
    }
    if (key === 'text') {
      if (element.type !== 'text') throw new SceneError('invalid_operation', 'text can only update text elements')
      if (typeof value !== 'string') throw new SceneError('invalid_operation', 'text must be a string')
      element.text = value.slice(0, 20_000)
      element.originalText = element.text
      const measured = measureText(element.text, element.fontSize ?? 20)
      element.width = measured.width
      element.height = measured.height
      continue
    }
    if (key === 'link') {
      element.link = typeof value === 'string' ? value.slice(0, 2048) : null
      continue
    }
    if (key === 'roundness') {
      element.roundness = value === null ? null : (typeof value === 'object' && isFiniteNumber((value as { type?: unknown }).type) ? { type: (value as { type: number }).type } : null)
      continue
    }
    if (key === 'width' || key === 'height') {
      if (!isFiniteNumber(value)) throw new SceneError('invalid_operation', `${key} must be a finite number`)
      target[key] = Math.abs(value)
      continue
    }
    if (['x', 'y', 'angle', 'strokeWidth', 'roughness', 'opacity', 'fontSize', 'fontFamily'].includes(key)) {
      if (!isFiniteNumber(value)) throw new SceneError('invalid_operation', `${key} must be a finite number`)
      target[key] = value
      continue
    }
    if (['strokeColor', 'backgroundColor', 'fillStyle', 'strokeStyle', 'textAlign', 'verticalAlign'].includes(key)) {
      if (typeof value !== 'string') throw new SceneError('invalid_operation', `${key} must be a string`)
      target[key] = value
      continue
    }
    if (key === 'locked') {
      if (typeof value !== 'boolean') throw new SceneError('invalid_operation', 'locked must be a boolean')
      element.locked = value
      continue
    }
    if (key === 'startArrowhead' || key === 'endArrowhead') {
      if (value !== null && typeof value !== 'string') throw new SceneError('invalid_operation', `${key} must be a string or null`)
      target[key] = value
      continue
    }
  }
  if (element.type === 'text' && (patch.fontSize !== undefined || patch.text !== undefined)) {
    const measured = measureText(element.text ?? '', element.fontSize ?? 20)
    element.width = measured.width
    element.height = measured.height
  }
  bumpElement(element, context.now, context.random)
}

/** Tombstone one element and clean references to it. */
function tombstone(elements: SceneElement[], id: string, context: { now: number; random: () => number }): void {
  const element = elements.find(entry => entry.id === id)
  if (!element) return
  element.isDeleted = true
  element.boundElements = null
  bumpElement(element, context.now, context.random)
  const descendants = elements.filter(entry => entry.containerId === id && !entry.isDeleted)
  for (const child of descendants) {
    child.isDeleted = true
    child.containerId = null
    bumpElement(child, context.now, context.random)
  }
  for (const other of elements) {
    if (other.isDeleted) continue
    if (isLinearElement(other)) {
      if (other.startBinding?.elementId === id) other.startBinding = null
      if (other.endBinding?.elementId === id) other.endBinding = null
    }
    if (Array.isArray(other.boundElements)) {
      other.boundElements = other.boundElements.filter(entry => entry.id !== id)
    }
    if (other.containerId === id) other.containerId = null
  }
}

/** Merge the caller's app-state subset over the stored one, preserving known keys. */
export function mergeAppState(scene: Scene, incoming: unknown): Scene['appState'] {
  const normalized = normalizeAppState(incoming)
  return {
    ...scene.appState,
    ...normalized,
  }
}

/** A quick structural summary of a scene for listings and tool output. */
export function summarizeScene(scene: Scene): { elements: number; deleted: number; files: number; bounds: ReturnType<typeof sceneBounds>; types: Record<string, number> } {
  const types: Record<string, number> = {}
  let deleted = 0
  for (const element of scene.elements) {
    if (element.isDeleted) {
      deleted += 1
      continue
    }
    types[element.type] = (types[element.type] ?? 0) + 1
  }
  return {
    elements: scene.elements.length - deleted,
    deleted,
    files: Object.keys(scene.files).length,
    bounds: sceneBounds(scene.elements),
    types,
  }
}

/** Keep a diagnostics reference alive for callers that want warnings. */
export type { Diagnostic, ValidationResult }
