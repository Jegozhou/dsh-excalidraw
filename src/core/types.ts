/**
 * Core scene types for the DSH Excalidraw plugin.
 *
 * The file format is the public `.excalidraw` JSON format (version 2) used by
 * Excalidraw 0.18.x. Only a deliberately small, documented subset is authored
 * by this plugin; unknown-but-well-formed element fields are preserved so a
 * scene produced by Excalidraw itself round-trips without loss.
 *
 * @module core/types
 */

/** Element types this plugin can create from agent input. */
export const CREATABLE_ELEMENT_TYPES = [
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'text',
  'freedraw',
  'image',
] as const

export type CreatableElementType = (typeof CREATABLE_ELEMENT_TYPES)[number]

/** Element types this plugin can read, preserve and render through Excalidraw. */
export const READABLE_ELEMENT_TYPES = [
  ...CREATABLE_ELEMENT_TYPES,
  'frame',
  'magicframe',
  'embeddable',
  'iframe',
] as const

export type ElementType = (typeof READABLE_ELEMENT_TYPES)[number]

/** A point in scene coordinates for linear/free-draw elements. */
export type Point = [number, number]

/** One element of an Excalidraw scene. */
export interface SceneElement {
  id: string
  type: ElementType | string
  x: number
  y: number
  width: number
  height: number
  angle: number
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  strokeStyle: string
  roughness: number
  opacity: number
  groupIds: string[]
  frameId: string | null
  roundness: { type: number } | null
  seed: number
  version: number
  versionNonce: number
  isDeleted: boolean
  boundElements: Array<{ id: string; type: string }> | null
  updated: number
  link: string | null
  locked: boolean
  customData?: Record<string, unknown>
  /** Linear elements. */
  points?: Point[]
  lastCommittedPoint?: Point | null
  startBinding?: { elementId: string; focus: number; gap: number } | null
  endBinding?: { elementId: string; focus: number; gap: number } | null
  startArrowhead?: string | null
  endArrowhead?: string | null
  elbowed?: boolean
  fixedSegments?: unknown[] | null
  /** Text elements. */
  text?: string
  originalText?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  containerId?: string | null
  lineHeight?: number
  autoResize?: boolean
  /** Image elements. */
  fileId?: string
  status?: string
  scale?: Point
  crop?: unknown
  /** Frame elements. */
  name?: string
  /** Allow future well-formed fields to survive a round-trip. */
  [extra: string]: unknown
}

/** Binary payload attached to an image element, keyed by fileId. */
export interface SceneFile {
  mimeType: string
  id: string
  dataURL: string
  created: number
  lastRetrieved?: number
}

/** App-state keys this plugin preserves. */
export interface SceneAppState {
  viewBackgroundColor: string
  gridSize: number | null
  gridModeEnabled?: boolean
  [extra: string]: unknown
}

/** A complete `.excalidraw` document. */
export interface Scene {
  type: 'excalidraw'
  version: 2
  source: string
  elements: SceneElement[]
  appState: SceneAppState
  files: Record<string, SceneFile>
}

/** Scene plus the persistence facts the caller needs to reason about a write. */
export interface SceneRecord {
  scene: Scene
  revision: number
  sha256: string
  byteLength: number
  elementCount: number
  updatedAt: string
  updatedBy: string
  /** Present when an idempotent retry matched a previous request id. */
  duplicate?: boolean
}

/** Lightweight listing row. */
export interface SceneSummary {
  name: string
  revision: number
  elementCount: number
  byteLength: number
  updatedAt: string
  updatedBy: string
  sha256: string
  valid: boolean
}

/** Result of a successful write, with the read-back verification facts. */
export interface SaveEvidence {
  name: string
  revision: number
  sha256: string
  byteLength: number
  elementCount: number
  savedAt: string
  verified: true
  duplicate: boolean
  previousRevision: number | null
}

/** How an agent creates an element: the strict, typed input subset. */
export interface ElementInput {
  id?: string
  type: CreatableElementType
  x: number
  y: number
  width?: number
  height?: number
  angle?: number
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch' | 'dots' | 'zigzag' | 'dashed' | 'zigzag-line'
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  roughness?: number
  opacity?: number
  roundness?: { type: number } | null
  groupIds?: string[]
  locked?: boolean
  link?: string | null
  /** Linear elements. */
  points?: Point[]
  startArrowhead?: string | null
  endArrowhead?: string | null
  startElementId?: string | null
  endElementId?: string | null
  /** Text elements. */
  text?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** Free-draw elements. */
  pressures?: number[]
  simulatePressure?: boolean
  /** Image elements; the fileId must exist in `files`. */
  fileId?: string
}

/** Updateable visual props for an existing element. */
export interface ElementPatch {
  x?: number
  y?: number
  width?: number
  height?: number
  angle?: number
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  strokeStyle?: string
  roughness?: number
  opacity?: number
  text?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  points?: Point[]
  startArrowhead?: string | null
  endArrowhead?: string | null
  link?: string | null
  locked?: boolean
  roundness?: { type: number } | null
}

/** One agent mutation. */
export type SceneOperation =
  | { op: 'add'; element: ElementInput }
  | { op: 'update'; id: string; patch: ElementPatch }
  | { op: 'delete'; id: string }

/** A diagnostic produced by the validator. */
export interface Diagnostic {
  code: string
  message: string
  path?: string
  elementId?: string
  severity: 'error' | 'warning'
}

/** Result of validating a scene. */
export interface ValidationResult {
  valid: boolean
  diagnostics: Diagnostic[]
  stats: {
    elements: number
    deleted: number
    files: number
    unsupportedTypes: string[]
    bounds: { x: number; y: number; width: number; height: number } | null
  }
}
