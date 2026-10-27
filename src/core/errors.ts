/**
 * Typed failures for the scene core. Every code maps to a stable HTTP status
 * and to an agent-visible error payload, so a caller can react without parsing
 * prose.
 * @module core/errors
 */

export type SceneErrorCode =
  | 'invalid_name'
  | 'not_found'
  | 'already_exists'
  | 'invalid_scene'
  | 'invalid_operation'
  | 'revision_conflict'
  | 'scene_busy'
  | 'too_large'
  | 'too_many_elements'
  | 'permission_denied'
  | 'corrupt_scene'
  | 'io_error'
  | 'unsupported_element'
  | 'duplicate_id'
  | 'invalid_reference'

const STATUS: Record<SceneErrorCode, number> = {
  invalid_name: 400,
  not_found: 404,
  already_exists: 409,
  invalid_scene: 422,
  invalid_operation: 422,
  revision_conflict: 409,
  scene_busy: 423,
  too_large: 413,
  too_many_elements: 422,
  permission_denied: 403,
  corrupt_scene: 500,
  io_error: 500,
  unsupported_element: 422,
  duplicate_id: 409,
  invalid_reference: 422,
}

/** One typed scene failure. */
export class SceneError extends Error {
  readonly code: SceneErrorCode
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(code: SceneErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'SceneError'
    this.code = code
    this.status = STATUS[code]
    this.details = details
  }

  toJSON(): { error: { code: SceneErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    }
  }
}

/** Whether a value is a SceneError. */
export function isSceneError(value: unknown): value is SceneError {
  return value instanceof SceneError
}
