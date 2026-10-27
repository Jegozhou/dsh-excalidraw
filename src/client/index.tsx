/**
 * DSH Excalidraw — browser half.
 *
 * Registers one full-size page in the Harness `main` panel and one icon in the
 * sidebar's panel list. The page owns a genuine Excalidraw canvas; the Host
 * owns persistence and revision checks. Styles and dictionaries are effects, so
 * disabling the plugin removes everything this half added.
 * @module client/index
 */

import * as React from 'react'
import excalidrawCss from '@excalidraw/excalidraw/index.css'
import { ExcalidrawPage } from './page.tsx'
import type { PageProps } from './page.tsx'
import { CSS } from './styles.ts'
import { EN, LOCALE_NS, ZH } from './locale.ts'
import type { Translate } from './locale.ts'

const PANEL_ID = 'dsh-excalidraw'
const ASSET_BASE = '/dsh-excalidraw/assets/'

/** Rewrite the stylesheet's relative font URLs for the Host asset route. */
const EXCALIDRAW_STYLES = excalidrawCss
  .replaceAll('url("./fonts/', `url("${ASSET_BASE}fonts/`)
  .replaceAll("url('./fonts/", `url('${ASSET_BASE}fonts/`)

/** Services this half reads; Cordis blocks direct access without them. */
export const inject = ['locale', 'slots']

interface ClientContext {
  locale: {
    register: (namespace: string, dictionaries: Record<string, Record<string, string>>) => () => void
    bind: (namespace: string) => Translate
  }
  effect: (callback: () => void | (() => void), label?: string) => unknown
  slots: {
    inject: (name: string, callback: () => unknown) => unknown
    register: (definition: Record<string, unknown>, component: unknown) => unknown
  }
}

/** Decorative sidebar glyph: a pen stroke over a frame, in currentColor. */
function ExcalidrawIcon({ size }: { size: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3.4" />
      <path d="M7.2 15.4c2-6.2 4.4-8 6.2-6.8 1.9 1.2-1.4 5 .5 5.9 1.4.7 2.8-.9 3.7-3" />
      <circle cx="7.2" cy="15.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Cordis plugin body for the browser half. */
export function apply(ctx: ClientContext): void {
  try {
    activate(ctx)
  } catch (error) {
    console.error('[dsh-excalidraw] client activation failed:', error)
    throw error
  }
}

function activate(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(LOCALE_NS, { en: EN, zh: ZH }),
    'dsh-excalidraw: dictionaries',
  )
  const t = ctx.locale.bind(LOCALE_NS)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshExcalidraw = ''
    style.textContent = `${EXCALIDRAW_STYLES}\n${CSS}`
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-excalidraw: styles')

  ctx.effect(() => {
    const previous = window.EXCALIDRAW_ASSET_PATH
    window.EXCALIDRAW_ASSET_PATH = ASSET_BASE
    return () => {
      if (previous === undefined) delete window.EXCALIDRAW_ASSET_PATH
      else window.EXCALIDRAW_ASSET_PATH = previous
    }
  }, 'dsh-excalidraw: asset path')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: LOCALE_NS,
    inject: (): PageProps => ({ t }),
  }, ExcalidrawPage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    locale: LOCALE_NS,
    label: () => t('panel'),
  }, ExcalidrawIcon))
}
