/**
 * Plugin lifecycle tests with a fake Cordis context.
 * They prove that activation registers exactly the documented resources and
 * that disposing every effect removes tools, routes and the provided service.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { apply, normalizeConfig, PLUGIN_ID, resolveDrawingsDir } from '../../src/host/index.ts'
import { API_PREFIX, ASSET_PREFIX } from '../../src/host/api.ts'

interface Effect {
  label: string
  cleanup: () => void
}

interface FakeTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> }
  disposed?: boolean
}

const directories: string[] = []

after(async () => {
  await Promise.all(directories.map(dir => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })))
})

async function makeContext(): Promise<{
  ctx: any
  effects: Effect[]
  tools: FakeTool[]
  routes: Array<{ kind: string; path: string; handler: unknown; disposed?: boolean }>
  services: Map<string, unknown>
}> {
  const effects: Effect[] = []
  const tools: FakeTool[] = []
  const routes: Array<{ kind: string; path: string; handler: unknown; disposed?: boolean }> = []
  const services = new Map<string, unknown>()

  const registerEffect = (callback: () => void | (() => void), label = ''): (() => void) => {
    const cleanup = callback()
    effects.push({ label, cleanup: typeof cleanup === 'function' ? cleanup : () => undefined })
    return () => undefined
  }

  const ctx = {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    effect: registerEffect,
    inject: (names: string[], callback: (context: any) => void) => {
      if (!names.includes('webServer')) return
      const webContext = {
        webServer: {
          register: (route: any) => {
            routes.push(route)
            return () => { route.disposed = true }
          },
        },
        effect: registerEffect,
      }
      callback(webContext)
    },
    tools: {
      register: (definition: FakeTool) => {
        tools.push(definition)
        return () => { definition.disposed = true }
      },
    },
    get: () => ({ requestRejection: () => undefined }),
    provide: (name: string, value: unknown) => {
      services.set(name, value)
      return () => { services.delete(name) }
    },
  }
  return { ctx, effects, tools, routes, services }
}

test('activation registers five typed tools, two routes and one service', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-excalidraw-life-'))
  directories.push(dir)
  const { ctx, effects, tools, routes, services } = await makeContext()
  apply(ctx, { drawingsDir: join(dir, 'drawings') })

  assert.equal(tools.length, 5)
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'excalidraw_scene_apply',
    'excalidraw_scene_create',
    'excalidraw_scene_list',
    'excalidraw_scene_read',
    'excalidraw_scene_validate',
  ])
  for (const tool of tools) {
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    assert.ok(String(tool.description).length > 40)
    const rendered = tool.output.render({}, { ok: true })
    assert.equal(rendered[0]?.type, 'text')
    assert.match(rendered[0]?.text ?? '', /"ok": true/u)
  }
  assert.equal(routes.length, 2)
  assert.deepEqual(routes.map(route => [route.kind, route.path]).sort(), [
    ['prefix', API_PREFIX],
    ['prefix', ASSET_PREFIX],
  ].sort())
  const service = services.get('excalidrawScenes') as { ready: () => Promise<void> }
  assert.ok(service)
  await service.ready()

  // Execute one tool through the same path the model uses.
  const create = tools.find(tool => tool.name === 'excalidraw_scene_create')!
  const created = await create.execute({
    name: 'lifecycle',
    elements: [{ type: 'rectangle', x: 0, y: 0, width: 50, height: 50 }],
  }) as { ok: boolean; revision: number; sha256: string; verified: boolean }
  assert.equal(created.ok, true)
  assert.equal(created.revision, 1)
  assert.equal(created.verified, true)
  assert.match(created.sha256, /^[0-9a-f]{64}$/u)

  const read = tools.find(tool => tool.name === 'excalidraw_scene_read')!
  const readResult = await read.execute({ name: 'lifecycle' }) as { ok: boolean; revision: number }
  assert.equal(readResult.ok, true)
  assert.equal(readResult.revision, 1)

  const applyTool = tools.find(tool => tool.name === 'excalidraw_scene_apply')!
  const applied = await applyTool.execute({
    name: 'lifecycle',
    expected_revision: 1,
    operations: [{ op: 'delete', id: (readResult as unknown as { scene: { elements: Array<{ id: string }> } }).scene.elements[0]!.id }],
  }) as { ok: boolean; revision: number; operations: { deleted: number } }
  assert.equal(applied.ok, true)
  assert.equal(applied.revision, 2)
  assert.equal(applied.operations.deleted, 1)

  const conflict = await applyTool.execute({
    name: 'lifecycle',
    expected_revision: 1,
    operations: [{ op: 'update', id: 'missing', patch: { x: 1 } }],
  }) as { ok: boolean; error: { code: string } }
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error.code, 'revision_conflict')

  const invalid = await create.execute({ name: '../escape', elements: [] }) as { ok: boolean; error: { code: string } }
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'invalid_name')

  // Disposal removes every registration.
  for (const effect of effects.reverse()) effect.cleanup()
  assert.ok(tools.every(tool => tool.disposed === true))
  assert.ok(routes.every(route => route.disposed === true))
  assert.equal(services.has('excalidrawScenes'), false)
  assert.equal(effects.every(effect => typeof effect.cleanup === 'function'), true)
})

test('configuration is clamped and defaults live under DSH_HOME', () => {
  const settings = normalizeConfig({
    maxSceneBytes: 1,
    maxElements: 999_999,
    maxFiles: -3,
    maxTextLength: 1,
  })
  assert.equal(settings.maxSceneBytes, 1_048_576)
  assert.equal(settings.maxElements, 20_000)
  assert.equal(settings.maxFiles, 0)
  assert.equal(settings.maxTextLength, 100)
  assert.equal(settings.limits.maxBytes, 1_048_576)
  assert.equal(resolveDrawingsDir('', '/tmp/dsh-home'), '/tmp/dsh-home/excalidraw/drawings')
  assert.equal(resolveDrawingsDir('/var/lib/drawings'), '/var/lib/drawings')
  assert.equal(PLUGIN_ID, 'dsh-excalidraw')
})

test('a context without a web carrier still gets tools', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-excalidraw-headless-'))
  directories.push(dir)
  const { ctx, tools, routes, services } = await makeContext()
  ctx.inject = () => undefined
  apply(ctx, { drawingsDir: join(dir, 'drawings') })
  const service = services.get('excalidrawScenes') as { ready: () => Promise<void> }
  await service.ready()
  assert.equal(tools.length, 5)
  assert.equal(routes.length, 0)
})
