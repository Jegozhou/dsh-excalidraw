/**
 * DSH Excalidraw — Host half.
 *
 * Owns the drawings directory, the revision-checked scene store, the HTTP API
 * the browser half calls, and the agent tools. Everything is registered through
 * `ctx.effect`/`ctx.inject` so disabling the plugin removes routes and tools
 * with no leftovers.
 * @module host/index
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ExcalidrawService } from './service.ts'
import { ApiServer, API_PREFIX, ASSET_PREFIX, createAssetHandler } from './api.ts'
import { registerTools } from './tools.ts'
import type { SceneLimits } from '../core/scene.ts'

/** Plugin id used in logs and in the data directory name. */
export const PLUGIN_ID = 'dsh-excalidraw'
/** Version reported by the health endpoint and the editor handshake. */
export const VERSION = '0.1.0'
/** Services the plugin cannot work without. */
export const inject = ['tools']

/** User-tunable configuration supplied by the bundle patch. */
export interface Config {
  /** Absolute drawings directory. Empty means `<DSH_HOME>/excalidraw/drawings`. */
  drawingsDir?: string
  /** Serialized scene byte cap. */
  maxSceneBytes?: number
  /** Element count cap. */
  maxElements?: number
  /** Attachment count cap. */
  maxFiles?: number
  /** Per-text-element character cap. */
  maxTextLength?: number
}

interface PluginContext {
  logger?: {
    info?: (message: string) => void
    warn?: (message: string) => void
    error?: (message: string) => void
  }
  tools?: { register: (definition: never) => () => void }
  effect?: (callback: () => void | (() => void), label?: string) => unknown
  inject?: (names: string[], callback: (context: PluginContext) => void) => void
  get?: (name: string) => unknown
  provide?: (name: string, value: unknown) => () => void
}

/** Resolve the drawings directory without touching the filesystem. */
export function resolveDrawingsDir(configured: unknown, dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')): string {
  if (typeof configured === 'string' && configured.trim().length > 0) {
    const value = configured.trim()
    return value.startsWith('~') ? join(homedir(), value.slice(1)) : value
  }
  return join(dshHome, 'excalidraw', 'drawings')
}

/** Resolve the package's static asset directory. */
export function resolveAssetsDir(metaUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('../assets/', metaUrl))
}

/** Validate and clamp the plugin configuration. */
export function normalizeConfig(config: Config = {}): Required<Config> & { limits: SceneLimits } {
  const maxSceneBytes = clamp(config.maxSceneBytes, 1_048_576, 67_108_864, 16_777_216)
  const limits: SceneLimits = {
    maxBytes: maxSceneBytes,
    maxElements: clamp(config.maxElements, 1, 20_000, 5_000),
    maxFiles: clamp(config.maxFiles, 0, 256, 64),
    maxFileBytes: Math.min(8_388_608, Math.floor(maxSceneBytes / 2)),
    maxTextLength: clamp(config.maxTextLength, 100, 100_000, 20_000),
  }
  return {
    drawingsDir: typeof config.drawingsDir === 'string' ? config.drawingsDir : '',
    maxSceneBytes,
    maxElements: limits.maxElements,
    maxFiles: limits.maxFiles,
    maxTextLength: limits.maxTextLength,
    limits,
  }
}

/** Cordis plugin body. */
export function apply(ctx: PluginContext, config: Config = {}): void {
  const settings = normalizeConfig(config)
  const log = (message: string, error?: unknown): void => {
    const suffix = error === undefined ? '' : ` ${error instanceof Error ? error.message : String(error)}`
    if (error !== undefined) ctx.logger?.warn?.(`${PLUGIN_ID}: ${message}${suffix}`)
    else ctx.logger?.info?.(`${PLUGIN_ID}: ${message}`)
  }

  const drawingsDir = resolveDrawingsDir(settings.drawingsDir)
  const service = new ExcalidrawService({
    rootDir: drawingsDir,
    limits: settings.limits,
    version: VERSION,
  })

  // Start initialization now; calls await the same promise, so a tool invoked
  // immediately after activation cannot observe a half-created directory.
  service.ready().then(
    () => log(`ready — drawings in ${drawingsDir}`),
    error => log('could not initialize the drawings directory', error),
  )

  const disposeService = ctx.provide?.('excalidrawScenes', service)
  if (disposeService) {
    ctx.effect?.(() => disposeService, `${PLUGIN_ID}: service`)
  }

  const admit = (req: import('node:http').IncomingMessage): number | undefined => {
    const connection = ctx.get?.('connection') as { requestRejection?: (request: unknown) => number | undefined } | undefined
    return connection?.requestRejection?.(req)
  }
  const api = new ApiServer({ service, admit, log })

  ctx.inject?.(['webServer'], webContext => {
    if (typeof (webContext as { webServer?: { register?: unknown } }).webServer?.register !== 'function') return
    const webServer = (webContext as { webServer: { register: (route: unknown) => () => void } }).webServer
    webContext.effect?.(() => webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => api.handle(req, res),
    }), `${PLUGIN_ID}: ${API_PREFIX}`)
    const assets = createAssetHandler(resolveAssetsDir(), admit)
    webContext.effect?.(() => webServer.register({
      kind: 'prefix',
      path: ASSET_PREFIX,
      handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => assets(req, res),
    }), `${PLUGIN_ID}: ${ASSET_PREFIX}`)
  })

  const toolDisposers = ctx.tools === undefined ? [] : registerTools(ctx as never, service)
  ctx.effect?.(() => () => {
    for (const dispose of toolDisposers) dispose()
  }, `${PLUGIN_ID}: tools`)

  log(`activated — ${toolDisposers.length} tools, drawings in ${drawingsDir}`)
}

/** Clamp a numeric config value. */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.trunc(number), min), max)
}
