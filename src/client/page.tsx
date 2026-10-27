/**
 * The Excalidraw page: scene list, a real interactive Excalidraw canvas, save
 * with revision fencing, conflict recovery and editor evidence reporting.
 * @module client/page
 */

import * as React from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { Scene, SceneElement, SceneFile, SceneSummary } from '../core/types.ts'
import {
  ApiError,
  createScene,
  listScenes,
  readScene,
  reportEditor,
  saveScene,
} from './api.ts'
import type { ScenePayload } from './api.ts'
import type { Translate } from './locale.ts'

const PLUGIN_SOURCE = 'https://github.com/Jegozhou/dsh-excalidraw'
const CLIENT_BUILD = '0.1.0'

/** The slice of the Excalidraw imperative API this page depends on. */
interface ExcalidrawApi {
  getSceneElements: () => readonly unknown[]
  getAppState: () => Record<string, unknown>
  getFiles: () => Record<string, SceneFile>
}

/** Props injected by the slot registration. */
export interface PageProps {
  t: Translate
}

/** Whether the scene name in the New-scene field is acceptable. */
function validName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,63})$/.test(name) && !name.includes('..')
}

/** Detect the Harness theme without reaching into another plugin's DOM tree. */
function detectTheme(): 'light' | 'dark' {
  const root = document.documentElement
  const attribute = root.getAttribute('data-theme') ?? document.body?.getAttribute('data-theme')
  if (attribute === 'dark' || attribute === 'light') return attribute
  if (root.classList.contains('dark') || document.body?.classList.contains('dark')) return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}

/** Track the host theme. */
function useHostTheme(): 'light' | 'dark' {
  const [theme, setTheme] = React.useState<'light' | 'dark'>(detectTheme)
  React.useEffect(() => {
    const update = (): void => setTheme(detectTheme())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener?.('change', update)
    }
  }, [])
  return theme
}

/** A stable request id for one save attempt, reused across safe retries. */
function newRequestId(name: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `ui:${name}:${Date.now().toString(36)}:${random}`
}

