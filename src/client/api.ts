/**
 * Browser-side API client for the Host half.
 *
 * Every call goes to the plugin's own same-origin route with the page's cookie;
 * the Host admits the request through the Harness connection service, so the
 * plugin never invents a second authentication scheme.
 * @module client/api
 */

import type { Scene, SceneSummary } from '../core/types.ts'

/** Base path of the JSON API; must match the Host's `API_PREFIX`. */
export const API_BASE = '/dsh-excalidraw/api'

/** One failed request, carrying the Host's stable error code. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** JSON request helper with a stable error envelope. */
async function request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    throw new ApiError('network', error instanceof Error ? error.message : 'network request failed', 0)
  }
  const text = await response.text()
  let payload: Record<string, unknown>
  try {
    payload = text.length === 0 ? {} : JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ApiError('bad-response', `the Host answered with non-JSON (${response.status})`, response.status)
  }
  if (!response.ok) {
    const failure = (payload.error ?? {}) as { code?: unknown; message?: unknown; details?: unknown }
    throw new ApiError(
      typeof failure.code === 'string' ? failure.code : 'http',
      typeof failure.message === 'string' ? failure.message : `request failed (${response.status})`,
      response.status,
      failure.details,
    )
  }
  return payload as T
}

/** A scene as returned by the Host. */
export interface ScenePayload {
  ok: true
  name: string
  revision: number
  sha256: string
  byteLength: number
  elementCount: number
  updatedAt: string
  updatedBy: string
  scene: Scene
}

/** One save acknowledgement. */
export interface SavePayload {
  ok: true
  name: string
  revision: number
  sha256: string
  byteLength: number
  elementCount: number
  savedAt: string
  duplicate: boolean
  summary: unknown
}

/** Scene listing. */
export interface ListPayload {
  scenes: SceneSummary[]
}

/** Health payload. */
export interface HealthPayload {
  ok: boolean
  plugin: string
  version: string
  scenes: number
  bytes: number
  drawingsDir: string
  editor: Record<string, unknown>
  limits: Record<string, unknown>
}

/** List stored scenes. */
export function listScenes(signal?: AbortSignal): Promise<ListPayload> {
  return request<ListPayload>('/scenes', { signal })
}

/** Read one scene. */
export function readScene(name: string, signal?: AbortSignal): Promise<ScenePayload> {
  return request<ScenePayload>(`/scenes/${encodeURIComponent(name)}`, { signal })
}

/** Create a scene; an empty scene is sent for the "New scene" control. */
export function createScene(name: string): Promise<SavePayload> {
  return request<SavePayload>('/scenes', {
    method: 'POST',
    body: { name, elements: [] },
  })
}

/** Save a full scene under a revision fence. */
export function saveScene(name: string, body: {
  scene: Scene
  expectedRevision: number
  requestId: string
  force?: boolean
}): Promise<SavePayload> {
  return request<SavePayload>(`/scenes/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: {
      scene: body.scene,
      expected_revision: body.expectedRevision,
      request_id: body.requestId,
      force: body.force === true,
    },
  })
}

/** Report editor lifecycle evidence to the Host. */
export function reportEditor(event: Record<string, unknown>): Promise<unknown> {
  return request('/editor-status', { method: 'POST', body: event })
}

/** Read plugin health. */
export function health(signal?: AbortSignal): Promise<HealthPayload> {
  return request<HealthPayload>('/health', { signal })
}
