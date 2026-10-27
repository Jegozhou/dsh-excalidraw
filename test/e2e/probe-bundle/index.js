/**
 * Test-only probe bundle.
 *
 * It runs inside an isolated Harness Host next to the real Excalidraw plugin
 * and calls the five tools through `ctx.tools.get(...).execute(...)`, exactly as
 * the Tool registry would. It then inspects the bytes and revision sidecar on
 * disk and writes a JSON report. It is not part of the shipped plugin.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const inject = ['tools']

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export function apply(ctx, config = {}) {
  const output = typeof config.output === 'string' ? config.output : '/tmp/dsh-excalidraw-probe.json'
  const sceneName = `${typeof config.scene === 'string' ? config.scene : 'agent-probe'}-${Date.now().toString(36)}`
  const report = {
    startedAt: new Date().toISOString(),
    ok: false,
    sceneName,
    tools: [],
    steps: {},
    error: null,
  }
  const finish = () => {
    report.finishedAt = new Date().toISOString()
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  }
  const step = async (name, operation) => {
    try {
      report.steps[name] = await operation()
      return report.steps[name]
    } catch (error) {
      report.steps[name] = { error: String(error && error.message || error) }
      throw error
    }
  }
  const call = async (name, args) => {
    const definition = ctx.tools.get(name)
    if (!definition) throw new Error(`tool ${name} is not registered`)
    return await definition.execute(args, { signal: new AbortController().signal })
  }

  void (async () => {
    try {
      // The probe row may activate before the plugin row; wait for its tools.
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        report.tools = (ctx.tools.schemas?.() ?? []).map(schema => schema.name).filter(name => name.startsWith('excalidraw_'))
        if (report.tools.length === 5) break
        await sleep(200)
      }
      if (report.tools.length !== 5) throw new Error(`expected 5 tools, saw ${JSON.stringify(report.tools)}`)

      await step('create', () => call('excalidraw_scene_create', {
        name: sceneName,
        request_id: 'probe-create-1',
        elements: [
          { id: 'probe-box', type: 'rectangle', x: 40, y: 40, width: 160, height: 90, backgroundColor: '#a5d8ff' },
          { id: 'probe-arrow', type: 'arrow', x: 210, y: 80, points: [[0, 0], [130, 40]], startElementId: 'probe-box' },
          { id: 'probe-text', type: 'text', x: 40, y: 190, text: 'agent-created scene' },
        ],
      }))

      const read1 = await step('readBefore', () => call('excalidraw_scene_read', { name: sceneName }))
      if (read1.revision !== 1) throw new Error(`expected revision 1, got ${read1.revision}`)
      if (read1.scene.elements.length !== 3) throw new Error('expected 3 elements after create')

      const applied = await step('apply', () => call('excalidraw_scene_apply', {
        name: sceneName,
        expected_revision: 1,
        request_id: 'probe-apply-1',
        operations: [
          { op: 'add', element: { id: 'probe-ellipse', type: 'ellipse', x: 260, y: 60, width: 90, height: 70 } },
          { op: 'update', id: 'probe-text', patch: { text: 'agent updated text', fontSize: 24 } },
          { op: 'delete', id: 'probe-arrow' },
        ],
      }))
      if (applied.revision !== 2) throw new Error(`expected revision 2, got ${applied.revision}`)
      if (applied.operations.added !== 1 || applied.operations.updated !== 1 || applied.operations.deleted !== 1) {
        throw new Error(`unexpected operation counts ${JSON.stringify(applied.operations)}`)
      }

      const duplicate = await step('duplicateRetry', () => call('excalidraw_scene_apply', {
        name: sceneName,
        expected_revision: 1,
        request_id: 'probe-apply-1',
        operations: [
          { op: 'delete', id: 'probe-box' },
        ],
      }))
      if (duplicate.duplicate !== true || duplicate.revision !== 2) {
        throw new Error('a repeated request id did not return the committed revision')
      }

      const stale = await step('staleFence', () => call('excalidraw_scene_apply', {
        name: sceneName,
        expected_revision: 1,
        request_id: 'probe-stale',
        operations: [{ op: 'update', id: 'probe-ellipse', patch: { x: 300 } }],
      }))
      if (stale.ok !== false || stale.error?.code !== 'revision_conflict' || stale.error?.details?.currentRevision !== 2) {
        throw new Error(`stale fence was not reported correctly: ${JSON.stringify(stale)}`)
      }

      const invalid = await step('invalidName', () => call('excalidraw_scene_create', { name: '../escape', elements: [] }))
      if (invalid.ok !== false || invalid.error?.code !== 'invalid_name') {
        throw new Error(`unsafe name was not rejected: ${JSON.stringify(invalid)}`)
      }

      const read2 = await step('readAfter', () => call('excalidraw_scene_read', { name: sceneName }))
      if (read2.revision !== 2) throw new Error(`expected revision 2 after apply, got ${read2.revision}`)
      const validation = await step('validate', () => call('excalidraw_scene_validate', { scene: read2.scene }))
      if (validation.valid !== true) throw new Error(`validator rejected the created scene: ${JSON.stringify(validation.diagnostics)}`)

      const list = await step('list', () => call('excalidraw_scene_list', {}))
      const row = list.scenes.find(scene => scene.name === sceneName)
      if (!row || row.revision !== 2) throw new Error('listing did not show the applied revision')

      const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '/tmp', '.dsh')
      const drawing = join(dshHome, 'excalidraw', 'drawings', `${sceneName}.excalidraw`)
      const metaPath = join(dshHome, 'excalidraw', 'drawings', '.dsh-excalidraw', `${sceneName}.meta.json`)
      const text = readFileSync(drawing, 'utf8')
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      const digest = createHash('sha256').update(text, 'utf8').digest('hex')
      await step('diskEvidence', async () => ({
        drawing,
        exists: existsSync(drawing),
        bytes: Buffer.byteLength(text, 'utf8'),
        sha256: digest,
        hashMatchesApi: digest === applied.sha256,
        metaRevision: meta.revision,
        metaUpdatedBy: meta.updatedBy,
        elementCount: JSON.parse(text).elements.length,
      }))
      if (digest !== applied.sha256) throw new Error('file hash does not match the tool result')
      if (meta.revision !== 2 || meta.updatedBy !== 'agent') throw new Error('sidecar revision or actor is wrong')

      report.ok = true
    } catch (error) {
      report.error = String(error && error.stack || error)
    } finally {
      finish()
    }
  })()
}
