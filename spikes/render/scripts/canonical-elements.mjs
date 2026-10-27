/**
 * Canonical element-factory evidence (Lead request, within task-3).
 *
 * In the same headless Chrome page that has @excalidraw/excalidraw 0.18.1
 * loaded, call the package's exported convertToExcalidrawElements on skeleton
 * inputs and dump the full element JSON; then dump the exact serializeAsJSON
 * output for a scene with two rectangles, an arrow bound at both ends and a
 * text element.
 *
 * Artifacts:
 *   artifacts/canonical-elements.json       skeleton -> canonical elements
 *   artifacts/serialize-asjson.json         exact serializeAsJSON string
 *   artifacts/serialize-asjson.parsed.json  parsed copy for reading
 *   artifacts/conversion-notes.json         what the transform supports
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startServer } from './server.mjs'
import { launchChrome } from './browser.mjs'
import { ARTIFACTS_DIR, ensureDirs, saveJson } from './lib.mjs'

const PACKAGE = {
  name: '@excalidraw/excalidraw',
  version: '0.18.1',
  integrity: 'sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==',
  source: 'npm registry tarball (pnpm-lock.yaml resolution)',
}

/** Skeleton inputs requested by the Lead. */
const SKELETONS = [
  { type: 'rectangle', x: 0, y: 0, width: 120, height: 80 },
  { type: 'ellipse', x: 0, y: 0, width: 120, height: 80 },
  { type: 'diamond', x: 0, y: 0, width: 120, height: 80 },
  { type: 'arrow', x: 0, y: 0, width: 120, height: 60, points: [[0, 0], [120, 60]] },
  { type: 'line', x: 0, y: 0, width: 120, height: 60, points: [[0, 0], [120, 60]] },
  { type: 'text', x: 0, y: 0, width: 120, height: 25, text: 'Hello' },
  { type: 'freedraw', x: 0, y: 0, width: 120, height: 60, points: [[0, 0], [30, 20], [60, 10]], pressures: [], simulatePressure: true },
]

/** Scene used for the binding + serialization check. Binding needs two bindable shapes. */
const BINDING_SKELETONS = [
  { type: 'rectangle', id: 'rect-a', x: 80, y: 140, width: 160, height: 100, backgroundColor: '#a5d8ff', fillStyle: 'solid' },
  { type: 'rectangle', id: 'rect-b', x: 440, y: 320, width: 160, height: 100 },
  { type: 'arrow', id: 'arrow-bound', x: 240, y: 190, width: 360, height: 180, points: [[0, 0], [360, 180]], start: { id: 'rect-a' }, end: { id: 'rect-b' } },
  { type: 'text', id: 'text-hello', x: 104, y: 164, width: 120, height: 25, text: 'Hello' },
]

const SUMMARY_FIELDS = [
  'id', 'type', 'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor', 'fillStyle',
  'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'groupIds', 'frameId', 'roundness', 'seed',
  'version', 'versionNonce', 'isDeleted', 'boundElements', 'updated', 'link', 'locked', 'index',
  'points', 'lastCommittedPoint', 'startBinding', 'endBinding', 'startArrowhead', 'endArrowhead',
  'pressures', 'simulatePressure', 'text', 'fontSize', 'fontFamily', 'textAlign', 'verticalAlign',
  'containerId', 'originalText', 'lineHeight', 'autoResize',
]

const summarize = elements => elements.map((element, position) => {
  const picked = { position }
  for (const field of SUMMARY_FIELDS) {
    if (field in element) picked[field] = element[field]
  }
  return picked
})

