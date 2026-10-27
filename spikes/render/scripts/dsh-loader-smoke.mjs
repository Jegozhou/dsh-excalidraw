/**
 * Evidence run 2: the DSH client-plugin contract.
 *
 * Loads public/build/dsh-client.js exactly the way the DSH HTML facade does
 * (classic script -> window.__ModuleLoader__.load({id, factory})) against a
 * module table that supplies React 18.3.1 (the version the live DSH shell
 * seeds) and a minimal slots renderer.
 *
 * Three passes:
 *   /dsh       faithful to the live shell (no CSP anywhere on the DSH app page):
 *              zero external requests, fonts from the local package route.
 *   /dsh-csp   same bundle under a strict CSP (font-src 'self'): proves the
 *              hardcoded esm.sh fallback in Excalidraw 0.18.1 never leaks;
 *              the browser reports blocked fallback attempts but local fonts
 *              still load and render.
 *   /dsh-lean  lazy-chunk variant whose Excalidraw locale/worker chunks load
 *              from the /lazy/ host route.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startServer } from './server.mjs'
import { launchChrome, instrument, summarizeNetwork } from './browser.mjs'
import { ARTIFACTS_DIR, SHOTS_DIR, ensureDirs, saveJson } from './lib.mjs'

const assertions = []
function check(name, ok, detail) {
  assertions.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 320)}`}`)
}

async function readScene(page) {
  return page.evaluate(() => {
    const api = window.__EXCALIDRAW_API__
    const elements = api.getSceneElements().map(element => JSON.parse(JSON.stringify(element)))
    return { count: elements.length, types: elements.map(element => element.type) }
  })
}

async function mountHarness(page, path) {
  await page.goto(path, { waitUntil: 'load', timeout: 30000 })
  await page.waitForFunction(() => window.__DSH_SPIKE__ !== undefined, undefined, { timeout: 60000 })
  await page.waitForFunction(() => window.__EXCALIDRAW_READY__ === true, undefined, { timeout: 60000 })
  await page.waitForSelector('.excalidraw canvas', { timeout: 20000 })
  await page.waitForTimeout(700)
  // focus the document before keyboard shortcuts (headless Chrome behavior)
  await page.mouse.click(1120, 200)
  await page.waitForTimeout(250)
}

async function drawRect(page) {
  await page.keyboard.press('r')
  await page.waitForTimeout(150)
  await page.mouse.move(320, 240)
  await page.mouse.down()
  await page.mouse.move(560, 400, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

async function drawText(page, text) {
  await page.keyboard.press('t')
  await page.waitForTimeout(150)
  await page.mouse.click(340, 560)
  await page.waitForTimeout(200)
  await page.keyboard.type(text, { delay: 20 })
  await page.waitForTimeout(120)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}

function harnessSnapshot(page) {
  return page.evaluate(() => {
    const spike = window.__DSH_SPIKE__
    const style = document.querySelector('style[data-plugin="@local/dsh-excalidraw"]')
    return {
      ...spike,
      moduleTableReactVersion: window.__MODULE_TABLE_REACT_VERSION__,
      surfaceReactVersion: document.querySelector('.dsh-excalidraw-surface')?.getAttribute('data-react-version') ?? null,
      styleTag: style === null ? null : {
        dataPlugin: style.getAttribute('data-plugin'),
        dataPluginCss: style.getAttribute('data-plugin-css'),
        rules: style.sheet ? style.sheet.cssRules.length : -1,
        bytes: style.textContent.length,
        fontUrls: (style.textContent.match(/url\("https?:\/\/[^"]+fonts\/[^"]+"/g) ?? []).slice(0, 2),
      },
      canvas: (() => {
        const canvas = document.querySelector('.excalidraw canvas')
        return { width: canvas.clientWidth, height: canvas.clientHeight }
      })(),
      assetPath: window.EXCALIDRAW_ASSET_PATH,
      loaderMode: window.__ModuleLoader__.mode,
      registrationCount: window.__HARNESS__.registrations.size,
      fonts: {
        excalifont: document.fonts.check('16px Excalifont'),
        assistant: document.fonts.check('16px Assistant'),
        status: document.fonts.status,
      },
    }
  })
}

async function main() {
  ensureDirs()
  const bundleSource = await readFile(join(process.cwd(), 'dsh-bundle/client.js'), 'utf8')
  const leanSource = await readFile(join(process.cwd(), 'public/build/dsh-client-lean.js'), 'utf8')
  const server = await startServer({ csp: true })
  const browser = await launchChrome()
  const results = { generatedAt: new Date().toISOString(), server: server.origin }
  const started = Date.now()

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })

    // ---- pass 1: faithful DSH page (no CSP) --------------------------------
    const page = await context.newPage()
    const evidence = await instrument(page, server.origin)
    await mountHarness(page, server.url('/dsh'))
    const harnessState = await harnessSnapshot(page)
    await drawRect(page)
    await drawText(page, 'Excalifont text')
    const drawn = await readScene(page)
    const fontsAfterText = await page.evaluate(async () => {
      await document.fonts.ready
      return {
        excalifont: document.fonts.check('16px Excalifont'),
        families: [...new Set([...document.fonts].filter(face => face.status === 'loaded').map(face => face.family))],
      }
    })
    const localFontLog = server.log.filter(entry => entry.path.includes('/fonts/'))
    const network = summarizeNetwork(evidence)
    const cspViolations = await page.evaluate(() => window.__CSP_VIOLATIONS__ ?? [])
    await page.screenshot({ path: join(SHOTS_DIR, '08-dsh-loader-mounted.png') })
    results.primary = {
      ...harnessState,
      drawnScene: drawn,
      fontsAfterText,
      localFontLog: localFontLog.map(entry => entry.path.replace('/plugins/@local/dsh-excalidraw/assets/', '')),
      console: evidence.consoleMessages,
      pageErrors: evidence.pageErrors,
      network,
      cspViolations,
    }
    saveJson(join(ARTIFACTS_DIR, 'dsh-loader-console.json'), {
      consoleMessages: evidence.consoleMessages,
      pageErrors: evidence.pageErrors,
      cspViolations,
    })
    saveJson(join(ARTIFACTS_DIR, 'dsh-loader-network.json'), {
      requests: evidence.requests,
      responses: evidence.responses,
      ...network,
    })

    // ---- bundle-level static facts -----------------------------------------
    const staticFacts = {
      wrapperId: '@local/dsh-excalidraw',
      bundleBytes: Buffer.byteLength(bundleSource),
      leanBytes: Buffer.byteLength(leanSource),
      hasModuleLoaderLoad: /window\.__ModuleLoader__\.load\(\{/.test(bundleSource),
      hasTopLevelImport: /^\s*import\s/mu.test(bundleSource),
      hasTopLevelExport: /^\s*export\s/mu.test(bundleSource),
      embedsReact: /react\.production\.min|react\.development\.js|__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/u.test(bundleSource),
      requiresReact: bundleSource.includes('require("react")'),
      requiresReactDom: bundleSource.includes('require("react-dom")'),
      requiresJsxRuntime: bundleSource.includes('require("react/jsx-runtime")'),
      hardcodesCdnFallback: bundleSource.includes('https://esm.sh/'),
      leanRequiresReact: leanSource.includes('require("react")'),
      leanLazyImports: (leanSource.match(/import\("\/lazy\//g) ?? []).length,
    }

    // ---- pass 2: strict-CSP stress -----------------------------------------
    const cspPage = await context.newPage()
    const cspEvidence = await instrument(cspPage, server.origin)
    await mountHarness(cspPage, server.url('/dsh-csp'))
    const cspState = await harnessSnapshot(cspPage)
    await drawText(cspPage, 'CSP text')
    const cspFonts = await cspPage.evaluate(async () => {
      await document.fonts.ready
      return { excalifont: document.fonts.check('16px Excalifont'), families: [...new Set([...document.fonts].filter(face => face.status === 'loaded').map(face => face.family))] }
    })
    const cspViolationsLive = await cspPage.evaluate(() => window.__CSP_VIOLATIONS__ ?? [])
    const cspNetwork = summarizeNetwork(cspEvidence)
    const externalResponses = cspEvidence.responses.filter(response => !response.url.startsWith(server.origin))
    await cspPage.screenshot({ path: join(SHOTS_DIR, '11-dsh-strict-csp.png') })
    results.strictCsp = {
      ...cspState,
      fontsAfterText: cspFonts,
      console: cspEvidence.consoleMessages.slice(0, 30),
      consoleErrorCount: cspEvidence.consoleMessages.filter(message => message.type === 'error').length,
      pageErrors: cspEvidence.pageErrors,
      cspViolationCount: cspViolationsLive.length,
      blockedFallbackUrls: [...new Set(cspViolationsLive.map(violation => violation.blockedURI))].slice(0, 5),
      externalResponses,
      localFontLog: server.log.filter(entry => entry.path.includes('/fonts/')).length,
    }
    saveJson(join(ARTIFACTS_DIR, 'dsh-strict-csp.json'), results.strictCsp)

    // ---- pass 3: lean bundle, lazy chunks from /lazy/ ----------------------
    const leanPage = await context.newPage()
    const leanEvidence = await instrument(leanPage, server.origin)
    await mountHarness(leanPage, server.url('/dsh-lean'))
    const leanState = await leanPage.evaluate(() => ({
      bundleId: window.__DSH_SPIKE__.bundleId,
      exports: window.__DSH_SPIKE__.pluginExports,
      requiredSpecifiers: window.__DSH_SPIKE__.requiredSpecifiers,
      reactVersion: document.querySelector('.dsh-excalidraw-surface')?.getAttribute('data-react-version') ?? null,
      canvas: (() => {
        const canvas = document.querySelector('.excalidraw canvas')
        return { width: canvas.clientWidth, height: canvas.clientHeight }
      })(),
    }))
    await drawRect(leanPage)
    const leanDrawn = await readScene(leanPage)
    const leanCsp = await leanPage.evaluate(() => window.__CSP_VIOLATIONS__ ?? [])
    const leanNetwork = summarizeNetwork(leanEvidence)
    results.lean = {
      ...leanState,
      drawnScene: leanDrawn,
      console: leanEvidence.consoleMessages,
      pageErrors: leanEvidence.pageErrors,
      cspViolations: leanCsp,
      network: leanNetwork,
      responses: leanEvidence.responses,
    }
    await leanPage.screenshot({ path: join(SHOTS_DIR, '10-dsh-lean-mounted.png') })
    saveJson(join(ARTIFACTS_DIR, 'dsh-lean-console.json'), {
      consoleMessages: leanEvidence.consoleMessages,
      pageErrors: leanEvidence.pageErrors,
      cspViolations: leanCsp,
    })
    saveJson(join(ARTIFACTS_DIR, 'dsh-lean-network.json'), {
      requests: leanEvidence.requests,
      responses: leanEvidence.responses,
      ...leanNetwork,
    })

    results.staticFacts = staticFacts

    // ---- assertions --------------------------------------------------------
    check('bundle registers through window.__ModuleLoader__.load', staticFacts.hasModuleLoaderLoad)
    check('bundle is a classic script (no top-level import/export)', !staticFacts.hasTopLevelImport && !staticFacts.hasTopLevelExport)
    check('bundle does not embed React', !staticFacts.embedsReact, { requiresReact: staticFacts.requiresReact })
    check('bundle resolves react/react-dom/react-jsx-runtime through require',
      staticFacts.requiresReact && staticFacts.requiresReactDom && staticFacts.requiresJsxRuntime)
    check('factory require uses only module-table words',
      harnessState.requiredSpecifiers.every(specifier => ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'].includes(specifier)),
      [...new Set(harnessState.requiredSpecifiers)])
    check('React supplied by the page is 18.3.1', harnessState.moduleTableReactVersion === '18.3.1', harnessState.moduleTableReactVersion)
    check('mounted component sees the page React version', harnessState.surfaceReactVersion === '18.3.1', harnessState.surfaceReactVersion)
    check('plugin module exposes inject/apply', Array.isArray(harnessState.pluginExports) && harnessState.pluginExports.includes('apply') && harnessState.pluginExports.includes('inject'))
    check('slots registration reached the slot renderer', harnessState.registeredSlots.some(entry => entry.definition?.id === 'excalidraw-canvas'), harnessState.registeredSlots)
    check('CSS injected as a tagged <style> and parsed', harnessState.styleTag !== null && harnessState.styleTag.rules > 100, harnessState.styleTag && { rules: harnessState.styleTag.rules, bytes: harnessState.styleTag.bytes })
    check('font URLs in injected CSS are local absolute URLs', (harnessState.styleTag?.fontUrls ?? []).every(url => url.includes('/plugins/@local/dsh-excalidraw/assets/')), harnessState.styleTag?.fontUrls)
    check('EXCALIDRAW_ASSET_PATH points at the package asset route', String(harnessState.assetPath).includes('/plugins/@local/dsh-excalidraw/assets/'), harnessState.assetPath)
    check('canvas mounted in the DSH harness', harnessState.canvas.width > 100 && harnessState.canvas.height > 100, harnessState.canvas)
    check('real drawing works through the DSH loader bundle', drawn.types.includes('rectangle') && drawn.types.includes('text'), drawn)
    check('Excalifont loaded for canvas text from the local route', fontsAfterText.excalifont === true, fontsAfterText)
    check('local font files requested from the package route', localFontLog.some(entry => entry.path.includes('Excalifont')) && localFontLog.some(entry => entry.path.includes('Assistant')), localFontLog.map(entry => entry.path.replace('/plugins/@local/dsh-excalidraw/assets/', '')).slice(0, 12))
    check('no page errors in the DSH harness', evidence.pageErrors.length === 0, evidence.pageErrors)
    check('faithful DSH page (no CSP): zero external requests', network.externalHosts.length === 0, network.externalHosts)
    check('faithful DSH page (no CSP): zero CSP violations', cspViolations.length === 0, cspViolations)

    check('strict CSP: component still mounts and text still renders', cspState.canvas.width > 100 && cspFonts.excalifont === true, { canvas: cspState.canvas, fonts: cspFonts })
    check('strict CSP: external esm.sh fallback never completes (no external responses)', externalResponses.length === 0, externalResponses.slice(0, 3))
    check('strict CSP: blocked fallback attempts are visible in the evidence', cspViolationsLive.length > 0, { count: cspViolationsLive.length, sample: cspViolationsLive[0] })
    check('strict CSP: no page errors', cspEvidence.pageErrors.length === 0, cspEvidence.pageErrors)

    const lazyLocale = leadLocales(leanEvidence.responses)
    check('lean bundle is also a classic-script loader bundle and external-React', standardLeanFacts(staticFacts))
    check('lean bundle loads its default locale chunk from /lazy/', lazyLocale.length > 0 && lazyLocale.every(response => response.status === 200), lazyLocale)
    check('lean bundle mounts, draws and resolves React from the table', leanDrawn.types.includes('rectangle') && leanState.reactVersion === '18.3.1', { leanState, leanDrawn })
    check('lean bundle has no page errors / CSP violations', leanEvidence.pageErrors.length === 0 && leanCsp.length === 0, { pageErrors: leanEvidence.pageErrors, cspViolations: leanCsp })
    check('lean bundle has no external requests', leanNetwork.externalHosts.length === 0, leanNetwork.externalHosts)

    results.assertions = assertions
    results.failed = assertions.filter(entry => !entry.ok)
    results.durationMs = Date.now() - started
    saveJson(join(ARTIFACTS_DIR, 'dsh-loader-results.json'), results)
    await context.close()
  } finally {
    await browser.close()
    await server.close()
  }

  const failed = assertions.filter(entry => !entry.ok)
  console.log(`\n${assertions.length - failed.length}/${assertions.length} assertions passed`)
  if (failed.length > 0) process.exitCode = 1
}

function leadLocales(responses) {
  return responses.filter(response => /\/lazy\/locales\/en-[A-Z0-9]+\.js/u.test(response.url))
}

function standardLeanFacts(staticFacts) {
  return staticFacts.leanRequiresReact && staticFacts.leanLazyImports > 0
}

await main()
