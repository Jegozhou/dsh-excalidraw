/**
 * Element construction and normalization.
 *
 * The default field values below were captured from the official
 * `@excalidraw/excalidraw@0.18.1` `convertToExcalidrawElements` output (see
 * `docs/05-render-spike.md` and `spikes/render/artifacts/canonical-elements.json`).
 * The plugin authors its own subset rather than importing the Excalidraw package
 * on the Host, because that package is a browser application and its
 * sub-packages do not resolve cleanly outside a bundler.
 *
 * @module core/elements
 */

import { SceneError } from './errors.ts'
import type {
  ElementInput,
  Point,
  Scene,
  SceneElement,
  SceneFile,
  ValidationResult,
  Diagnostic,
} from './types.ts'
import { CREATABLE_ELEMENT_TYPES, READABLE_ELEMENT_TYPES } from './types.ts'

/** Placeholder source recorded in produced documents. */
export const SCENE_SOURCE = 'https://github.com/Jegozhou/dsh-excalidraw'

/** Deterministic-enough id alphabet, matching Excalidraw's own id shape. */
const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'

/** Create an Excalidraw-style 20 character id. */
export function createId(random: () => number = Math.random): string {
  let out = ''
  for (let index = 0; index < 20; index += 1) {
    out += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)] ?? '0'
  }
  return out
}

/** A positive 31-bit integer, like Excalidraw's seeds and nonces. */
export function createNonce(random: () => number = Math.random): number {
  return Math.floor(random() * 2_147_483_646) + 1
}

/** Approximate text width, in scene units, without a browser canvas. */
export function measureTextWidth(line: string, fontSize: number): number {
  let units = 0
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0
    if (code > 0x2e80) units += 1
    else if (character === ' ') units += 0.32
    else if (/[iIl1.,:;'!|]/.test(character)) units += 0.32
    else if (/[mwMW]/.test(character)) units += 0.85
    else units += 0.56
  }
  return Math.ceil(units * fontSize)
}

/** Compute the text box for a text element. */
export function measureText(text: string, fontSize: number): { width: number; height: number } {
  const lines = String(text ?? '').split('\n')
  const width = Math.max(1, ...lines.map(line => measureTextWidth(line, fontSize)))
  return { width, height: Math.max(1, Math.ceil(lines.length * fontSize * 1.25)) }
}

/** Whether an element type belongs to the readable set. */
export function isReadableType(type: unknown): boolean {
  return typeof type === 'string' && (READABLE_ELEMENT_TYPES as readonly string[]).includes(type)
}

/** Whether an element type can be created from agent input. */
export function isCreatableType(type: unknown): boolean {
  return typeof type === 'string' && (CREATABLE_ELEMENT_TYPES as readonly string[]).includes(type)
}

/** Whether an element is a linear element (arrow/line). */
export function isLinearElement(element: Pick<SceneElement, 'type'>): boolean {
  return element.type === 'arrow' || element.type === 'line'
}

/** Whether a value is a finite number. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Reject prototype-polluting keys from external JSON. */
export function assertSafeKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertSafeKeys(value[index], `${path}[${index}]`)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new SceneError('invalid_scene', `forbidden object key "${key}"`, { path })
    }
    assertSafeKeys((value as Record<string, unknown>)[key], `${path}.${key}`)
  }
}

/** Clamp a number into a range, rejecting non-finite input. */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

/** Normalize a URL for safe use inside a scene. */
export function sanitizeLink(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  const link = value.trim()
  if (link.length === 0 || link.length > 2048) return null
  if (/^(?:https?|mailto):/i.test(link)) return link
  if (link.startsWith('#') || link.startsWith('/')) return link
  // Excalidraw also supports element links ("#element-id") and wiki links.
  if (/^\[\[[^\]]+\]\]$/.test(link)) return link
  return null
}

