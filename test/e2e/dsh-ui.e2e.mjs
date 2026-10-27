/**
 * End-to-end verification against a real, isolated DeepSeek Harness instance.
 *
 * It drives the installed plugin exactly as a person does: opens the sidebar
 * panel, creates a scene, draws with real mouse/keyboard input on the genuine
 * Excalidraw canvas, saves, reloads, and recovers from a concurrent writer. It
 * then checks the bytes on disk and the Host's revision metadata, not just the
 * UI's own claims.
 *
 * Usage:
 *   DSH_E2E_URL='http://127.0.0.1:PORT/?token=...' \
 *   DSH_E2E_HOME=/path/to/dsh-home \
 *   node test/e2e/dsh-ui.e2e.mjs
 *
 * The URL must belong to a throwaway profile (the test creates scenes and a
 * concurrent-writer conflict in the plugin's drawings directory).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const URL = process.env.DSH_E2E_URL
const HOME = process.env.DSH_E2E_HOME
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ARTIFACTS = process.env.DSH_E2E_ARTIFACTS ?? join(import.meta.dirname, 'artifacts')

if (!URL || !HOME) {
  console.error('DSH_E2E_URL and DSH_E2E_HOME are required')
  process.exit(2)
}

await fs.mkdir(ARTIFACTS, { recursive: true })
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 800))
})
page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))
const sceneName = `e2e-${Date.now().toString(36)}`
const steps = []

async function step(name, operation) {
  process.stdout.write(`- ${name} ... `)
  try {
    const value = await operation()
    steps.push({ name, ok: true })
    process.stdout.write('ok\n')
    return value
  } catch (error) {
    steps.push({ name, ok: false, error: String(error && error.message || error) })
    process.stdout.write('FAILED\n')
    throw error
  }
}

async function api(path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(`/dsh-excalidraw/api${path}`, init)
    return { status: response.status, body: await response.json() }
  }, { path, init })
}

async function dismissOnboarding() {
  for (const label of ['关闭', '继续', 'Close', 'Continue']) {
    const button = page.getByRole('button', { name: label, exact: true })
    if (await button.count()) {
      await button.first().click({ force: true }).catch(() => undefined)
      await page.waitForTimeout(600)
    }
  }
}

async function openPanel() {
  await page.getByRole('button', { name: 'Excalidraw', exact: true }).first().click()
  await page.waitForSelector('.dsh-exc-page', { timeout: 20000 })
}

async function canvasBox() {
  const box = await page.locator('.dsh-exc-canvas').boundingBox()
  assert.ok(box && box.width > 500 && box.height > 300, `canvas box is too small: ${JSON.stringify(box)}`)
  return box
}

async function selectTool(tool) {
  await page.locator(`label:has([data-testid="toolbar-${tool}"])`).click()
  await page.waitForTimeout(450)
  const active = await page.evaluate(() => window.__DSH_EXCALIDRAW_API__?.getAppState().activeTool?.type)
  assert.equal(active, tool, `toolbar did not activate ${tool}`)
}

async function drag(box, x1, y1, x2, y2) {
  await page.mouse.move(box.x + x1, box.y + y1)
  await page.waitForTimeout(80)
  await page.mouse.down()
  await page.waitForTimeout(80)
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 24 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(500)
}

async function canvasTypes() {
  return page.evaluate(() => window.__DSH_EXCALIDRAW_API__?.getSceneElements().map(element => element.type) ?? [])
}

async function waitForRevision(revision) {
  // Poll through the real API instead of the page's status label.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await api(`/scenes/${sceneName}`)
    if (result.status === 200 && result.body.revision === revision) return result.body
    await page.waitForTimeout(100)
  }
  throw new Error(`scene ${sceneName} never reached revision ${revision}`)
}

try {
  await step('boot the isolated Harness page', async () => {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(8000)
  })
  await step('dismiss onboarding overlays', dismissOnboarding)
  await step('open the Excalidraw panel from the sidebar', openPanel)
  await step('create a scene from the panel', async () => {
    await page.locator('.dsh-exc-input').fill(sceneName)
    await page.locator('.dsh-exc-new button').click()
    await page.waitForSelector('.excalidraw', { timeout: 30000 })
    await page.waitForFunction(() => window.__DSH_EXCALIDRAW_API__ !== undefined, undefined, { timeout: 20000 })
    await page.waitForTimeout(1200)
    assert.equal(await page.locator('.excalidraw canvas').count() > 0, true, 'no Excalidraw canvas element')
  })
  let box = await canvasBox()

  await step('draw a rectangle with a real pointer drag', async () => {
    await selectTool('rectangle')
    await drag(box, 340, 170, 600, 330)
    assert.deepEqual(await canvasTypes(), ['rectangle'])
  })
  await step('draw an arrow with a real pointer drag', async () => {
    await selectTool('arrow')
    await drag(box, 640, 220, 820, 300)
    await page.waitForTimeout(400)
    assert.deepEqual(await canvasTypes(), ['rectangle', 'arrow'])
  })
  await step('create text with a real click and keystrokes', async () => {
    await selectTool('text')
    await page.mouse.click(box.x + 360, box.y + 430)
    await page.waitForTimeout(500)
    await page.keyboard.type('Human edit + agent tool')
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    assert.deepEqual(await canvasTypes(), ['rectangle', 'arrow', 'text'])
  })
  await page.screenshot({ path: join(ARTIFACTS, '01-drawn.png') })

  const saved = await step('save with the keyboard shortcut and verify the file', async () => {
    await page.keyboard.press('Meta+s')
    const body = await waitForRevision(2)
    assert.equal(body.scene.elements.filter(element => !element.isDeleted).length, 3)
    assert.deepEqual(body.scene.elements.map(element => element.type).sort(), ['arrow', 'rectangle', 'text'])
    const filePath = join(HOME, 'excalidraw', 'drawings', `${sceneName}.excalidraw`)
    const text = await fs.readFile(filePath, 'utf8')
    assert.equal(createHash('sha256').update(text, 'utf8').digest('hex'), body.sha256)
    const meta = JSON.parse(await fs.readFile(join(HOME, 'excalidraw', 'drawings', '.dsh-excalidraw', `${sceneName}.meta.json`), 'utf8'))
    assert.equal(meta.revision, 2)
    assert.equal(meta.sha256, body.sha256)
    assert.equal(meta.updatedBy, 'ui')
    assert.ok(meta.recentRequests.length >= 1)
    return body
  })
  assert.equal(saved.revision, 2)

  await step('the Host records that the real editor mounted', async () => {
    const health = await api('/health')
    assert.equal(health.status, 200)
    assert.equal(health.body.editor.mounted, true)
    assert.equal(health.body.editor.sceneName, sceneName)
    assert.ok(typeof health.body.editor.elementCount === 'number')
    assert.equal(health.body.editor.error, null)
  })

  await step('reload and reopen the scene from disk', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)
    await dismissOnboarding()
    await openPanel()
    await page.locator('.dsh-exc-item', { hasText: sceneName }).click()
    await page.waitForFunction(() => window.__DSH_EXCALIDRAW_API__ !== undefined, undefined, { timeout: 20000 })
    await page.waitForTimeout(1500)
    const types = await canvasTypes()
    assert.deepEqual(types.sort(), ['arrow', 'rectangle', 'text'])
    box = await canvasBox()
    await page.screenshot({ path: join(ARTIFACTS, '02-reopened.png') })
  })

  await step('detect a concurrent writer and recover by overwriting', async () => {
    const current = await api(`/scenes/${sceneName}`)
    assert.equal(current.status, 200)
    const external = current.body.scene
    external.appState.viewBackgroundColor = '#fffbe6'
    const conflictSave = await api(`/scenes/${sceneName}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scene: external, expected_revision: current.body.revision, request_id: 'e2e-external-writer' }),
    })
    assert.equal(conflictSave.status, 200)
    assert.equal(conflictSave.body.revision, 3)

    // The canvas still believes it is at revision 2, so the next save conflicts.
    await selectTool('rectangle')
    await drag(box, 330, 520, 520, 640)
    await page.locator('.dsh-exc-head button.primary').click()
    await page.waitForSelector('.dsh-exc-banner', { timeout: 15000 })
    const banner = await page.locator('.dsh-exc-banner').innerText()
    assert.match(banner, /3/u)
    await page.screenshot({ path: join(ARTIFACTS, '03-conflict.png') })
    await page.locator('.dsh-exc-banner button.primary').click()
    const recovered = await waitForRevision(4)
    assert.equal(recovered.scene.elements.filter(element => !element.isDeleted).length, 4)
    const health = await api('/health')
    assert.equal(health.body.editor.mounted, true)
  })

  await step('reload after recovery and verify four elements survive', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)
    await dismissOnboarding()
    await openPanel()
    await page.locator('.dsh-exc-item', { hasText: sceneName }).click()
    await page.waitForFunction(() => window.__DSH_EXCALIDRAW_API__ !== undefined, undefined, { timeout: 20000 })
    await page.waitForTimeout(1200)
    const types = await canvasTypes()
    assert.deepEqual(types.sort(), ['arrow', 'rectangle', 'rectangle', 'text'])
    await page.screenshot({ path: join(ARTIFACTS, '04-final.png') })
  })

  await step('the browser console stayed free of plugin errors', async () => {
    const relevant = consoleErrors.filter(message => /excalidraw|dsh-exc/i.test(message))
    assert.deepEqual(relevant, [])
  })

  const report = {
    ok: steps.every(entry => entry.ok),
    sceneName,
    url: URL.replace(/([?&]token=)[^&]+/u, '$1<redacted>'),
    steps,
    consoleErrors,
    generatedAt: new Date().toISOString(),
  }
  await fs.writeFile(join(ARTIFACTS, 'e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nE2E OK: ${steps.length} steps, scene ${sceneName}, artifacts in ${ARTIFACTS}`)
} catch (error) {
  const report = {
    ok: false,
    sceneName,
    url: URL.replace(/([?&]token=)[^&]+/u, '$1<redacted>'),
    steps,
    consoleErrors,
    error: String(error && error.stack || error),
    generatedAt: new Date().toISOString(),
  }
  await fs.writeFile(join(ARTIFACTS, 'e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined)
  await page.screenshot({ path: join(ARTIFACTS, '99-failure.png') }).catch(() => undefined)
  console.error('\nE2E FAILED:', error)
  process.exitCode = 1
} finally {
  await browser.close()
}