/** The page component registered into the Harness main panel. */
export function ExcalidrawPage({ t }: PageProps): React.ReactElement {
  const theme = useHostTheme()
  const [scenes, setScenes] = React.useState<SceneSummary[]>([])
  const [listLoading, setListLoading] = React.useState(true)
  const [record, setRecord] = React.useState<ScenePayload | null>(null)
  const [loadingScene, setLoadingScene] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [conflict, setConflict] = React.useState<{ currentRevision: number; updatedAt: string | null } | null>(null)
  const [newName, setNewName] = React.useState('')
  const [generation, setGeneration] = React.useState(0)
  const [elementCount, setElementCount] = React.useState(0)

  const apiRef = React.useRef<ExcalidrawApi | null>(null)
  const readyRef = React.useRef(false)
  const currentNameRef = React.useRef<string | null>(null)
  const requestIdRef = React.useRef<string | null>(null)
  const saveRef = React.useRef<() => void>(() => undefined)
  const noticeTimer = React.useRef<number | null>(null)

  const showNotice = React.useCallback((message: string): void => {
    setNotice(message)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400)
  }, [])

  React.useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
  }, [])

  const refreshList = React.useCallback(async (): Promise<void> => {
    try {
      const payload = await listScenes()
      setScenes(payload.scenes)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setListLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshList()
  }, [refreshList])

  const openScene = React.useCallback(async (name: string): Promise<void> => {
    if (dirty && !window.confirm(t('unsaved'))) return
    setLoadingScene(true)
    setError(null)
    setConflict(null)
    try {
      const payload = await readScene(name)
      currentNameRef.current = name
      requestIdRef.current = null
      readyRef.current = false
      apiRef.current = null
      setRecord(payload)
      setElementCount(payload.elementCount)
      setDirty(false)
      setGeneration(value => value + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoadingScene(false)
    }
  }, [dirty, t])

  const collectScene = React.useCallback((): { scene: Scene; elements: SceneElement[] } => {
    const api = apiRef.current
    if (!api) throw new Error(t('editorLoading'))
    const elements = api.getSceneElements() as SceneElement[]
    const appState = api.getAppState()
    const files = api.getFiles() as Record<string, SceneFile>
    const scene: Scene = {
      type: 'excalidraw',
      version: 2,
      source: PLUGIN_SOURCE,
      elements: [...elements],
      appState: {
        viewBackgroundColor: typeof appState.viewBackgroundColor === 'string' ? appState.viewBackgroundColor : '#ffffff',
        gridSize: typeof appState.gridSize === 'number' ? appState.gridSize : null,
        gridModeEnabled: appState.gridModeEnabled === true,
      },
      files,
    }
    return { scene, elements }
  }, [t])

  const save = React.useCallback(async (options: { force?: boolean } = {}): Promise<void> => {
    const current = record
    if (!current || saving || !apiRef.current) return
    setSaving(true)
    setError(null)
    let requestId = requestIdRef.current
    if (requestId === null) {
      requestId = newRequestId(current.name)
      requestIdRef.current = requestId
    }
    try {
      const { scene, elements } = collectScene()
      let saved
      for (let attempt = 0; ; attempt += 1) {
        try {
          saved = await saveScene(current.name, {
            scene,
            expectedRevision: current.revision,
            requestId,
            force: options.force === true,
          })
          break
        } catch (failure) {
          // A transport failure may have happened after the Host committed.
          // Reusing the request id turns the retry into an idempotent read.
          if (attempt === 0 && failure instanceof ApiError && failure.code === 'network') {
            await new Promise(resolve => window.setTimeout(resolve, 300))
            continue
          }
          throw failure
        }
      }
      setRecord(previous => previous === null ? previous : {
        ...previous,
        revision: saved.revision,
        sha256: saved.sha256,
        byteLength: saved.byteLength,
        elementCount: saved.elementCount,
        updatedAt: saved.savedAt,
        scene,
      })
      setElementCount(saved.elementCount)
      setDirty(false)
      setConflict(null)
      requestIdRef.current = null
      showNotice(saved.duplicate ? `${t('saved')} · ${t('revision')} ${saved.revision}` : t('saved'))
      void reportEditor({
        event: 'saved',
        sceneName: current.name,
        revision: saved.revision,
        sha256: saved.sha256,
        elementCount: elements.length,
        build: CLIENT_BUILD,
      }).catch(() => undefined)
      void refreshList()
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'revision_conflict') {
        const details = (failure.details ?? {}) as { currentRevision?: unknown; updatedAt?: unknown }
        setConflict({
          currentRevision: typeof details.currentRevision === 'number' ? details.currentRevision : current.revision,
          updatedAt: typeof details.updatedAt === 'string' ? details.updatedAt : null,
        })
      } else {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      setSaving(false)
    }
  }, [collectScene, record, refreshList, saving, showNotice, t])

  React.useEffect(() => {
    saveRef.current = () => { void save() }
  }, [save])

  React.useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  React.useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const canvas = document.querySelector('.dsh-exc-canvas .excalidraw') as HTMLElement | null
      void reportEditor({
        event: 'mounted',
        build: CLIENT_BUILD,
        sceneName: currentNameRef.current,
        width: canvas?.clientWidth ?? null,
        height: canvas?.clientHeight ?? null,
        theme,
      }).catch(() => undefined)
    }, 600)
    return () => {
      window.clearTimeout(timer)
      void reportEditor({ event: 'unmounted', build: CLIENT_BUILD, sceneName: currentNameRef.current }).catch(() => undefined)
    }
  }, [theme])

  const handleApi = React.useCallback((api: ExcalidrawApi | null): void => {
    apiRef.current = api
    // Read-only verification hook: proves what the live canvas contains without
    // reaching into Excalidraw internals. It is replaced on every remount.
    ;(window as unknown as { __DSH_EXCALIDRAW_API__?: unknown }).__DSH_EXCALIDRAW_API__ = api
    if (!api) return
    window.setTimeout(() => {
      readyRef.current = true
      const count = api.getSceneElements().length
      setElementCount(count)
      void reportEditor({
        event: 'canvas-ready',
        build: CLIENT_BUILD,
        sceneName: currentNameRef.current,
        elementCount: count,
      }).catch(() => undefined)
    }, 350)
  }, [])

  const handleChange = React.useCallback((): void => {
    if (!readyRef.current) return
    setDirty(true)
    requestIdRef.current = null
    const elements = apiRef.current?.getSceneElements()
    if (elements) setElementCount(elements.length)
  }, [])

  const create = React.useCallback(async (): Promise<void> => {
    const name = newName.trim()
    if (!validName(name)) {
      setError(t('nameInvalid'))
      return
    }
    setError(null)
    try {
      await createScene(name)
      setNewName('')
      await refreshList()
      await openScene(name)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [newName, openScene, refreshList, t])

  const reload = React.useCallback(async (): Promise<void> => {
    if (!record) return
    setLoadingScene(true)
    setConflict(null)
    try {
      const payload = await readScene(record.name)
      apiRef.current = null
      readyRef.current = false
      requestIdRef.current = null
      setRecord(payload)
      setElementCount(payload.elementCount)
      setDirty(false)
      setGeneration(value => value + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoadingScene(false)
    }
  }, [record])

  const initialData = React.useMemo(() => {
    if (!record) return null
    return {
      elements: record.scene.elements,
      appState: {
        ...record.scene.appState,
        showWelcomeScreen: false,
        theme,
      },
      files: record.scene.files,
      scrollToContent: true,
    }
  }, [record, theme])

  const status = record
    ? `${t('revision')} ${record.revision} · ${t('elements')} ${elementCount} · ${record.sha256.slice(0, 12)}`
    : t('panelHint')

  return (
    <div className="dsh-exc-page">
      <header className="dsh-exc-head">
        <strong>{t('panel')}</strong>
        <span className="dsh-exc-sub">{record ? record.name : t('panelHint')}</span>
        <span className="dsh-exc-spacer" />
        {dirty ? <span className="dsh-exc-badge dirty">{t('unsaved')}</span> : null}
        {record ? <span className="dsh-exc-badge">{t('revision')} {record.revision}</span> : null}
        <button
          type="button"
          className="dsh-exc-button primary"
          disabled={record === null || !dirty || saving}
          onClick={() => { void save() }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </header>
      <div className="dsh-exc-body">
        <aside className="dsh-exc-side">
          <div className="dsh-exc-side-title">{t('scenes')}</div>
          <div className="dsh-exc-list">
            {listLoading ? <div className="dsh-exc-loading">{t('editorLoading')}</div> : null}
            {!listLoading && scenes.length === 0 ? <div className="dsh-exc-loading">{t('empty')}</div> : null}
            {scenes.map(scene => (
              <button
                key={scene.name}
                type="button"
                className={`dsh-exc-item${record?.name === scene.name ? ' active' : ''}`}
                onClick={() => { void openScene(scene.name) }}
                title={`${scene.name} · ${scene.updatedAt}`}
              >
                <span className="dsh-exc-item-name">{scene.name}</span>
                <span className="dsh-exc-item-meta">
                  <span>{t('revision')} {scene.revision}</span>
                  <span>{scene.elementCount} {t('elements')}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="dsh-exc-new">
            <input
              className="dsh-exc-input"
              value={newName}
              placeholder={t('sceneName')}
              aria-label={t('sceneName')}
              onChange={event => setNewName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void create() }}
            />
            <button type="button" className="dsh-exc-button" onClick={() => { void create() }}>
              {t('newScene')}
            </button>
          </div>
        </aside>
        <section className="dsh-exc-main">
          {conflict ? (
            <div className="dsh-exc-banner" role="alert">
              <p><strong>{t('conflict')}</strong></p>
              <p>{t('conflictDetail')} ({t('revision')} {conflict.currentRevision})</p>
              <div className="dsh-exc-banner-actions">
                <button type="button" className="dsh-exc-button" onClick={() => setConflict(null)}>{t('cancel')}</button>
                <button type="button" className="dsh-exc-button" onClick={() => { void reload() }}>{t('reload')}</button>
                <button type="button" className="dsh-exc-button primary" onClick={() => { void save({ force: true }) }}>{t('overwrite')}</button>
              </div>
            </div>
          ) : null}
          {record && initialData ? (
            <div className="dsh-exc-canvas" key={`${record.name}:${generation}`}>
              <Excalidraw
                initialData={initialData as never}
                excalidrawAPI={handleApi as never}
                onChange={handleChange}
                theme={theme}
                autoFocus={false}
                UIOptions={{
                  canvasActions: {
                    export: false,
                    loadScene: false,
                    saveToActiveFile: false,
                    saveAsImage: false,
                    toggleTheme: false,
                    clearCanvas: true,
                  },
                }}
              />
            </div>
          ) : (
            <div className="dsh-exc-empty">
              {loadingScene ? t('editorLoading') : scenes.length === 0 ? t('empty') : t('open')}
            </div>
          )}
          {notice ? <div className="dsh-exc-toast">{notice}</div> : null}
          {error ? (
            <div className="dsh-exc-toast error" role="alert" onClick={() => setError(null)}>
              {t('error')}: {error}
            </div>
          ) : null}
          <footer className="dsh-exc-status">
            <span>{status}</span>
            <span className="dsh-exc-spacer" />
            {record ? <code>{dirty ? t('dirty') : `${t('savedAt')} ${record.updatedAt}`}</code> : null}
          </footer>
        </section>
      </div>
    </div>
  )
}