/** Fill the common fields of an element. */
function common(type: string, input: Record<string, unknown>, random: () => number, now: number): SceneElement {
  const width = Math.abs(clampNumber(input.width, 100, 0, 100_000))
  const height = Math.abs(clampNumber(input.height, 100, 0, 100_000))
  return {
    id: typeof input.id === 'string' && input.id.trim().length > 0 && input.id.length <= 128
      ? input.id.trim()
      : createId(random),
    type,
    x: clampNumber(input.x, 0, -1_000_000, 1_000_000),
    y: clampNumber(input.y, 0, -1_000_000, 1_000_000),
    width,
    height,
    angle: clampNumber(input.angle, 0, -Math.PI * 2, Math.PI * 2),
    strokeColor: typeof input.strokeColor === 'string' ? input.strokeColor : '#1e1e1e',
    backgroundColor: typeof input.backgroundColor === 'string' ? input.backgroundColor : 'transparent',
    fillStyle: typeof input.fillStyle === 'string' ? input.fillStyle : 'solid',
    strokeWidth: clampNumber(input.strokeWidth, 2, 0, 100),
    strokeStyle: typeof input.strokeStyle === 'string' ? input.strokeStyle : 'solid',
    roughness: clampNumber(input.roughness, 1, 0, 10),
    opacity: clampNumber(input.opacity, 100, 0, 100),
    groupIds: Array.isArray(input.groupIds) ? input.groupIds.filter((id): id is string => typeof id === 'string').slice(0, 100) : [],
    frameId: typeof input.frameId === 'string' ? input.frameId : null,
    roundness: normalizeRoundness(input.roundness),
    seed: createNonce(random),
    version: 1,
    versionNonce: createNonce(random),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: sanitizeLink(input.link),
    locked: input.locked === true,
  }
}

/** Normalize a roundness descriptor. */
function normalizeRoundness(value: unknown): { type: number } | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object' && isFiniteNumber((value as { type?: unknown }).type)) {
    return { type: (value as { type: number }).type }
  }
  return null
}

/** A point pair normalizer. */
function points(value: unknown, fallback: Point[]): Point[] {
  if (!Array.isArray(value) || value.length < 2) return fallback
  const out: Point[] = []
  for (const entry of value.slice(0, 10_000)) {
    if (!Array.isArray(entry) || entry.length < 2 || !isFiniteNumber(entry[0]) || !isFiniteNumber(entry[1])) continue
    out.push([entry[0], entry[1]])
  }
  return out.length >= 2 ? out : fallback
}

/** Create a complete element from the strict agent input subset. */
export function createElement(
  input: ElementInput,
  options: { random?: () => number; now?: number } = {},
): SceneElement {
  const random = options.random ?? Math.random
  const now = options.now ?? Date.now()
  if (!isCreatableType(input.type)) {
    throw new SceneError('unsupported_element', `element type "${String(input.type)}" cannot be created`, { type: input.type })
  }
  const element = common(input.type, input as unknown as Record<string, unknown>, random, now)
  const width = Math.abs(isFiniteNumber(input.width) ? input.width : element.width)
  const height = Math.abs(isFiniteNumber(input.height) ? input.height : element.height)

  if (isLinearElement(element)) {
    const fallback: Point[] = [[0, 0], [width, height]]
    element.points = points(input.points, fallback)
    const xs = element.points.map(point => point[0])
    const ys = element.points.map(point => point[1])
    element.width = Math.max(...xs) - Math.min(...xs)
    element.height = Math.max(...ys) - Math.min(...ys)
    element.lastCommittedPoint = null
    element.startBinding = null
    element.endBinding = null
    element.startArrowhead = input.startArrowhead ?? null
    element.endArrowhead = element.type === 'arrow' ? (input.endArrowhead ?? 'arrow') : (input.endArrowhead ?? null)
    element.elbowed = false
    element.fixedSegments = null
    element.roundness = null
    return element
  }

  element.width = width
  element.height = height

  if (element.type === 'text') {
    const text = typeof input.text === 'string' ? input.text.slice(0, 20_000) : ''
    const fontSize = clampNumber(input.fontSize, 20, 1, 512)
    const measured = measureText(text, fontSize)
    element.text = text
    element.originalText = text
    element.fontSize = fontSize
    element.fontFamily = [1, 2, 3, 5, 6, 7, 8, 9].includes(Number(input.fontFamily)) ? Number(input.fontFamily) : 5
    element.textAlign = input.textAlign ?? 'left'
    element.verticalAlign = input.verticalAlign ?? 'top'
    element.containerId = null
    element.lineHeight = 1.25
    element.autoResize = true
    element.width = measured.width
    element.height = measured.height
    element.strokeColor = 'transparent'
    element.backgroundColor = 'transparent'
    return element
  }

  if (element.type === 'freedraw') {
    element.points = points(input.points, [[0, 0], [width, height]])
    element.pressures = Array.isArray(input.pressures) && input.pressures.every(isFiniteNumber)
      ? (input.pressures as number[]).slice(0, 10_000)
      : []
    element.simulatePressure = input.simulatePressure !== false
    element.roundness = null
    element.strokeWidth = clampNumber(input.strokeWidth, 2, 0.5, 100)
    return element
  }

  if (element.type === 'image') {
    if (typeof input.fileId !== 'string' || input.fileId.length === 0) {
      throw new SceneError('invalid_operation', 'an image element requires fileId', { elementId: element.id })
    }
    element.fileId = input.fileId
    element.status = 'saved'
    element.scale = [1, 1]
    element.crop = null
    element.roundness = null
    return element
  }

  // Rectangle / ellipse / diamond.
  element.roundness = element.type === 'rectangle' ? (input.roundness ?? { type: 3 }) : (element.type === 'diamond' ? normalizeRoundness(input.roundness) : null)
  if (element.width === 0) element.width = 100
  if (element.height === 0) element.height = 100
  return element
}

