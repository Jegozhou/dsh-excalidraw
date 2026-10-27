/**
 * Durable scene storage.
 *
 * Design goals, in order:
 *  1. A save returns success only after the bytes were written, fsynced and
 *     read back as a valid scene whose hash matches the reported one.
 *  2. Concurrent writers cannot silently lose each other's work: every write
 *     compares an expected revision inside a cross-process lock.
 *  3. A crash at any point leaves a recoverable directory: temp files are
 *     ignored, the previous good file is kept as `.bak`, and a meta/scene hash
 *     mismatch is reconciled on the next read.
 *  4. Agent input can never address a path outside the configured drawings
 *     directory, and symlinks are refused.
 *
 * @module core/store
 */

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { SceneError } from './errors.ts'
import { parseScene, serializeScene } from './scene.ts'
import type { SceneRecord, SceneSummary, Scene } from './types.ts'
import type { SceneLimits } from './scene.ts'
import { DEFAULT_LIMITS } from './scene.ts'

/** Metadata persisted beside (not inside) each scene. */
export interface RevisionMeta {
  schema: 'dsh-excalidraw/revision@1'
  name: string
  revision: number
  sha256: string
  byteLength: number
  elementCount: number
  updatedAt: string
  updatedBy: string
  previousRevision: number | null
  previousSha256: string | null
  recentRequests: Array<{ id: string; revision: number; sha256: string; at: string }>
}

/** Options for a write. */
export interface WriteOptions {
  actor?: string
  requestId?: string
  expectedRevision?: number
  /** Skip the revision fence. Only the browser's explicit overwrite path uses it. */
  force?: boolean
}

/** Dependencies that make the store testable. */
export interface StoreOptions {
  rootDir: string
  metaDir?: string
  limits?: Partial<SceneLimits>
  now?: () => Date
  random?: () => number
  /** Milliseconds a lock file may stay before it is considered stale. */
  staleLockMs?: number
  lockTimeoutMs?: number
}

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/u
const META_SCHEMA = 'dsh-excalidraw/revision@1' as const

/** Throw unless a scene name is safe and portable. */
export function assertSceneName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new SceneError(
      'invalid_name',
      'scene name must match [a-z0-9][a-z0-9._-]{0,63} and must not contain a path separator',
      { name },
    )
  }
  if (name.includes('..')) {
    throw new SceneError('invalid_name', 'scene name must not contain ".."', { name })
  }
}

/** Compute the sha256 of a string. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Sleep for a few milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms))
}

/** Durable scene repository rooted at one directory. */
export class SceneStore {
  readonly rootDir: string
  readonly metaDir: string
  readonly limits: SceneLimits
  private readonly now: () => Date
  private readonly random: () => number
  private readonly staleLockMs: number
  private readonly lockTimeoutMs: number
  private readonly queues = new Map<string, Promise<unknown>>()
  private initialized = false

  constructor(options: StoreOptions) {
    this.rootDir = resolve(options.rootDir)
    this.metaDir = resolve(options.metaDir ?? join(this.rootDir, '.dsh-excalidraw'))
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    this.now = options.now ?? (() => new Date())
    this.random = options.random ?? Math.random
    this.staleLockMs = options.staleLockMs ?? 30_000
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000
  }

