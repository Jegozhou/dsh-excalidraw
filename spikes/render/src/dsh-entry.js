/**
 * DSH client-plugin entry for the render spike.
 *
 * The DSH client loader materializes this module from
 *   window.__ModuleLoader__.load({ id, factory(require) { ... return module } })
 * with `require('react')` resolved from the page module table, so React is
 * EXTERNAL here: the bundle must never embed its own React.
 *
 * CSS: the stylesheet is injected during factory execution as a tagged
 * <style data-plugin data-plugin-css> element (the same convention the DSH
 * tsdown client preset uses), with font URLs rewritten to the package asset
 * route so no CDN is contacted.
 */
import * as React from 'react'
import {
  Excalidraw,
  convertToExcalidrawElements,
  serializeAsJSON,
  exportToSvg,
  exportToBlob,
} from '@excalidraw/excalidraw'
import excalidrawCss from '@excalidraw/excalidraw/index.css'

export const PLUGIN_ID = '@local/dsh-excalidraw'
const PACKAGE_ASSET_BASE = 'plugins/@local/dsh-excalidraw/assets/'
const STYLE_TAG_ID = `${PLUGIN_ID}/excalidraw.css`

/** Absolute URL of the package asset directory (document-relative reference). */
export function assetBase() {
  return new URL(PACKAGE_ASSET_BASE, document.baseURI).href
}

export function excalidrawStylesheet() {
  return excalidrawCss.replaceAll('url("./fonts/', `url("${assetBase()}fonts/`)
}

export function injectStyles() {
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return null
  const style = document.createElement('style')
  style.dataset.plugin = PLUGIN_ID
  style.dataset.pluginCss = STYLE_TAG_ID
  style.textContent = excalidrawStylesheet()
  document.head.appendChild(style)
  return style
}

// Fonts (FontFace) resolve against this; must be an absolute URL.
window.EXCALIDRAW_ASSET_PATH = assetBase()
injectStyles()

/** Slot component: the host slot renderer mounts this; it owns the Excalidraw canvas. */
export function ExcalidrawSurface() {
  const onApi = React.useCallback((api) => {
    if (!api) return
    window.__EXCALIDRAW_API__ = api
    window.__EXCALIDRAW_READY__ = true
  }, [])
  return React.createElement(
    'div',
    { className: 'dsh-excalidraw-surface', style: { position: 'relative', width: '100%', height: '100%' } },
    React.createElement(Excalidraw, {
      excalidrawAPI: onApi,
      initialData: { appState: { viewBackgroundColor: '#ffffff' } },
      UIOptions: {
        canvasActions: {
          export: false,
          loadScene: false,
          saveToActiveFile: false,
          saveAsImage: false,
          toggleTheme: false,
        },
      },
    }),
  )
}

/** Cordis plugin contract: inject the slot service, register a contribution. */
export const inject = ['slots']

export function apply(ctx) {
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'excalidraw-canvas', order: 5 },
      ExcalidrawSurface,
    ),
  )
}

/** Spike-only accessors used by the harness page (not part of the plugin contract). */
export function api() {
  return window.__EXCALIDRAW_API__
}

export const versions = { react: React.version, excalidraw: '0.18.1' }

export { Excalidraw, convertToExcalidrawElements, serializeAsJSON, exportToSvg, exportToBlob }