/** Fill missing fields of a full element read from an external scene. */
export function normalizeElement(raw: unknown, options: { random?: () => number; now?: number } = {}): SceneElement {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SceneError('invalid_scene', 'an element must be a JSON object')
  }
  const source = raw as Record<string, unknown>
  assertSafeKeys(source)
  if (typeof source.type !== 'string') throw new SceneError('invalid_scene', 'element.type must be a string')
  if (!isReadableType(source.type)) {
    throw new SceneError('unsupported_element', `element type "${source.type}" is outside the supported compatibility range`, { type: source.type })
  }
  const random = options.random ?? Math.random
  const now = options.now ?? Date.now()
  const base = common(source.type, source, random, now)
  const element: SceneElement = { ...source, ...base }
  // Preserve caller-supplied identity and timestamps when they are well formed.
  if (typeof source.id === 'string' && source.id.length > 0) element.id = source.id.slice(0, 128)
  if (isFiniteNumber(source.version)) element.version = Math.max(1, Math.trunc(source.version))
  if (isFiniteNumber(source.versionNonce)) element.versionNonce = Math.trunc(source.versionNonce)
  if (isFiniteNumber(source.seed)) element.seed = Math.trunc(source.seed)
  if (isFiniteNumber(source.updated)) element.updated = Math.trunc(source.updated)
  if (typeof source.isDeleted === 'boolean') element.isDeleted = source.isDeleted
  if (Array.isArray(source.boundElements)) {
    element.boundElements = source.boundElements
      .filter((entry): entry is { id: string; type: string } =>
        entry !== null && typeof entry === 'object'
        && typeof (entry as { id?: unknown }).id === 'string'
        && typeof (entry as { type?: unknown }).type === 'string')
      .slice(0, 500)
  }
  if (Array.isArray(source.groupIds)) element.groupIds = source.groupIds.filter((id): id is string => typeof id === 'string').slice(0, 100)
  if (isLinearElement(element)) {
    element.points = points(source.points, [[0, 0], [element.width, element.height]])
    element.startBinding = normalizeBinding(source.startBinding)
    element.endBinding = normalizeBinding(source.endBinding)
    element.startArrowhead = typeof source.startArrowhead === 'string' ? source.startArrowhead : null
    element.endArrowhead = typeof source.endArrowhead === 'string' ? source.endArrowhead : null
    element.lastCommittedPoint = Array.isArray(source.lastCommittedPoint) && source.lastCommittedPoint.length === 2
      ? [Number(source.lastCommittedPoint[0]), Number(source.lastCommittedPoint[1])] as Point
      : null
  }
  if (element.type === 'text') {
    element.text = typeof source.text === 'string' ? source.text : ''
    element.originalText = typeof source.originalText === 'string' ? source.originalText : element.text
    element.fontSize = clampNumber(source.fontSize, 20, 1, 512)
    element.fontFamily = isFiniteNumber(source.fontFamily) ? Number(source.fontFamily) : 5
    element.textAlign = typeof source.textAlign === 'string' ? source.textAlign : 'left'
    element.verticalAlign = typeof source.verticalAlign === 'string' ? source.verticalAlign : 'top'
    element.containerId = typeof source.containerId === 'string' ? source.containerId : null
    element.lineHeight = clampNumber(source.lineHeight, 1.25, 0.5, 4)
    element.autoResize = source.autoResize !== false
  }
  if (element.type === 'image') {
    element.fileId = typeof source.fileId === 'string' ? source.fileId : ''
    element.status = typeof source.status === 'string' ? source.status : 'saved'
    element.scale = Array.isArray(source.scale) && source.scale.length === 2 ? [Number(source.scale[0]), Number(source.scale[1])] as Point : [1, 1]
  }
  if (element.type === 'frame' || element.type === 'magicframe') {
    element.name = typeof source.name === 'string' ? source.name : ''
  }
  element.link = sanitizeLink(source.link)
  return element
}

