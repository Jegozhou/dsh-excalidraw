/**
 * Agent tools.
 *
 * Five typed tools cover the four required capabilities: discover, read,
 * create, mutate and validate scenes. Every tool delegates to the same service
 * the browser uses, so agreement between the two surfaces is structural rather
 * than duplicated logic. Failures are returned as `{ok:false,error:{...}}` so a
 * model sees the stable code and the exact reason instead of an exception
 * message from a transport.
 * @module host/tools
 */

import { isSceneError } from '../core/errors.ts'
import { validateScene } from '../core/elements.ts'
import type { SceneOperation } from '../core/types.ts'
import type { ExcalidrawService } from './service.ts'
import { TOOL_SCHEMAS } from './schema.ts'

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }> }
  presentCall?: (args: unknown) => Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

interface ToolsContext {
  tools: { register: (definition: ToolDefinition) => () => void }
}

/** Register all tools; returns their disposers. */
export function registerTools(ctx: ToolsContext, service: ExcalidrawService): Array<() => void> {
  if (typeof ctx.tools?.register !== 'function') return []
  const disposers: Array<() => void> = []

  const tool = (
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    title: string,
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ): void => {
    disposers.push(ctx.tools.register({
      name,
      description,
      parameters,
      output: {
        schema: {},
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      presentCall: args => ({ card: 'generic', title, kind: 'other', rawInput: args }),
      async execute(args) {
        try {
          return await run(args ?? {})
        } catch (error) {
          if (isSceneError(error)) {
            return {
              ok: false,
              error: {
                code: error.code,
                message: error.message,
                ...(error.details === undefined ? {} : { details: error.details }),
              },
            }
          }
          return {
            ok: false,
            error: {
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
            },
          }
        }
      },
    }))
  }

  tool(
    'excalidraw_scene_list',
    'List the Excalidraw scenes this plugin stores, with revision, element count, byte size and last writer. Use it to discover scene names before reading. Read-only.',
    TOOL_SCHEMAS.list,
    'List Excalidraw scenes',
    async () => ({ ok: true, scenes: await service.list() }),
  )

  tool(
    'excalidraw_scene_read',
    'Read one .excalidraw scene with its exact revision and sha256. Call this before excalidraw_scene_apply: the expected_revision it returns is the write fence. Use include:"summary" for large scenes.',
    TOOL_SCHEMAS.read,
    'Read Excalidraw scene',
    async (args) => {
      const name = requireString(args, 'name')
      const record = await service.read(name)
      const include = args.include === 'summary' ? 'summary' : 'full'
      const filter = typeof args.element_type === 'string' && args.element_type.length > 0 ? args.element_type : undefined
      if (include === 'summary') {
        return {
          ok: true,
          name,
          revision: record.revision,
          sha256: record.sha256,
          updatedAt: record.updatedAt,
          updatedBy: record.updatedBy,
          elementCount: record.elementCount,
          elements: record.scene.elements
            .filter(element => filter === undefined || element.type === filter)
            .map(element => ({
              id: element.id,
              type: element.type,
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              ...(element.type === 'text' ? { text: element.text } : {}),
              ...(element.isDeleted ? { isDeleted: true } : {}),
            })),
          files: Object.keys(record.scene.files),
        }
      }
      return {
        ok: true,
        name,
        revision: record.revision,
        sha256: record.sha256,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        byteLength: record.byteLength,
        scene: record.scene,
      }
    },
  )

  tool(
    'excalidraw_scene_create',
    'Create a new Excalidraw scene from typed elements (rectangle, ellipse, diamond, arrow, line, text, freedraw, image). Coordinates are scene units with y pointing down. Text width is computed on the Host. Attachments (images) use a files map keyed by fileId. Fails if the scene already exists. Returns the revision and sha256 that prove the file was verified after writing.',
    TOOL_SCHEMAS.create,
    'Create Excalidraw scene',
    async (args) => {
      const name = requireString(args, 'name')
      const created = await service.create({
        name,
        elements: args.elements,
        appState: args.app_state,
        files: args.files as never,
        requestId: optionalString(args, 'request_id'),
        actor: 'agent',
      })
      return {
        ok: true,
        name: created.name,
        revision: created.record.revision,
        sha256: created.record.sha256,
        byteLength: created.record.byteLength,
        elementCount: created.record.elementCount,
        savedAt: created.record.updatedAt,
        verified: true,
        summary: created.summary,
      }
    },
  )

  tool(
    'excalidraw_scene_apply',
    'Atomically add, update or delete elements in an existing scene. Requires expected_revision from a recent read; a concurrent change is rejected with revision_conflict and the current revision, so re-read and retry. Operations are all-or-nothing. Arrow inputs may bind to existing element ids with startElementId/endElementId. Returns the new revision and sha256 after read-back verification.',
    TOOL_SCHEMAS.apply,
    'Modify Excalidraw scene',
    async (args) => {
      const name = requireString(args, 'name')
      const expectedRevision = requireNumber(args, 'expected_revision')
      if (!Array.isArray(args.operations) || args.operations.length === 0) {
        return { ok: false, error: { code: 'invalid_operation', message: 'operations must be a non-empty array' } }
      }
      const applied = await service.apply(name, {
        expectedRevision,
        operations: args.operations as SceneOperation[],
        requestId: optionalString(args, 'request_id'),
        actor: 'agent',
      })
      return {
        ok: true,
        name,
        revision: applied.record.revision,
        previousRevision: expectedRevision,
        sha256: applied.record.sha256,
        byteLength: applied.record.byteLength,
        elementCount: applied.record.elementCount,
        savedAt: applied.record.updatedAt,
        verified: true,
        duplicate: applied.record.duplicate === true,
        operations: applied.operations,
        summary: applied.summary,
      }
    },
  )

  tool(
    'excalidraw_scene_validate',
    'Validate a complete .excalidraw document without saving it. Reports structural errors, unsupported element types, duplicate ids, invalid attachment data and scene bounds. Use it before importing an externally produced scene.',
    TOOL_SCHEMAS.validate,
    'Validate Excalidraw scene',
    async (args) => {
      if (args.scene === null || typeof args.scene !== 'object' || Array.isArray(args.scene)) {
        return { ok: false, error: { code: 'invalid_scene', message: 'scene must be a JSON object' } }
      }
      const result = validateScene(args.scene)
      return { ok: result.valid, ...result }
    },
  )

  return disposers
}

/** Read a required non-empty string argument. */
function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`"${key}" must be a non-empty string`), { code: 'invalid_operation' })
  }
  return value
}

/** Read a required finite number argument. */
function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw Object.assign(new Error(`"${key}" must be a finite number`), { code: 'invalid_operation' })
  }
  return value
}

/** Read an optional string argument. */
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
