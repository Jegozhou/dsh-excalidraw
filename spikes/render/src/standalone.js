/**
 * Standalone spike page: real @excalidraw/excalidraw 0.18.1 mounted with React 19.
 * No CDN at runtime: Excalidraw CSS is injected as a <style> tag with font URLs
 * rewritten to the local /assets/fonts/ route, and EXCALIDRAW_ASSET_PATH points
 * at the same local route.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Excalidraw,
  convertToExcalidrawElements,
  serializeAsJSON,
  exportToSvg,
  exportToBlob,
  exportToCanvas,
  restore,
} from '@excalidraw/excalidraw'
import excalidrawCss from '@excalidraw/excalidraw/index.css'

const ASSET_BASE = new URL('assets/', document.baseURI).href
window.EXCALIDRAW_ASSET_PATH = ASSET_BASE

const STYLE_ID = 'excalidraw-standalone-css'

function excalidrawStyles() {
  // Excalidraw's shipped stylesheet carries url("./fonts/Assistant/...") rules;
  // an injected <style> resolves relative URLs against the document, not the
  // package directory, so rewrite them to the served asset base.
  return excalidrawCss.replaceAll('url("./fonts/', `url("${ASSET_BASE}fonts/`)
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = excalidrawStyles()
  document.head.appendChild(style)
}

injectStyles()

// Expose the package surface for Playwright-driven evidence scripts.
window.__EXCALIDRAW_LIB__ = {
  package: '@excalidraw/excalidraw',
  version: '0.18.1',
  reactVersion: React.version,
  convertToExcalidrawElements,
  serializeAsJSON,
  exportToSvg,
  exportToBlob,
  exportToCanvas,
  restore,
}

function App() {
  const onApi = React.useCallback((api) => {
    if (!api) return
    window.__EXCALIDRAW_API__ = api
    window.__EXCALIDRAW_READY__ = true
  }, [])
  return React.createElement(Excalidraw, {
    excalidrawAPI: onApi,
    initialData: { appState: { viewBackgroundColor: '#ffffff', showWelcomeScreen: false } },
    UIOptions: {
      canvasActions: {
        export: false,
        loadScene: false,
        saveToActiveFile: false,
        saveAsImage: false,
        toggleTheme: false,
      },
    },
  })
}

const params = new URLSearchParams(location.search)
const root = document.getElementById('root')
if (params.get('slot') === '1') {
  root.classList.add('slot')
}
createRoot(root).render(React.createElement(App))