/** Normalize a binding descriptor. */
function normalizeBinding(value: unknown): { elementId: string; focus: number; gap: number } | null {
  if (value === null || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (typeof source.elementId !== 'string') return null
  return {
    elementId: source.elementId,
    focus: isFiniteNumber(source.focus) ? source.focus : 0,
    gap: isFiniteNumber(source.gap) ? source.gap : 1,
  }
}

/** Build scene app state with safe defaults. */
export function normalizeAppState(raw: unknown): Scene['appState'] {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return {
    viewBackgroundColor: typeof source.viewBackgroundColor === 'string' ? source.viewBackgroundColor : '#ffffff',
    gridSize: isFiniteNumber(source.gridSize) ? source.gridSize : null,
    gridModeEnabled: source.gridModeEnabled === true,
  }
}

/** Build a normalized scene file record. */
export function normalizeFile(raw: unknown, id: string): SceneFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SceneError('invalid_scene', `file "${id}" must be an object`, { path: `files.${id}` })
  }
  const source = raw as Record<string, unknown>
  if (typeof source.dataURL !== 'string' || !source.dataURL.startsWith('data:')) {
    throw new SceneError('invalid_scene', `file "${id}" must carry a data URL`, { path: `files.${id}` })
  }
  if (!/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(source.dataURL)) {
    throw new SceneError('invalid_scene', `file "${id}" has an unsupported mime type`, { path: `files.${id}` })
  }
  const file: SceneFile = {
    id,
    mimeType: typeof source.mimeType === 'string' ? source.mimeType : source.dataURL.slice(5, source.dataURL.indexOf(';')),
    dataURL: source.dataURL,
    created: isFiniteNumber(source.created) ? source.created : Date.now(),
  }
  if (isFiniteNumber(source.lastRetrieved)) file.lastRetrieved = source.lastRetrieved
  return file
}