async function main() {
  ensureDirs()
  const server = await startServer({ csp: false })
  const browser = await launchChrome()
  const results = {
    generatedAt: new Date().toISOString(),
    package: PACKAGE,
    page: { reactVersion: null, libraryVersion: null, url: null },
    transformOptions: { defaultCall: 'convertToExcalidrawElements(skeletons)', bindingCall: 'convertToExcalidrawElements(skeletons, {regenerateIds:false})' },
  }

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(server.url('/'), { waitUntil: 'load' })
    await page.waitForFunction(() => window.__EXCALIDRAW_READY__ === true, undefined, { timeout: 60000 })
    results.page = await page.evaluate(() => ({
      reactVersion: window.__EXCALIDRAW_LIB__.reactVersion,
      libraryVersion: window.__EXCALIDRAW_LIB__.version,
      url: location.href,
    }))

    // ---- 1. each requested skeleton, isolated ------------------------------
    const perSkeleton = await page.evaluate((skeletons) => {
      const convert = window.__EXCALIDRAW_LIB__.convertToExcalidrawElements
      return skeletons.map((skeleton, index) => {
        try {
          const elements = convert([skeleton])
          return { index, type: skeleton.type, ok: true, count: elements.length, elements: JSON.parse(JSON.stringify(elements)) }
        } catch (error) {
          return { index, type: skeleton.type, ok: false, error: String(error) }
        }
      })
    }, SKELETONS)
    results.perSkeleton = perSkeleton.map(entry => ({
      index: entry.index,
      type: entry.type,
      ok: entry.ok,
      ...(entry.ok ? { count: entry.count, summary: summarize(entry.elements) } : { error: entry.error }),
    }))

    // ---- 2. the full requested list in one call ---------------------------
    const combined = await page.evaluate((skeletons) => {
      const convert = window.__EXCALIDRAW_LIB__.convertToExcalidrawElements
      const generated = convert(skeletons)
      return {
        count: generated.length,
        elements: JSON.parse(JSON.stringify(generated)),
        types: generated.map(element => element.type),
      }
    }, SKELETONS)
    results.combined = { count: combined.count, types: combined.types, summary: summarize(combined.elements) }
    results.combinedElements = combined.elements

    // ---- 3. binding scene + exact serializeAsJSON -------------------------
    const binding = await page.evaluate((skeletons) => {
      const lib = window.__EXCALIDRAW_LIB__
      const api = window.__EXCALIDRAW_API__
      const generated = lib.convertToExcalidrawElements(skeletons, { regenerateIds: false })
      const elements = JSON.parse(JSON.stringify(generated))
      const appState = api.getAppState()
      const files = api.getFiles()
      const serialized = lib.serializeAsJSON(generated, appState, files, 'local')
      // Round-trip the exact serialized document through restore() and show it.
      const restored = lib.restore(JSON.parse(serialized), null, null)
      api.updateScene({ elements: restored.elements, captureUpdate: 'IMMEDIATELY' })
      const rendered = api.getSceneElements().map(element => ({ id: element.id, type: element.type, startBinding: element.startBinding, endBinding: element.endBinding, points: element.points }))
      return { elements, serialized, restored: rendered }
    }, BINDING_SKELETONS)

    const parsed = JSON.parse(binding.serialized)
    results.binding = {
      inputSkeletons: BINDING_SKELETONS,
      count: binding.elements.length,
      types: binding.elements.map(element => element.type),
      elements: binding.elements,
      summary: summarize(binding.elements),
      restoredScene: binding.restored,
      serialized: {
        bytes: Buffer.byteLength(binding.serialized),
        parsedTopLevelKeys: Object.keys(parsed),
        appStateKeys: Object.keys(parsed.appState ?? {}),
        elementCount: Array.isArray(parsed.elements) ? parsed.elements.length : null,
        filesKeys: parsed.files && typeof parsed.files === 'object' ? Object.keys(parsed.files).length : parsed.files,
        arrowBindings: binding.elements
          .filter(element => element.type === 'arrow')
          .map(element => ({
            id: element.id,
            startBinding: element.startBinding,
            endBinding: element.endBinding,
            points: element.points,
          })),
        rectangleBoundElements: binding.elements
          .filter(element => element.type === 'rectangle')
          .map(element => ({ id: element.id, boundElements: element.boundElements })),
      },
    }

    // ---- 4. observations ---------------------------------------------------
    const arrow = binding.elements.find(element => element.type === 'arrow')
    const rects = binding.elements.filter(element => element.type === 'rectangle')
    results.notes = {
      bindingSupportedByTransform: Boolean(arrow?.startBinding?.elementId && arrow?.endBinding?.elementId),
      bindingRequiresElementIds: true,
      bindingRequiresRegenerateIdsFalse: true,
      arrowStartBinding: arrow?.startBinding ?? null,
      arrowEndBinding: arrow?.endBinding ?? null,
      rectanglesBoundElements: rects.map(rect => ({ id: rect.id, boundElements: rect.boundElements })),
      skeletonIdsPreservedWhenRegenerateIdsFalse: BINDING_SKELETONS.map(skeleton => skeleton.id).filter(Boolean)
        .every(id => binding.elements.some(element => element.id === id)),
      textWidthFromSkeletonIsRecomputed: (() => {
        const textElement = combined.elements.find(element => element.type === 'text')
        return textElement ? { requested: 120, actual: Math.round(textElement.width), actualHeight: Math.round(textElement.height) } : null
      })(),
      freedrawResult: (() => {
        const freedraw = combined.elements.find(element => element.type === 'freedraw')
        return freedraw ? { points: freedraw.points, pressures: freedraw.pressures, simulatePressure: freedraw.simulatePressure } : null
      })(),
      serializeAsJSONSignature: 'serializeAsJSON(elements, appState, files, "local")',
      appStateSource: 'live appState from the mounted Excalidraw component',
    }

    await page.waitForTimeout(500)
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'screenshots/12-binding-scene.png') })
    saveJson(join(ARTIFACTS_DIR, 'canonical-elements.json'), results)
    await writeFile(join(ARTIFACTS_DIR, 'serialize-asjson.json'), binding.serialized)
    saveJson(join(ARTIFACTS_DIR, 'serialize-asjson.parsed.json'), parsed)
    saveJson(join(ARTIFACTS_DIR, 'conversion-notes.json'), {
      package: PACKAGE,
      page: results.page,
      transformOptions: results.transformOptions,
      notes: results.notes,
      bindingSummary: results.binding.summary,
      perSkeleton: results.perSkeleton,
    })

    console.log('canonical-elements.json:', results.combined.count, 'elements:', results.combined.types.join(','))
    console.log('binding supported:', results.notes.bindingSupportedByTransform)
    console.log('arrow bindings:', JSON.stringify(results.binding.serialized.arrowBindings))
    console.log('serializeAsJSON bytes:', results.binding.serialized.bytes)
    console.log('notes:', JSON.stringify(results.notes.textWidthFromSkeletonIsRecomputed), JSON.stringify(results.notes.freedrawResult))
    const failedSkeletons = results.perSkeleton.filter(entry => !entry.ok)
    if (failedSkeletons.length > 0) console.log('skeleton failures:', failedSkeletons)
    await context.close()
  } finally {
    await browser.close()
    await server.close()
  }
}

await main()
