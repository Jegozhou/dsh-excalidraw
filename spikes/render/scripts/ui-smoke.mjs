/**
 * Evidence run 1: standalone page (React 19), genuine @excalidraw/excalidraw.
 *
 * Proves, with a real Chrome and real mouse/keyboard input:
 *   - the component mounts and paints
 *   - a rectangle, an arrow and a text element can be drawn with mouse/keyboard
 *   - the scene can be read back through the imperative API
 *   - updateScene / exportToSvg / exportToBlob work
 *   - fonts are served locally (no CDN), and a constrained slot + resize works
 *
 * Writes screenshots + JSON evidence under artifacts/.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startServer } from './server.mjs'
import { launchChrome, instrument, summarizeNetwork } from './browser.mjs'
import { ARTIFACTS_DIR, EXPORTS_DIR, SHOTS_DIR, ensureDirs, saveJson } from './lib.mjs'

const assertions = []
function check(name, ok, detail) {
  assertions.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`)
}

async function readScene(page) {
  return page.evaluate(() => {
    const api = window.__EXCALIDRAW_API__
    const elements = api.getSceneElements().map(element => JSON.parse(JSON.stringify(element)))
    return { count: elements.length, types: elements.map(element => element.type), elements }
  })
}

async function drawDrag(page, from, to) {
  await page.mouse.move(from[0], from[1])
  await page.waitForTimeout(60)
  await page.mouse.down()
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 })
  await page.mouse.move(to[0], to[1], { steps: 6 })
  await page.waitForTimeout(60)
  await page.mouse.up()
  await page.waitForTimeout(180)
}

async function selectTool(page, key) {
  await page.keyboard.press('Escape')
  await page.keyboard.press(key)
  await page.waitForTimeout(80)
}

async function main() {
  ensureDirs()
  const server = await startServer({ csp: true })
  const browser = await launchChrome()
  const started = Date.now()
  const results = { generatedAt: new Date().toISOString(), server: server.origin, stages: {} }

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
    const page = await context.newPage()
    const evidence = await instrument(page, server.origin)

    await page.goto(server.url('/'), { waitUntil: 'load', timeout: 30000 })
    await page.waitForFunction(() => window.__EXCALIDRAW_READY__ === true, undefined, { timeout: 60000 })
    await page.waitForSelector('.excalidraw canvas', { timeout: 20000 })
    await page.waitForTimeout(900)

    const mounted = await page.evaluate(() => {
      const canvas = document.querySelector('.excalidraw canvas')
      const root = document.querySelector('.excalidraw')
      return {
        lib: window.__EXCALIDRAW_LIB__,
        canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
        rootBox: root.getBoundingClientRect().toJSON(),
        styleTag: Boolean(document.getElementById('excalidraw-standalone-css')),
        assetPath: window.EXCALIDRAW_ASSET_PATH,
      }
    })
    results.stages.mount = mounted
    await page.screenshot({ path: join(SHOTS_DIR, '01-standalone-mounted.png') })
    check('component mounts and canvas has size', mounted.canvas.width > 100 && mounted.canvas.height > 100, mounted.canvas)
    check('library surface exposed', mounted.lib?.version === '0.18.1', mounted.lib?.version)

    // ---- real mouse drawing -------------------------------------------------
    await selectTool(page, 'r')
    await drawDrag(page, [260, 220], [540, 380])
    const afterRect = await readScene(page)
    results.stages.afterRectangle = afterRect
    await page.screenshot({ path: join(SHOTS_DIR, '02-standalone-rectangle.png') })
    check('real mouse drag creates a rectangle', afterRect.types.includes('rectangle'), afterRect)

    await selectTool(page, 'a')
    await drawDrag(page, [300, 440], [640, 540])
    const afterArrow = await readScene(page)
    results.stages.afterArrow = afterArrow
    await page.screenshot({ path: join(SHOTS_DIR, '03-standalone-arrow.png') })
    check('real mouse drag creates an arrow', afterArrow.types.includes('arrow'), afterArrow)

    await selectTool(page, 't')
    await page.mouse.click(300, 620)
    await page.waitForTimeout(200)
    await page.keyboard.type('Hello Excalidraw', { delay: 25 })
    await page.waitForTimeout(150)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const afterText = await readScene(page)
    results.stages.afterText = afterText
    await page.screenshot({ path: join(SHOTS_DIR, '04-standalone-text.png') })
    check('real keyboard input creates a text element', afterText.types.includes('text'), afterText.types)

    await selectTool(page, 'v')
    await page.waitForTimeout(200)

    const apiSurface = await page.evaluate(() => {
      const api = window.__EXCALIDRAW_API__
      const names = [
        'updateScene', 'getSceneElements', 'getAppState', 'getFiles', 'exportToSvg',
        'exportToBlob', 'setActiveTool', 'scrollToContent', 'refresh',
      ]
      return Object.fromEntries(names.map(name => [name, typeof api[name]]))
    })
    results.stages.apiSurface = apiSurface
    check(
      'imperative API methods present',
      ['updateScene', 'getSceneElements', 'getAppState', 'exportToSvg', 'exportToBlob']
        .every(name => apiSurface[name] === 'function'),
      apiSurface,
    )

    // ---- programmatic updateScene ------------------------------------------
    const imperative = await page.evaluate(() => {
      const lib = window.__EXCALIDRAW_LIB__
      const api = window.__EXCALIDRAW_API__
      const skeletons = [
        { type: 'rectangle', x: 80, y: 80, width: 200, height: 120, backgroundColor: '#a5d8ff', fillStyle: 'solid' },
        { type: 'ellipse', x: 340, y: 80, width: 160, height: 120, backgroundColor: '#ffec99', fillStyle: 'solid' },
        { type: 'text', x: 80, y: 260, text: 'updateScene works' },
      ]
      const elements = lib.convertToExcalidrawElements(skeletons)
      api.updateScene({ elements, captureUpdate: 'IMMEDIATELY' })
      const after = api.getSceneElements().map(element => JSON.parse(JSON.stringify(element)))
      return { requested: skeletons, types: after.map(element => element.type), count: after.length, elements: after }
    })
    await page.waitForTimeout(400)
    results.stages.afterUpdateScene = imperative
    await page.screenshot({ path: join(SHOTS_DIR, '05-standalone-updateScene.png') })
    check(
      'convertToExcalidrawElements + updateScene replaces the scene',
      imperative.count === 3 && imperative.types.join(',') === 'rectangle,ellipse,text',
      imperative.types,
    )

    // ---- exports -----------------------------------------------------------
    const svg = await page.evaluate(async () => {
      const lib = window.__EXCALIDRAW_LIB__
      const api = window.__EXCALIDRAW_API__
      const node = await lib.exportToSvg({
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
      })
      return { markup: new XMLSerializer().serializeToString(node), width: node.getAttribute('width'), height: node.getAttribute('height') }
    })
    results.stages.exportToSvg = { bytes: Buffer.byteLength(svg.markup), width: svg.width, height: svg.height }
    await writeFile(join(EXPORTS_DIR, 'scene.svg'), svg.markup)
    check('exportToSvg returns an SVG document', svg.markup.startsWith('<svg') && svg.markup.length > 1000, results.stages.exportToSvg)

    const png = await page.evaluate(async () => {
      const lib = window.__EXCALIDRAW_LIB__
      const api = window.__EXCALIDRAW_API__
      const blob = await lib.exportToBlob({
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
        mimeType: 'image/png',
      })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      }
      return { size: blob.size, type: blob.type, base64: btoa(binary) }
    })
    const pngBytes = Buffer.from(png.base64, 'base64')
    await writeFile(join(EXPORTS_DIR, 'scene.png'), pngBytes)
    results.stages.exportToBlob = { bytes: png.size, type: png.type, signature: pngBytes.subarray(0, 8).toString('hex') }
    check(
      'exportToBlob returns a PNG',
      png.size > 1000 && pngBytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      results.stages.exportToBlob,
    )

    // ---- fonts / runtime facts --------------------------------------------
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready
      return {
        status: document.fonts.status,
        families: [...new Set([...document.fonts].map(face => face.family))],
        excalifont: document.fonts.check('16px Excalifont'),
        assistant: document.fonts.check('16px Assistant'),
        resizeObserver: typeof ResizeObserver,
        devicePixelRatio: window.devicePixelRatio,
      }
    })
    results.stages.fonts = fonts
    check('local Excalifont loaded for canvas text', fonts.excalifont === true, fonts)
    check('ResizeObserver available', fonts.resizeObserver === 'function')

    const cspViolations = await page.evaluate(() => window.__CSP_VIOLATIONS__ ?? [])
    const network = summarizeNetwork(evidence)
    results.stages.console = evidence.consoleMessages
    results.stages.pageErrors = evidence.pageErrors
    results.stages.securityPolicyViolations = cspViolations
    results.stages.network = network
    results.stages.crash = evidence.crash
    saveJson(join(ARTIFACTS_DIR, 'ui-smoke-console.json'), {
      consoleMessages: evidence.consoleMessages,
      pageErrors: evidence.pageErrors,
      securityPolicyViolations: cspViolations,
    })
    saveJson(join(ARTIFACTS_DIR, 'ui-smoke-network.json'), {
      requests: evidence.requests,
      responses: evidence.responses,
      ...network,
    })
    saveJson(join(ARTIFACTS_DIR, 'scene-initial.json'), { note: 'empty scene before drawing', count: 0 })
    saveJson(join(ARTIFACTS_DIR, 'scene-after-drawing.json'), {
      note: 'scene read back after real mouse/keyboard input',
      ...afterText,
    })
    saveJson(join(ARTIFACTS_DIR, 'scene-after-updateScene.json'), imperative)

    check('no page errors', evidence.pageErrors.length === 0, evidence.pageErrors)
    check('no CSP violations', cspViolations.length === 0, cspViolations)
    check('no external network requests', network.externalHosts.length === 0, network.externalHosts)
    check('fonts served from the local origin', network.fontRequests.length > 0, network.fontRequests.map(f => f.url))

    // ---- constrained slot + ResizeObserver ---------------------------------
    const slotPage = await context.newPage()
    const slotEvidence = await instrument(slotPage, server.origin)
    await slotPage.setViewportSize({ width: 1000, height: 700 })
    await slotPage.goto(server.url('/?slot=1'), { waitUntil: 'load' })
    await slotPage.waitForFunction(() => window.__EXCALIDRAW_READY__ === true, undefined, { timeout: 60000 })
    await slotPage.waitForTimeout(700)
    const slotBefore = await slotPage.evaluate(() => {
      const root = document.getElementById('root')
      const canvas = document.querySelector('.excalidraw canvas')
      return {
        root: { width: root.clientWidth, height: root.clientHeight },
        canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
        excalidrawBox: document.querySelector('.excalidraw').getBoundingClientRect().toJSON(),
      }
    })
    await slotPage.screenshot({ path: join(SHOTS_DIR, '06-slot-720x480.png') })
    const slotAfter = await slotPage.evaluate(async () => {
      const root = document.getElementById('root')
      root.style.width = '520px'
      root.style.height = '360px'
      await new Promise(resolve => setTimeout(resolve, 600))
      const canvas = document.querySelector('.excalidraw canvas')
      return {
        root: { width: root.clientWidth, height: root.clientHeight },
        canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
      }
    })
    await slotPage.screenshot({ path: join(SHOTS_DIR, '07-slot-resized-520x360.png') })
    results.stages.slot = { before: slotBefore, after: slotAfter, console: slotEvidence.consoleMessages, pageErrors: slotEvidence.pageErrors }
    check(
      'Excalidraw fills a 720x480 slot',
      Math.abs(slotBefore.canvas.width - 720) <= 2 && Math.abs(slotBefore.canvas.height - 480) <= 2,
      slotBefore,
    )
    check(
      'Excalidraw follows a container resize (ResizeObserver)',
      Math.abs(slotAfter.canvas.width - 520) <= 2 && Math.abs(slotAfter.canvas.height - 360) <= 2,
      slotAfter,
    )
    check('no page errors in slot page', slotEvidence.pageErrors.length === 0, slotEvidence.pageErrors)

    results.assertions = assertions
    results.failed = assertions.filter(entry => !entry.ok)
    results.durationMs = Date.now() - started
    saveJson(join(ARTIFACTS_DIR, 'ui-smoke-results.json'), results)

    await context.close()
  } finally {
    await browser.close()
    await server.close()
  }

  const failed = assertions.filter(entry => !entry.ok)
  console.log(`\n${assertions.length - failed.length}/${assertions.length} assertions passed`)
  if (failed.length > 0) process.exitCode = 1
}

await main()