/** Compute the scene bounds of non-deleted elements. */
export function sceneBounds(elements: readonly SceneElement[]): ValidationResult['stats']['bounds'] {
  const live = elements.filter(element => !element.isDeleted)
  if (live.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const element of live) {
    const points = isLinearElement(element) && element.points ? element.points : null
    if (points) {
      for (const [px, py] of points) {
        minX = Math.min(minX, element.x + px)
        maxX = Math.max(maxX, element.x + px)
        minY = Math.min(minY, element.y + py)
        maxY = Math.max(maxY, element.y + py)
      }
    } else {
      minX = Math.min(minX, element.x)
      minY = Math.min(minY, element.y)
      maxX = Math.max(maxX, element.x + element.width)
      maxY = Math.max(maxY, element.y + element.height)
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Validate a scene without mutating it. */
export function validateScene(scene: unknown, limits: { maxElements: number } = { maxElements: 5_000 }): ValidationResult {
  const diagnostics: Diagnostic[] = []
  const push = (code: string, message: string, extra: Partial<Diagnostic> = {}): void => {
    diagnostics.push({ code, message, severity: 'error', ...extra })
  }
  const stats: ValidationResult['stats'] = {
    elements: 0,
    deleted: 0,
    files: 0,
    unsupportedTypes: [],
    bounds: null,
  }
  if (scene === null || typeof scene !== 'object' || Array.isArray(scene)) {
    push('scene_not_object', 'the scene must be a JSON object')
    return { valid: false, diagnostics, stats }
  }
  const document = scene as Record<string, unknown>
  if (document.type !== 'excalidraw') push('scene_type', 'scene.type must be "excalidraw"')
  if (document.version !== 2) push('scene_version', 'scene.version must be 2')
  if (!Array.isArray(document.elements)) {
    push('scene_elements', 'scene.elements must be an array')
    return { valid: false, diagnostics, stats }
  }
  if (document.elements.length > limits.maxElements) {
    push('too_many_elements', `scene has ${document.elements.length} elements; the limit is ${limits.maxElements}`)
  }
  const ids = new Set<string>()
  for (let index = 0; index < document.elements.length; index += 1) {
    const raw = document.elements[index]
    const path = `elements[${index}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      push('element_object', 'element must be an object', { path })
      continue
    }
    const element = raw as Record<string, unknown>
    stats.elements += 1
    if (typeof element.id !== 'string' || element.id.length === 0) push('element_id', 'element.id is required', { path })
    else if (ids.has(element.id)) push('duplicate_id', `duplicate element id "${element.id}"`, { path, elementId: element.id })
    else ids.add(element.id)
    if (typeof element.type !== 'string') {
      push('element_type', 'element.type is required', { path })
    } else if (!isReadableType(element.type)) {
      stats.unsupportedTypes.push(element.type)
      push('unsupported_element', `element type "${element.type}" is outside the supported range`, { path, elementId: String(element.id ?? '') })
    }
    for (const key of ['x', 'y', 'width', 'height', 'angle', 'strokeWidth', 'roughness', 'opacity', 'seed', 'version', 'versionNonce', 'updated']) {
      if (!isFiniteNumber(element[key])) push('element_number', `element.${key} must be a finite number`, { path, elementId: String(element.id ?? '') })
    }
    if (element.isDeleted === true) stats.deleted += 1
    if (Array.isArray(element.points)) {
      for (let pointIndex = 0; pointIndex < element.points.length; pointIndex += 1) {
        const point = element.points[pointIndex]
        if (!Array.isArray(point) || point.length < 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) {
          push('element_point', 'linear points must be finite pairs', { path: `${path}.points[${pointIndex}]`, elementId: String(element.id ?? '') })
        }
      }
    }
  }
  if (document.files !== undefined) {
    if (document.files === null || typeof document.files !== 'object' || Array.isArray(document.files)) {
      push('scene_files', 'scene.files must be an object')
    } else {
      const files = document.files as Record<string, unknown>
      stats.files = Object.keys(files).length
      for (const [fileId, file] of Object.entries(files)) {
        try {
          normalizeFile(file, fileId)
        } catch (error) {
          push('scene_file', error instanceof Error ? error.message : 'invalid file', { path: `files.${fileId}` })
        }
      }
    }
  }
  if (document.appState !== undefined && (document.appState === null || typeof document.appState !== 'object' || Array.isArray(document.appState))) {
    push('scene_appstate', 'scene.appState must be an object')
  }
  const elements = document.elements.filter((entry): entry is SceneElement =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry) && !(entry as SceneElement).isDeleted)
  try {
    stats.bounds = sceneBounds(elements)
  } catch {
    stats.bounds = null
  }
  return { valid: diagnostics.length === 0, diagnostics, stats }
}

/** Increment an element's version after a mutation. */
export function bumpElement(element: SceneElement, now = Date.now(), random: () => number = Math.random): void {
  element.version += 1
  element.versionNonce = createNonce(random)
  element.updated = now
}
