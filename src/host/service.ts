/**
 * Host service facade shared by agent tools and the browser API.
 *
 * Both surfaces call exactly these methods, so the browser cannot bypass a
 * validation, revision or permission rule that the tools enforce (and vice
 * versa). The service owns the only store instance.
 * @module host/service
 */

import { SceneError } from '../core/errors.ts'
import { createScene, normalizeScene, summarizeScene } from '../core/scene.ts'
import type { SceneLimits } from '../core/scene.ts'
import { applyOperations } from '../core/scene.ts'
import type { Scene, SceneOperation } from '../core/types.ts'
import { SceneStore } from '../core/store.ts'
import type { SceneFile, SceneSummary } from '../core/types.ts'

/** Runtime editor evidence reported by the browser half. */
export interface EditorStatus {
  mounted: boolean
  lastEvent: string
  lastSeenAt: string | null
  mountedAt: string | null
  sceneName: string | null
  elementCount: number | null
  width: number | null
  height: number | null
  build: string | null
  error: string | null
  events: number
}

/** Options for the service. */
export interface ExcalidrawServiceOptions {
  rootDir: string
  limits: Partial<SceneLimits>
  version: string
  now?: () => Date
}

/** Create payload accepted from the browser or a tool. */
export interface CreatePayload {
  name: string
  scene?: unknown
  elements?: unknown
  appState?: unknown
  files?: Record<string, SceneFile>
  requestId?: string
  actor?: string
}

/** Save payload accepted from the browser. */
export interface SavePayload {
  scene: unknown
  expectedRevision?: number
  requestId?: string
  force?: boolean
  actor?: string
}

/** Apply payload accepted from a tool. */
export interface ApplyPayload {
  expectedRevision: number
  operations: SceneOperation[]
  requestId?: string
  actor?: string
}

/** One facade over the store. */
export class ExcalidrawService {
  readonly store: SceneStore
  readonly version: string
  private readonly now: () => Date
  private initPromise: Promise<void> | undefined
  private readonly editor: EditorStatus = {
    mounted: false,
    lastEvent: 'none',
    lastSeenAt: null,
    mountedAt: null,
    sceneName: null,
    elementCount: null,
    width: null,
    height: null,
    build: null,
    error: null,
    events: 0,
  }

  constructor(options: ExcalidrawServiceOptions) {
    this.version = options.version
    this.now = options.now ?? (() => new Date())
    this.store = new SceneStore({
      rootDir: options.rootDir,
      limits: options.limits,
      now: this.now,
    })
  }

  /** Initialize storage; safe to call repeatedly and from concurrent callers. */
  ready(): Promise<void> {
    this.initPromise ??= this.store.init()
    return this.initPromise
  }

  /** List scenes. */
  async list(): Promise<SceneSummary[]> {
    await this.ready()
    return this.store.list()
  }

  /** Read one scene with its revision facts. */
  async read(name: string) {
    await this.ready()
    return this.store.read(name)
  }

  /** Create a scene from either a full document or the typed element subset. */
  async create(payload: CreatePayload) {
    await this.ready()
    const name = payload.name
    let scene: Scene
    if (payload.scene !== undefined) {
      scene = normalizeScene(payload.scene, this.store.limits)
    } else {
      if (payload.elements !== undefined && !Array.isArray(payload.elements)) {
        throw new SceneError('invalid_scene', 'elements must be an array')
      }
      scene = createScene({
        elements: (payload.elements ?? []) as never,
        appState: payload.appState,
        files: payload.files ?? {},
      }, this.store.limits)
    }
    const record = await this.store.create(name, scene, {
      actor: payload.actor ?? 'agent',
      requestId: payload.requestId,
    })
    return { record, summary: summarizeScene(record.scene), name }
  }

  /** Save a complete document under a revision fence. */
  async save(name: string, payload: SavePayload) {
    await this.ready()
    const scene = normalizeScene(payload.scene, this.store.limits)
    const record = await this.store.save(name, scene, {
      actor: payload.actor ?? 'ui',
      requestId: payload.requestId,
      expectedRevision: payload.expectedRevision,
      force: payload.force === true,
    })
    return { record, summary: summarizeScene(record.scene) }
  }

  /** Apply typed operations under a revision fence. */
  async apply(name: string, payload: ApplyPayload) {
    await this.ready()
    const result = await this.store.mutate(name, (scene) => {
      const applied = applyOperations(scene, payload.operations)
      return applied.scene
    }, {
      actor: payload.actor ?? 'agent',
      requestId: payload.requestId,
      expectedRevision: payload.expectedRevision,
    })
    const summary = summarizeScene(result.scene)
    const operations = countOperations(payload.operations)
    return { record: result, summary, operations }
  }

  /** Record one browser heartbeat and return the accumulated status. */
  reportEditor(event: Record<string, unknown>): EditorStatus {
    this.editor.events += 1
    this.editor.lastEvent = typeof event.event === 'string' ? event.event : 'unknown'
    this.editor.lastSeenAt = this.now().toISOString()
    if (this.editor.lastEvent === 'mounted') {
      this.editor.mounted = true
      this.editor.mountedAt = this.editor.lastSeenAt
    }
    if (this.editor.lastEvent === 'unmounted') this.editor.mounted = false
    if (this.editor.lastEvent === 'error') {
      this.editor.mounted = false
      this.editor.error = typeof event.message === 'string' ? event.message.slice(0, 500) : 'unspecified editor error'
    }
    if (typeof event.sceneName === 'string') this.editor.sceneName = event.sceneName
    if (typeof event.elementCount === 'number') this.editor.elementCount = event.elementCount
    if (typeof event.width === 'number') this.editor.width = event.width
    if (typeof event.height === 'number') this.editor.height = event.height
    if (typeof event.build === 'string') this.editor.build = event.build.slice(0, 120)
    return this.editorStatus()
  }

  /** A frozen copy of the editor status. */
  editorStatus(): EditorStatus {
    return { ...this.editor }
  }

  /** Health facts that do not depend on the browser. */
  async health(): Promise<Record<string, unknown>> {
    await this.ready()
    const stats = await this.store.stats()
    return {
      ok: true,
      plugin: 'dsh-excalidraw',
      version: this.version,
      scenes: stats.scenes,
      bytes: stats.bytes,
      drawingsDir: stats.rootDir,
      editor: this.editorStatus(),
      limits: this.store.limits,
      now: this.now().toISOString(),
    }
  }
}

/** Count operations for the tool result. */
function countOperations(operations: SceneOperation[]): { added: number; updated: number; deleted: number; ids: string[] } {
  let added = 0
  let updated = 0
  let deleted = 0
  const ids: string[] = []
  for (const operation of operations) {
    if (operation.op === 'add') {
      added += 1
      if (operation.element.id) ids.push(operation.element.id)
    } else if (operation.op === 'update') {
      updated += 1
      ids.push(operation.id)
    } else if (operation.op === 'delete') {
      deleted += 1
      ids.push(operation.id)
    }
  }
  return { added, updated, deleted, ids }
}