  /** Create the directories if needed and refuse a symlinked root. */
  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 })
    const rootStat = await fs.lstat(this.rootDir)
    if (rootStat.isSymbolicLink()) {
      throw new SceneError('permission_denied', 'the drawings directory must not be a symlink')
    }
    const real = await fs.realpath(this.rootDir)
    // The parent may itself be a symlink (macOS /var -> /private/var); what
    // matters is that the leaf directory is not redirected elsewhere.
    const expected = join(await fs.realpath(dirname(this.rootDir)), basename(this.rootDir))
    if (real !== expected) {
      throw new SceneError('permission_denied', 'the drawings directory resolves outside itself', { root: this.rootDir, real, expected })
    }
    await fs.mkdir(this.metaDir, { recursive: true, mode: 0o700 })
    await fs.mkdir(join(this.metaDir, 'locks'), { recursive: true, mode: 0o700 })
    await fs.mkdir(join(this.metaDir, 'backups'), { recursive: true, mode: 0o700 })
    this.initialized = true
  }

  /** Ensure the store can be used. */
  private ensureReady(): void {
    if (!this.initialized) throw new SceneError('io_error', 'the scene store was not initialized')
  }

  /** Absolute path of one scene's JSON file, with containment checks. */
  scenePath(name: string): string {
    assertSceneName(name)
    const target = resolve(this.rootDir, `${name}.excalidraw`)
    if (dirname(target) !== this.rootDir) {
      throw new SceneError('permission_denied', 'resolved scene path escaped the drawings directory', { name })
    }
    return target
  }

  /** Absolute path of one scene's metadata file. */
  metaPath(name: string): string {
    assertSceneName(name)
    return join(this.metaDir, `${name}.meta.json`)
  }

  /** Whether a scene file exists. */
  async exists(name: string): Promise<boolean> {
    try {
      const stat = await fs.lstat(this.scenePath(name))
      if (stat.isSymbolicLink()) throw new SceneError('permission_denied', 'scene files must not be symlinks', { name })
      return stat.isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  /** List scenes, tolerating unreadable files but reporting them. */
  async list(): Promise<SceneSummary[]> {
    this.ensureReady()
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
    const summaries: SceneSummary[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
      const name = entry.name.slice(0, -'.excalidraw'.length)
      if (!NAME_PATTERN.test(name)) continue
      try {
        const record = await this.read(name, { repair: false })
        summaries.push({
          name,
          revision: record.revision,
          elementCount: record.elementCount,
          byteLength: record.byteLength,
          updatedAt: record.updatedAt,
          updatedBy: record.updatedBy,
          sha256: record.sha256,
          valid: true,
        })
      } catch (error) {
        summaries.push({
          name,
          revision: 0,
          elementCount: 0,
          byteLength: 0,
          updatedAt: '',
          updatedBy: '',
          sha256: '',
          valid: false,
        })
      }
    }
    return summaries.sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Read, validate and reconcile one scene. */
  async read(name: string, options: { repair?: boolean } = {}): Promise<SceneRecord> {
    this.ensureReady()
    const path = this.scenePath(name)
    let text: string
    try {
      const stat = await fs.lstat(path)
      if (stat.isSymbolicLink()) {
        throw new SceneError('permission_denied', 'scene files must not be symlinks', { name })
      }
      if (!stat.isFile()) throw new SceneError('not_found', `scene "${name}" is not a regular file`, { name })
      text = await fs.readFile(path, 'utf8')
    } catch (error) {
      if (error instanceof SceneError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SceneError('not_found', `scene "${name}" does not exist`, { name })
      }
      throw new SceneError('io_error', `could not read scene "${name}"`, { name, cause: String(error) })
    }
    if (Buffer.byteLength(text, 'utf8') > this.limits.maxBytes) {
      throw new SceneError('too_large', `scene "${name}" exceeds the ${this.limits.maxBytes} byte limit`)
    }
    let scene: Scene
    try {
      scene = parseScene(text, this.limits)
    } catch (error) {
      const recovered = await this.tryRecover(name, error)
      if (recovered) return recovered
      throw error instanceof SceneError
        ? new SceneError('corrupt_scene', `scene "${name}" is not readable: ${error.message}`, { name })
        : error
    }
    const digest = sha256(text)
    const meta = await this.readMeta(name)
    let revision = meta?.revision ?? 0
    let repaired = false
    if (meta && meta.sha256 !== digest) {
      // Crash between the scene rename and the meta rename, or an external edit.
      revision = meta.revision + 1
      repaired = true
    }
    if (!meta) repaired = true
    if (repaired && options.repair !== false) {
      await this.writeMeta({
        schema: META_SCHEMA,
        name,
        revision,
        sha256: digest,
        byteLength: Buffer.byteLength(text, 'utf8'),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: 'recovery',
        previousRevision: meta?.revision ?? null,
        previousSha256: meta?.sha256 ?? null,
        recentRequests: meta?.recentRequests ?? [],
      })
    }
    return {
      scene,
      revision,
      sha256: digest,
      byteLength: Buffer.byteLength(text, 'utf8'),
      elementCount: scene.elements.length,
      updatedAt: meta?.updatedAt ?? this.now().toISOString(),
      updatedBy: repaired ? 'recovery' : (meta?.updatedBy ?? 'external'),
    }
  }

  /** Create a new scene. Fails when the name already exists. */
  async create(name: string, scene: Scene, options: WriteOptions = {}): Promise<SceneRecord> {
    this.ensureReady()
    return this.withLock(name, async () => {
      if (await this.exists(name)) {
        throw new SceneError('already_exists', `scene "${name}" already exists`, { name })
      }
      const text = serializeScene(scene)
      if (Buffer.byteLength(text, 'utf8') > this.limits.maxBytes) {
        throw new SceneError('too_large', `scene exceeds the ${this.limits.maxBytes} byte limit`)
      }
      await this.writeAtomic(this.scenePath(name), text)
      const meta: RevisionMeta = {
        schema: META_SCHEMA,
        name,
        revision: 1,
        sha256: sha256(text),
        byteLength: Buffer.byteLength(text, 'utf8'),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: options.actor ?? 'agent',
        previousRevision: null,
        previousSha256: null,
        recentRequests: this.rememberRequest([], options.requestId, 1, sha256(text)),
      }
      await this.writeMeta(meta)
      return this.verifyAfterWrite(name, meta, false)
    })
  }

  /** Save a full scene under a revision fence. */
  async save(name: string, scene: Scene, options: WriteOptions = {}): Promise<SceneRecord> {
    this.ensureReady()
    return this.withLock(name, async () => {
      const current = await this.readForWrite(name)
      const duplicate = this.findRequest(current.meta, options.requestId)
      if (duplicate) {
        return {
          scene,
          revision: duplicate.revision,
          sha256: duplicate.sha256,
          byteLength: Buffer.byteLength(serializeScene(scene), 'utf8'),
          elementCount: scene.elements.length,
          updatedAt: current.meta?.updatedAt ?? this.now().toISOString(),
          updatedBy: current.meta?.updatedBy ?? 'agent',
          duplicate: true,
        } as SceneRecord
      }
      const currentRevision = current.meta?.revision ?? 0
      if (!options.force && options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
        throw new SceneError('revision_conflict', `scene "${name}" is at revision ${currentRevision}, not ${options.expectedRevision}`, {
          name,
          currentRevision,
          expectedRevision: options.expectedRevision,
          currentSha256: current.meta?.sha256 ?? null,
          updatedAt: current.meta?.updatedAt ?? null,
        })
      }
      const text = serializeScene(scene)
      if (Buffer.byteLength(text, 'utf8') > this.limits.maxBytes) {
        throw new SceneError('too_large', `scene exceeds the ${this.limits.maxBytes} byte limit`)
      }
      const nextRevision = currentRevision + 1
      const digest = sha256(text)
      await this.backup(name, currentRevision, current.text)
      await this.writeAtomic(this.scenePath(name), text)
      const meta: RevisionMeta = {
        schema: META_SCHEMA,
        name,
        revision: nextRevision,
        sha256: digest,
        byteLength: Buffer.byteLength(text, 'utf8'),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: options.actor ?? 'agent',
        previousRevision: currentRevision || null,
        previousSha256: current.meta?.sha256 ?? (current.text ? sha256(current.text) : null),
        recentRequests: this.rememberRequest(current.meta?.recentRequests ?? [], options.requestId, nextRevision, digest),
      }
      try {
        await this.writeMeta(meta)
        return await this.verifyAfterWrite(name, meta, false)
      } catch (error) {
        // The scene is on disk but the write could not be proven; put the
        // previous bytes back so callers never observe a half-successful save.
        if (current.text !== undefined) {
          await this.writeAtomic(this.scenePath(name), current.text).catch(() => undefined)
        }
        throw error
      }
    })
  }

  /** Apply a mutation under the store's lock, then persist it. */
  async mutate(
    name: string,
    mutate: (scene: Scene, record: SceneRecord) => Scene | Promise<Scene>,
    options: WriteOptions = {},
  ): Promise<SceneRecord> {
    return this.withLock(name, async () => {
      const current = await this.read(name)
      if (!options.force && options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
        throw new SceneError('revision_conflict', `scene "${name}" is at revision ${current.revision}, not ${options.expectedRevision}`, {
          name,
          currentRevision: current.revision,
          expectedRevision: options.expectedRevision,
          currentSha256: current.sha256,
        })
      }
      const next = await mutate(current.scene, current)
      return this.saveLocked(name, next, options, current)
    })
  }

  /** Save while already holding the lock. */
  private async saveLocked(name: string, scene: Scene, options: WriteOptions, current: SceneRecord): Promise<SceneRecord> {
    const duplicate = this.findRequest(await this.readMeta(name), options.requestId)
    if (duplicate) {
      return {
        scene,
        revision: duplicate.revision,
        sha256: duplicate.sha256,
        byteLength: Buffer.byteLength(serializeScene(scene), 'utf8'),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: options.actor ?? 'agent',
        duplicate: true,
      } as SceneRecord
    }
    const text = serializeScene(scene)
    if (Buffer.byteLength(text, 'utf8') > this.limits.maxBytes) {
      throw new SceneError('too_large', `scene exceeds the ${this.limits.maxBytes} byte limit`)
    }
    const digest = sha256(text)
    const meta = await this.readMeta(name)
    const nextRevision = Math.max(current.revision, meta?.revision ?? 0) + 1
    await this.backup(name, current.revision, await this.readRaw(name))
    await this.writeAtomic(this.scenePath(name), text)
    const nextMeta: RevisionMeta = {
      schema: META_SCHEMA,
      name,
      revision: nextRevision,
      sha256: digest,
      byteLength: Buffer.byteLength(text, 'utf8'),
      elementCount: scene.elements.length,
      updatedAt: this.now().toISOString(),
      updatedBy: options.actor ?? 'agent',
      previousRevision: current.revision,
      previousSha256: current.sha256,
      recentRequests: this.rememberRequest(meta?.recentRequests ?? [], options.requestId, nextRevision, digest),
    }
    await this.writeMeta(nextMeta)
    return this.verifyAfterWrite(name, nextMeta, false)
  }

  /** Read metadata, or undefined when absent. */
  async readMeta(name: string): Promise<RevisionMeta | undefined> {
    try {
      const text = await fs.readFile(this.metaPath(name), 'utf8')
      const parsed = JSON.parse(text) as RevisionMeta
      if (parsed?.schema !== META_SCHEMA || typeof parsed.revision !== 'number' || typeof parsed.sha256 !== 'string') {
        return undefined
      }
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      return undefined
    }
  }

  /** Internal read used before a write; keeps the raw text for rollback. */
  private async readForWrite(name: string): Promise<{ meta: RevisionMeta | undefined; text: string | undefined }> {
    const meta = await this.readMeta(name)
    let text: string | undefined
    try {
      text = await fs.readFile(this.scenePath(name), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return { meta, text }
  }

  /** Raw scene text for backups. */
  private async readRaw(name: string): Promise<string | undefined> {
    return (await this.readForWrite(name)).text
  }

  /** Persist metadata atomically. */
  private async writeMeta(meta: RevisionMeta): Promise<void> {
    await this.writeAtomic(this.metaPath(meta.name), `${JSON.stringify(meta, null, 2)}\n`)
  }

  /** Keep the last 32 successful request ids for idempotent retries. */
  private rememberRequest(
    existing: RevisionMeta['recentRequests'],
    requestId: string | undefined,
    revision: number,
    digest: string,
  ): RevisionMeta['recentRequests'] {
    const entries = Array.isArray(existing) ? existing.slice(-31) : []
    if (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 128) {
      entries.push({ id: requestId, revision, sha256: digest, at: this.now().toISOString() })
    }
    return entries
  }

  /** Find an already-applied request id. */
  private findRequest(meta: RevisionMeta | undefined, requestId: string | undefined): RevisionMeta['recentRequests'][number] | undefined {
    if (!meta || typeof requestId !== 'string' || requestId.length === 0) return undefined
    return meta.recentRequests?.find(entry => entry.id === requestId)
  }

  /** Copy the current file into the backup slot. */
  private async backup(name: string, revision: number, text: string | undefined): Promise<void> {
    if (text === undefined) return
    const backupPath = join(this.metaDir, 'backups', `${name}.${revision}.excalidraw`)
    await fs.writeFile(backupPath, text, { mode: 0o600 })
  }

  /** Restore the newest backup when the live file is corrupt. */
  private async tryRecover(name: string, cause: unknown): Promise<SceneRecord | null> {
    const backups = await this.listBackups(name)
    for (const candidate of backups) {
      try {
        const text = await fs.readFile(candidate, 'utf8')
        const scene = parseScene(text, this.limits)
        await this.writeAtomic(this.scenePath(name), text)
        const meta = await this.readMeta(name)
        const revision = (meta?.revision ?? 0) + 1
        const digest = sha256(text)
        const nextMeta: RevisionMeta = {
          schema: META_SCHEMA,
          name,
          revision,
          sha256: digest,
          byteLength: Buffer.byteLength(text, 'utf8'),
          elementCount: scene.elements.length,
          updatedAt: this.now().toISOString(),
          updatedBy: 'recovery',
          previousRevision: meta?.revision ?? null,
          previousSha256: meta?.sha256 ?? null,
          recentRequests: meta?.recentRequests ?? [],
        }
        await this.writeMeta(nextMeta)
        return {
          scene,
          revision,
          sha256: digest,
          byteLength: Buffer.byteLength(text, 'utf8'),
          elementCount: scene.elements.length,
          updatedAt: nextMeta.updatedAt,
          updatedBy: 'recovery',
        }
      } catch {
        // Try the next backup.
      }
    }
    void cause
    return null
  }

  /** Backups, newest first. */
  private async listBackups(name: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(join(this.metaDir, 'backups'))
      return entries
        .filter(entry => entry.startsWith(`${name}.`) && entry.endsWith('.excalidraw'))
        .map(entry => Number(entry.split('.')[1] ?? '0'))
        .filter(Number.isFinite)
        .sort((left, right) => right - left)
        .slice(0, 5)
        .map(revision => join(this.metaDir, 'backups', `${name}.${revision}.excalidraw`))
    } catch {
      return []
    }
  }

  /** Read the file back and prove it parses and hashes to the reported value. */
  private async verifyAfterWrite(name: string, meta: RevisionMeta, duplicate: boolean): Promise<SceneRecord> {
    const text = await fs.readFile(this.scenePath(name), 'utf8')
    const digest = sha256(text)
    if (digest !== meta.sha256) {
      throw new SceneError('io_error', `write verification failed for "${name}": hash mismatch`, {
        expected: meta.sha256,
        actual: digest,
      })
    }
    const scene = parseScene(text, this.limits)
    if (scene.elements.length !== meta.elementCount) {
      throw new SceneError('io_error', `write verification failed for "${name}": element count mismatch`)
    }
    return {
      scene,
      revision: meta.revision,
      sha256: digest,
      byteLength: Buffer.byteLength(text, 'utf8'),
      elementCount: scene.elements.length,
      updatedAt: meta.updatedAt,
      updatedBy: meta.updatedBy,
      duplicate,
    } as SceneRecord
  }

  /** Serialize writes for one name inside this process. */
  private withLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
    assertSceneName(name)
    const previous = this.queues.get(name) ?? Promise.resolve()
    const next = previous.then(() => this.withFileLock(name, operation))
    this.queues.set(name, next.catch(() => undefined))
    return next
  }

  /** Cross-process lock using an exclusive lock file. */
  private async withFileLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const lockPath = join(this.metaDir, 'locks', `${name}.lock`)
    const started = Date.now()
    let handle: fs.FileHandle | undefined
    while (handle === undefined) {
      try {
        handle = await fs.open(lockPath, 'wx', 0o600)
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: this.now().toISOString(), nonce: randomUUID() }))
        await handle.sync()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const stat = await fs.stat(lockPath).catch(() => undefined)
        if (stat && Date.now() - stat.mtimeMs > this.staleLockMs) {
          await fs.unlink(lockPath).catch(() => undefined)
          continue
        }
        if (Date.now() - started > this.lockTimeoutMs) {
          throw new SceneError('scene_busy', `scene "${name}" is locked by another writer`, { name })
        }
        await sleep(25)
      }
    }
    try {
      return await operation()
    } finally {
      await handle.close().catch(() => undefined)
      await fs.unlink(lockPath).catch(() => undefined)
    }
  }

  /** Write a file atomically (temp + fsync + rename + directory fsync). */
  async writeAtomic(path: string, text: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temp = `${path}.tmp-${randomUUID()}`
    let handle: fs.FileHandle | undefined
    try {
      handle = await fs.open(temp, 'wx', 0o600)
      await handle.writeFile(text, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await fs.rename(temp, path)
      await this.fsyncDirectory(dirname(path))
    } finally {
      await handle?.close().catch(() => undefined)
      await fs.unlink(temp).catch(() => undefined)
    }
  }

  /** Best-effort directory fsync, which makes the rename durable on POSIX. */
  private async fsyncDirectory(dir: string): Promise<void> {
    let handle: fs.FileHandle | undefined
    try {
      handle = await fs.open(dir, 'r')
      await handle.sync()
    } catch {
      // Some platforms refuse fsync on directories; the rename is still atomic.
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  /** Stats for the health endpoint and the lifecycle tests. */
  async stats(): Promise<{ scenes: number; bytes: number; rootDir: string; initialized: boolean }> {
    const summaries = await this.list()
    return {
      scenes: summaries.length,
      bytes: summaries.reduce((sum, summary) => sum + summary.byteLength, 0),
      rootDir: this.rootDir,
      initialized: this.initialized,
    }
  }
}
