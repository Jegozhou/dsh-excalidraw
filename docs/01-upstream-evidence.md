# 01 — Upstream evidence: obsidian-excalidraw-plugin

**Subject:** `zsviczian/obsidian-excalidraw-plugin`
**Pinned commit:** `9e52063296ffcd3b38d6a2bd5b23546d7e6268f7` (2026-10-27, subject “0.18.145: Implemented mearmaid-to-excalidraw 3.0.0, moved to Pele”)
**Working clone:** `upstream/obsidian-excalidraw-plugin` (read-only evidence)
**Runtime dependency:** `@zsviczian/excalidraw@0.18.145`
**Companion docs:** license audit → [`06-license-audit.md`](06-license-audit.md); fixtures → [`fixtures/upstream/manifest.json`](../fixtures/upstream/manifest.json); raw outputs → [`docs/evidence/upstream/`](evidence/upstream/).

> **Method.** Every claim below was read from the pinned working tree, not from a README. `path:line` citations are exact at this commit; dependency-package and registry/GitHub sources are labelled with their own path or URL. Command output and grep results backing the claims are saved under [`docs/evidence/upstream/`](evidence/upstream/). Where a statement comes from an upstream design document rather than executable source, it is marked **[doc]**. Where the repository contradicts itself, the contradiction is kept visible.

> **What was *not* verified.** The clone is a partial/promisor clone; some git-history objects are missing, and `git log`/`rev-list` attempts triggered network fetches that were stopped. We did not build or run the plugin inside Obsidian (no Obsidian runtime was available). The Excalidraw runtime was executed only to generate fixtures and validate them (`fixtures/upstream/tools/`). The upstream design doc describes a still-evolving persistence refactor and explicitly records unresolved divergence; it is treated as testimony, not proof.

---

## 1. Repository identity and version facts

| Fact | Value | Evidence |
|---|---|---|
| Commit | `9e52063296ffcd3b38d6a2bd5b23546d7e6268f7` | `git rev-parse HEAD`; [evidence 01](evidence/upstream/01-commit-and-version.txt) |
| Commit date | 2026-10-27 19:43:42 +0100 | `git log -1` |
| Author | zsviczian | `git log -1` |
| `package.json` version | **2.2.5** | `package.json:3` |
| `manifest.json` version | **2.29.0** | `manifest.json:4` |
| `manifest-beta.json` version | **2.29.0** | `manifest-beta.json:4` |
| Bundled `PLUGIN_VERSION` | **2.29.0** (from `manifest-beta.json`) | `rollup.config.mjs:133,264` |
| `package-lock.json` version | 2.2.5 | `package-lock.json:3` |
| Shipped repo zip manifest | 2.27.3 (stale) | evidence [10 §6](evidence/upstream/10-license-evidence.txt) |
| Obsidian minimum app version | 1.8.7 | `manifest.json:5` |
| Node engine stated by package | `>=22.0.0` | `package.json` engines |
| Source size | 277 `.ts`/`.tsx` files, **106,925 lines** | [evidence 04](evidence/upstream/04-module-map.txt) |
| License declarations | `LICENSE` = AGPL-3.0; `package.json` = MIT; manifest has none | [`06-license-audit.md`](06-license-audit.md), [evidence 10](evidence/upstream/10-license-evidence.txt) |

The version disagreement is not cosmetic: the build reads `manifest-beta.json` (`rollup.config.mjs:133`) and injects that version into the bundle (`rollup.config.mjs:264`), so the runtime reports 2.29.0 while npm-style metadata reports 2.2.5. The brief's “version 2.2.5” is therefore a **package.json/package-lock fact, not the plugin version observed at runtime**. This is a metadata-trust warning for the whole audit.

The plugin id is `obsidian-excalidraw-plugin` (`manifest.json:2`); the view type is `excalidraw` (`src/constants/constants.ts:459`); the legacy extension `.excalidraw` maps to that view (`src/core/main.ts:445`), while modern drawings are Markdown files containing an Excalidraw envelope (see §8).

---

## 2. Build pipeline

### 2.1 Bundler: Rollup only; `esbuild.config.json` is dead configuration

- `package.json` scripts drive **Rollup**: `dev` (`NODE_ENV=development`), `build` (`NODE_ENV=production`), and `lib` (`NODE_ENV=lib`) all invoke `rollup --config rollup.config.mjs` (`package.json` scripts; [evidence 03](evidence/upstream/03-build-pipeline.txt) §scripts).
- `esbuild.config.json` contains only `{"minify": true}` and **nothing in the repository references it**; `esbuild` is not a dependency of the plugin (evidence 03 §references). The actual production minifier is `@rollup/plugin-terser` plus an `uglify-js` pass for embedded runtime payloads.
- TypeScript: `module: es2020`, `target: es2022`, `moduleResolution: node`, JSX `react` (`tsconfig.json:4-5,33,43`). `tsconfig-lib.json` is used for the automation `lib` build.
- The Obsidian plugin output is `dist/main.js` as **CommonJS** (`format: "cjs"`, `exports: "default"`, `inlineDynamicImports: true`) plus `dist/styles.css` and `dist/manifest.json` (`rollup.config.mjs:324-363`). The `lib` build (`src/core/index.ts` → `lib/`) is a separate **automation library** entry, not the plugin entry (`rollup.config.mjs:366-392`; `src/core/index.ts:25-35`).
- `copyBuildFiles(['manifest.json'], DIST_FOLDER)` copies the **stable** `manifest.json`, not the beta one (`rollup.config.mjs:363`) — yet the version injected into code comes from `manifest-beta.json` (`:133,264`).

### 2.2 The Excalidraw runtime is embedded as a compressed, eval'd payload

This is the single most important build fact for a reimplementation:

1. The production build reads the fork's prebuilt Obsidian bundle **as a string**: `./node_modules/@zsviczian/excalidraw/dist/obsidian/excalidraw.production.min.js` (`rollup.config.mjs:92`).
2. It appends a generated preamble that embeds that string DEFLATE-compressed + base64 (`compressDeflateBase64`, `rollup.config.mjs:17-21,223`), along with a `pako` inflate implementation (`:217-222`) and a React/ReactDOM runtime built from installed packages (`scripts/buildReactRuntime.mjs`; `rollup.config.mjs:101-109`).
3. At module-evaluation time the bundle defines `window.unpackBase64Deflate` and `evaluateRuntimeInstructions = (win, instruction) => win.eval.call(win, instruction)` (`rollup.config.mjs:221-226`), then `eval`s React and (lazily) the Excalidraw runtime. The fork's bundle ends with `self.ExcalidrawLib = ExcalidrawLib` (observed in the installed package).
4. `@zsviczian/excalidraw` is nevertheless listed in Rollup `external` (`rollup.config.mjs:292-307`) because the source imports its **types** and expects the runtime global to exist; the actual runtime code comes from the eval'd payload.
5. Non-English locales are separately minified, deflated and base64'd (`rollup.config.mjs:55-89`); plugin CSS is concatenated with the fork's CSS and run through `cssnano` (`rollup.config.mjs:112-131`).

Implication: the shipped `main.js` is a single CJS file that **evaluates a ~6.5 MB third-party runtime from a compressed string** at load. This is a deliberate size workaround (Obsidian's 5 MB bundle guidance is discussed in the config comments, `rollup.config.mjs:160-200`), not a plugin architecture we should copy. It also means the plugin build is **not reproducible from this repository alone**: it consumes a prebuilt `dist/obsidian` artifact that is shipped inside the fork's npm tarball (`dist/obsidian/excalidraw.production.min.js`, 6,507,493 bytes) but is not built by this repo's Rollup config.

### 2.3 Library build and automation artifact

`NODE_ENV=lib` builds `src/core/index.ts` to `lib/index.js` with `getEA()` and type re-exports (`src/core/index.ts:1-35`). This is what `package.json`'s `main`/`types` point at (`package.json:5-6`), which is *not* the Obsidian plugin entry. Tooling that imports the npm package expecting a plugin gets a library shim instead.

---

## 3. Module structure

Counts and responsibilities from [evidence 04](evidence/upstream/04-module-map.txt):

| Directory | Files | Lines | Responsibility | Key files |
|---|---:|---:|---|---|
| `src/core/` | 55 | 20,783 | Plugin lifecycle, commands, settings, CLI, host managers | `main.ts` (1,503), `managers/CommandManager.ts` (2,573), `settings.ts` (5,543), `cli/*` (14 files) |
| `src/view/` | 30 | 22,471 | Obsidian view, save/sync/load lifecycle, UI, sidepanel | `ExcalidrawView.ts` (8,400), `managers/ViewSaveCoordinator.ts` (759), `managers/ViewSceneFileManager.ts` (529) |
| `src/shared/` | 82 | 32,634 | Domain model, automation API, embedded files, markdown parsing, scripts | `ExcalidrawAutomate.ts` (5,583), `EmbeddedFileLoader.ts` (3,162), `ExcalidrawData.ts` (2,613), `Scripts.ts` (1,291) |
| `src/utils/` | 51 | 16,439 | Pure-ish helpers: files, export, scene, links, fonts, AI, PDF | `AIUtils.ts`, `excalidrawAutomateUtils.ts`, `fileUtils.ts`, `exportUtils.ts` |
| `src/constants/` | 7 | 2,980 | Ids, settings, keys, blank drawings, icons | `constants.ts` (incl. `FRONTMATTER_KEYS` at 313) |
| `src/types/` | 27 | 1,968 | Type declarations and vendored `.d.ts` | `excalidrawAutomateTypes.ts`, `types.d.ts` |
| `src/lang/` | 25 | 9,650 | 23 locale files + helper | `locale/en.ts` (2,104) |

Entry/lifecycle:

- `export default class ExcalidrawPlugin extends Plugin` at `src/core/main.ts:168`; `onload()` at `:432`.
- `onload()` registers the drawing view (`src/core/main.ts:434`), the sidepanel view (`:440`), and the `.excalidraw` extension (`:445`), then initializes settings, `ExcalidrawAutomate` (`:466`), the CLI (`:472`), the Markdown post-processor, and a layout-ready hook (`:483-484`).
- `ExcalidrawView extends TextFileView` at `src/view/ExcalidrawView.ts:465-466`; the save coordinator class is `src/view/managers/ViewSaveCoordinator.ts:121`.
- `ExcalidrawData` (the parsed Markdown/domain model) is `src/shared/ExcalidrawData.ts:301`.
- `ExcalidrawAutomate` is `src/shared/ExcalidrawAutomate.ts:333`; the global is installed by `initExcalidrawAutomate()` (`src/utils/excalidrawAutomateUtils.ts:243-247`) and removed on unload (`src/core/main.ts:993-994`).

The architecture is a four-layer document pipeline, stated by the upstream design doc and confirmed in source:

```
Vault file (.excalidraw.md / .excalidraw)
   │  TextFileView.data (raw Markdown / raw JSON)
   ▼
ExcalidrawData (parsed domain model: scene, textElements, elementLinks, files, equations, markdownImages, mermaid)
   │
   ▼
live Excalidraw runtime (elements + appState + binary files)
   │  save snapshot / getViewData()
   ▼
preparedSaveText ──► TextFileView.save() ──► Vault write ──► "modify" event ──► sync or reload
```

Source anchors: `ExcalidrawView` fields and comments at `src/view/ExcalidrawView.ts:476-520`; `prepareGetViewData`/`getViewData` at `:1359-1474`; `ExcalidrawData.loadData` at `src/shared/ExcalidrawData.ts:737`; `generateMDAsync` at `:1731`. The design doc describes the same five representations in `docs/Excalidraw Plugin File Persistence Lifecycle Design.md:158-270`.

---

## 4. Call path: pointer input → scene change → persistence → reload

### 4.1 Stage 1 — pointer input enters the editor

The plugin mounts the fork's `<Excalidraw>` React component inside its own wrapper (`src/view/components/ExcalidrawRoot.ts:150-215`). The wrapper handles Obsidian-specific gestures and forwards the raw pointer event to the view:

- `onPointerDownCapture` snapshots selection and resets pointer state (`ExcalidrawRoot.ts:159-163`).
- The wrapper's `onPointerDown` calls `view.onPointerDown(...)` for Ctrl/Cmd link-click behaviour (`ExcalidrawRoot.ts:164-171`); this is *not* the drawing path.
- The `<Excalidraw>` prop `onPointerDown` stores `pointerDownState` (`ExcalidrawRoot.ts:179-181`).
- Element creation, freehand strokes, selection and transforms are handled inside the fork's editor store. The fork exposes the event contract in its type declarations: `onChange?: (elements, appState, files) => void` and `onIncrement?: (DurableIncrement | EphemeralIncrement) => void` (`@zsviczian/excalidraw/types/excalidraw/types.d.ts:775,780`); increments are emitted by the element `Store` (`types/element/src/store.d.ts:46-47`). The plugin does not intercept pointer moves to build elements itself — the runtime owns that.

### 4.2 Stage 2 — the scene change becomes “dirty”

Two callbacks are wired in `ExcalidrawRoot.ts:206-208`:

```ts
onChange: (et, st, files) => view.onChange(et, st, files),
onIncrement: (event) => view.onExcalidrawIncrement(event),
```

**Element changes** — `ExcalidrawView.onExcalidrawIncrement` (`ExcalidrawView.ts:5969`) ignores `ephemeral` increments, and for a `durable` increment with at least one changed element calls `this.setDirty()` (`:5979-5980`). It separately queues keep-or-delete prompts for soft-deleted local Markdown images (`:5984-6004`). This is the primary durable-edit path.

**Persisted app-state changes** — `ExcalidrawView.onChange` (`:5996`) handles the first callback after load specially (`semaphores.justLoaded`, `:6039-6072`), then compares only drawing-owned app state (`captureTrackedAppState` / `didTrackedAppStateChange`, `src/view/trackedAppState.ts:4-20,86-108`) and calls `setDirty()` when it changed (`ExcalidrawView.ts:6078-6082`). The tracked list is theme, background, grid settings, colour palette/top picks, frame rendering, object-snap, binding preference, midpoint snapping, box-selection mode, and (conditionally) viewport scroll/zoom — deliberately not every transient UI value.

`ExcalidrawView.setDirty()` delegates to the coordinator (`ExcalidrawView.ts:4305-4307`). `ViewSaveCoordinator.setDirty()`:

1. restarts the autosave timer if it was clean (`ViewSaveCoordinator.ts:583-585`);
2. increments `currentRevision` (`:586`);
3. stores the dirty file path and marks dirty visuals (`:587-589`);
4. queues a trailing save if a save loop is already running (`:590-592`).

This revision counter — not a boolean — is the core of the upstream save model. `isDirty()` compares `currentRevision > savedRevision` and the file path (`ViewSaveCoordinator.ts:595-601`); save capture samples the same counter (`:605-607`).

### 4.3 Stage 3 — a save is requested and coalesced

Save triggers are broader than a single timer (`ViewSaveCoordinator.ts:493-570`; design doc table at `docs/Excalidraw Plugin File Persistence Lifecycle Design.md:566-590`): autosave interval, window blur, leaf switch, menu actions, unload/close, same-file editor handoff, image import, and explicit force save.

`ViewSaveCoordinator.save()`/`saveWithOutcome()` (`:189-221`) enqueue a request; concurrent requests merge into one pending request with the newest revision (`mergeSaveRequests`, `:249-269`), and a single `drainSaveQueue()` loop executes them (`:271-299`). After a save, `completeSaveRevision()` advances `savedRevision` only for an acknowledged revision and reconciles dirty state (`:301-356`). This prevents “save A completes after edit B and clears B's dirty flag”.

### 4.4 Stage 4 — `executeSaveRequest`: snapshot → domain sync → serialize → write

The actual persistence is `ExcalidrawView.executeSaveRequest()` (`ExcalidrawView.ts:1066`). Sequence with line anchors:

| Step | What happens | Evidence |
|---|---|---|
| 1 | Bail out if not loaded, same-file editor active, or file missing | `ExcalidrawView.ts:1075-1087` |
| 2 | Decide `shouldPersist = isDirty() || forcePersistence` | `:1104-1105` |
| 3 | Snapshot live appState + scene, deleted elements, selected IDs, export settings, captured revision | `:1106-1145` (`createSaveSnapshot` at `:1131`) |
| 4 | `excalidrawData.syncElements(scene[, selectedIds])` — externalize files, update text elements/links/PDF/equations/preferences | `:1154-1159`; `ExcalidrawData.syncElements` at `src/shared/ExcalidrawData.ts:2058-2079` |
| 5 | If sync changed canonical metadata, reinstall the normalized scene into the live runtime | `:1161-1171` (`loadDrawing(false, deletedElements)`) |
| 6 | Prepare the final Markdown synchronously-consumable string | `:1175-1180` (`prepareGetViewDataFromSnapshot` at `:1369`) |
| 7 | Record the prepared save identity and arm the own-write guard only immediately before the write | `:1180-1183`, `:1303` |
| 8 | `await super.save()` inside a per-path write lease | `:1305-1308` |
| 9 | BAK backup, autoexport request, timestamp bookkeeping | `:1316-1335` |

`prepareGetViewDataFromSnapshot()` is the serializer bridge:

- It preserves the incoming header by `getExcalidrawMarkdownHeaderSection(sourceTextSnapshot, keys)` and updates frontmatter keys (plugin mode, export settings) (`:1395-1439`).
- It syncs local Markdown-image blocks in the header (`:1436-1439`).
- It can disable compression when the same drawing is being edited as Markdown in another view (`:1444-1448`).
- It collects deleted elements (tombstones) and calls `excalidrawData.generateMDAsync(deletedElements)` (or sync) (`:1450-1459`).
- It concatenates `header + generated + tail` into `this.preparedSaveText` (`:1460-1463`).
- `getViewData()` returns `preparedSaveText ?? this.data` (`:1474-1476`) because Obsidian's `TextFileView.getViewData()` is synchronous while compression can be async — the upstream comment calls this out at `:1359-1362`.

**Legacy `.excalidraw` branch.** When `compatibilityMode` is true (set by `loadLegacyData`, `src/shared/ExcalidrawData.ts:1143-1153`), preparation does not build a Markdown envelope: it writes `JSON.stringify(scene, null, "\t")` (`ExcalidrawView.ts:1466-1469`). That is the raw `.excalidraw` file: `{type,version,source,elements,appState,files}` with tab indentation.

**Attachment handling inside the save.** `syncElements` calls `syncFiles()` (`ExcalidrawData.ts:1864-2056`), which:

- collects image elements and their `fileId`s;
- drops registry entries with no image element;
- for every binary in `scene.files`, saves the data URL into the vault (via `saveDataURLtoVault`, `:1759-1815`) or reuses an existing embedded file, then records an `EmbeddedFile` in `this.files`;
- clears `scene.files = {}` after externalization (`:2066`), so the serialized Markdown does **not** carry base64 blobs; the drawing instead gets a `## Embedded Files` section mapping `fileId → [[vault path]]` (`generateMDBase`, `:1678-1712`).

`fileId` is derived by SHA-1 of the binary bytes (plus an optional link key), hex-encoded (`EmbeddedFileLoader.generateIdFromFile`, `src/shared/EmbeddedFileLoader.ts:3083-3112`).

### 4.5 Stage 5 — Obsidian writes and emits `modify`

`super.save()` uses Obsidian's `TextFileView` contract: it calls the synchronous `getViewData()` and writes the returned text through the vault. The plugin's own comment explains why it prepares before calling `super.save()` (`ExcalidrawView.ts:1359-1362`). The write is wrapped in `withPersistenceWriteLease(preparedSave.filePath, ...)` (`:1305`) and preceded by `ownWriteReloadGuard.setForWrite(suppressReloadFromOwnWrite)` (`:1303`), so the expected self-write echo can be recognised.

Obsidian then emits a vault `modify` event. Registration: `this.app.vault.on("modify", file => this.onModifyHandler(file))` (`src/core/managers/EventManager.ts:119-121`), forwarded to `plugin.modifyEventHandler(file)` (`EventManager.ts:280`) and implemented by `FileManager.modifyEventHandler` (`src/core/managers/FileManager.ts:674`).

### 4.6 Stage 6 — modify routing, self-write suppression, sync vs reload

`FileManager.modifyEventHandler` (`FileManager.ts:674-755`):

1. matches the modified path to open drawing views, including the `.excalidraw` ↔ corresponding `.md` relationship (`:679-691`);
2. skips closing/migrating views (`:694`);
3. consumes the own-write suppression marker; for Markdown it still inspects content (`:697-705`, `shouldInspectSuppressedModifyContent` in `src/core/managers/fileModifyRouting.ts:6-9`);
4. avoids sync/reload for a view that has been stale for 5 minutes (`FileManager.ts:704-726`);
5. calls `getDrawingModifyRoute(...)` (`fileModifyRouting.ts:26-45`):
   - `.md` + (dirty | persistence busy | Markdown side being edited in a split) → **incremental-sync**;
   - stale and not split-editing → **full-reload**;
   - other `.md` → **incremental-sync**;
   - `.excalidraw` → **raw-reload**;
6. for `full-reload`/`raw-reload`, calls `excalidrawView.reload(true, view.file)` (`FileManager.ts:740-748`); for `incremental-sync`, calls `requestExternalSynchronization(file)` (`:745`).

The own-write guard and content classification live in `ViewSaveCoordinator.classifyContent()`/`observeAcceptedContent()` (`ViewSaveCoordinator.ts:636-690`) and `isRedundantObservedSaveContent` (used at `ExcalidrawView.ts:3696`). If the observed bytes are already represented by a successful write/accepted baseline, the event is treated as an echo and skipped; otherwise the latest vault text is read as external truth.

### 4.7 Stage 7 — incremental synchronization (the normal Markdown path)

`ExcalidrawView.requestExternalSynchronization(file)` (`ExcalidrawView.ts:3620-3624`) records one pending path and starts one drain loop (`ensureExternalSyncLoop`, `:3626-3657`).

`drainExternalSynchronization()` (`:3659-3745`):

1. takes the pending path and acquires synchronization ownership (`:3662-3676`);
2. reads the latest vault text (`:3687-3690`);
3. classifies it against the last accepted save content (`:3696`); if redundant, skip (`:3697-3699`);
4. parses it into a **temporary** `ExcalidrawData` (`:3700-3708`; `loadData`);
5. applies it with `applyIncomingSynchronization` (`:3720`), then records accepted content;
6. on parse error, rejects the incoming data and keeps the live scene (`:3727-3736`).

`applyIncomingSynchronization()` (`:3767-3990`):

- removes local elements whose IDs appear in the incoming tombstones (`:3799-3808`);
- for each incoming element, accepts it when `local.version < incoming.version`, or when versions are equal but `JSON.stringify` differs — i.e. **incoming wins a tie** (`:3870-3882`);
- inserts new incoming elements at the incoming layer position (`:3884-3900`);
- updates text/link/file/equation/markdown-image metadata for changed elements (`:3830-3860`);
- calls `updateScene({elements: mergedElements, captureUpdate: CaptureUpdateAction.NEVER})` (`:3968-3973`);
- reloads only the affected binary files (`:3975-3977`);
- if the merged scene version differs from the live one, calls `setDirty()` so the merged state can be persisted (`:3965-3967`).

This is explicitly **not a CRDT**: last-writer-by-element-version, with a deterministic tie rule, and layer order inherited from the incoming file.

### 4.8 Stage 8 — full reload

`ExcalidrawView.reload(fullreload, file, preserveViewport)` (`ExcalidrawView.ts:2631`):

1. same-file editing: refresh raw Markdown and request synchronization, do not tear down the scene (`:2639-2647`);
2. own-write suppression: return early (`:2650-2653`);
3. refuse while save/sync is active (`:2653-2656`);
4. legacy compatibility mode: clear the loaded-file marker, clear dirty, return (`:2657-2661`);
5. read the latest vault text (`:2672-2677`);
6. parse into `ExcalidrawData` via `loadData` (`:2670-2677`); a parse failure is caught and reported without destroying the current scene (`:2678-2695`);
7. install the scene via `loadDrawing(...)` (`:2704`) and `clearDirty()` (`:2710`).

`loadDrawing` (`ExcalidrawView.ts:3999-4070`) sets `semaphores.justLoaded`, clears dirty, updates the scene with `CaptureUpdateAction.NEVER` (so loading is not an undoable local edit), then installs appState and files (`api.addFiles`, `:4048-4055`). `updateScene` (`:8272-8335`) normalizes indices (`syncInvalidIndices`), can repair bindings (`restoreElements`), and forwards to the Excalidraw imperative API.

### 4.9 End-to-end summary

```
pointer/pen event
  └─> fork Excalidraw store mutates elements
        └─> onIncrement(durable) / onChange(elements, appState, files)
              └─> ExcalidrawView.setDirty()
                    └─> ViewSaveCoordinator.setDirty()  [currentRevision++]
                          └─> autosave / force save / unload trigger
                                └─> executeSaveRequest()
                                      ├─ snapshot live scene + revision
                                      ├─ ExcalidrawData.syncElements()  [externalize files]
                                      ├─ prepareGetViewDataFromSnapshot() [header + Markdown + JSON]
                                      └─ super.save() → getViewData() → vault write
                                            └─> Obsidian "modify"
                                                  └─> FileManager.modifyEventHandler()
                                                        ├─ own-write classification (skip echo)
                                                        ├─ incremental-sync: parse temp ExcalidrawData → version merge → updateScene()
                                                        └─ full/raw reload: parse → loadDrawing() → updateScene()
```

Source anchors for the whole chain: `ExcalidrawRoot.ts:206-208`, `ExcalidrawView.ts:5969-6082,4305-4307,1066-1335,3620-3990,2631-2710,3999-4070,8272-8335`; `ViewSaveCoordinator.ts:121-356,493-570`; `FileManager.ts:674-755`; `fileModifyRouting.ts:26-45`; `ExcalidrawData.ts:737-1130,1864-2080,2058-2079`.

---

## 5. ExcalidrawAutomate API surface

`ExcalidrawAutomate` is the plugin's public scripting API: 157 entries match the public-member pattern on one class (the list includes `constructor` and `setStyle`) (`src/shared/ExcalidrawAutomate.ts:333`; full inventory in [evidence 06](evidence/upstream/06-excalidraw-automate-api.txt)). It is installed as the global `window.ExcalidrawAutomate` (`src/utils/excalidrawAutomateUtils.ts:243-247`) and is the intended entry point for Templater/QuickAdd/DataviewJS scripts and the script engine.

### 5.1 Object model

| State | Meaning | Evidence |
|---|---|---|
| `targetView` | live `ExcalidrawView` used for view operations | `ExcalidrawAutomate.ts:3419-3427` |
| `elementsDict` | workbench elements built by `add*` before they are committed to a view | `:850-883` (class fields) |
| `imagesDict` | binary images referenced by workbench image elements | `:850-883` |
| `style` | default style applied to new elements | `:871-882`, `reset()` `:3382-3413` |
| `canvas` | theme/background/grid defaults | `reset()` |
| `elementsDict` lifecycle | `clear()` empties workbench; `reset()` clears + restores style | `:3374-3413` |

The intended flow is: `ea.reset()` → set style → `addRect/addText/addArrow/...` → `await ea.create()` (new file) or `await ea.addElementsToView()` (existing view) (`AutomateHowTo.md:19-27`).

### 5.2 API groups

| Group | Examples (line in `ExcalidrawAutomate.ts`) |
|---|---|
| Workbench element builders | `addRect` :2379, `addDiamond` :2473, `addEllipse` :2503, `addBlob` :2533, `addText` :2624, `addLine` :2765, `addArrow` :2810, `addFrame` :2348, `addStickyNote` :2416, `addEmbeddable` :2250, `addIFrame` :2206, `addImage` :2984, `addLaTex` :3127, `addMermaid` :2932 |
| Composition/labels | `connectObjects` :3203, `addLabelToLine` :3335, `addElementsToFrame` :2327, `addToGroup` :1272 |
| Commit to view/file | `create` :1470, `addElementsToView` :4140, `viewUpdateScene` :4002, `deleteViewElements` :3525, `copyViewElementsToEAforEditing` :3874 |
| Export | `createSVG` :1958, `createPNG` :2020, `createPNGBase64` :2077, `createViewSVG` :1889, `createViewPNG` :1929, `createPDF` :1759, `toClipboard` :1287 |
| View inspection/selection | `getViewElements` :3512, `getViewSelectedElement(s)` :3579/:3589, `selectElementsInView` :5110, `viewZoomToFit` :4109, `getViewLastPointerPosition` :1133 |
| Scene/file utilities | `getSceneFromFile` :1334, `isExcalidrawFile` :3415, `getElements` :1362, `getElement` :1376, `getBoundingBox` :4667, `getMaximumGroups` :4687, `measureText` :4924, `cloneElement` :5145, `generateElementId` :5133 |
| Imported-file handling | `getAttachmentFilepath` :701, `getEmbeddedImagesFiletree` :686, `getPathForImageFileId` :3620, `getColorMapForImageElement` :3629, `resetImageAspectRatio` :4990 |
| Clipboard/compression | `compressToBase64` :723, `decompressFromBase64` :732, `convertStringToDataURL` :615 |
| Sidepanel/scripts/settings | `createSidepanelTab` :973, `persistSidepanelTab` :1065, `getScriptSettings` :4847, `setScriptSettings` :4859, `registerAutostart` :4282, `registerElementActionProvider` :4219 |
| AI | `generateAIText` :530, `analyzeAIImage` :537, `generateAIImage` :544, `transformAIImage` :551, `maskEditAIImage` :558, `createAIChatSession` :565 |
| CLI bridge | `executeCLI` :1179 (delegates to the plugin CLI dispatcher) |
| Hooks/integration | `registerCleanup` :915, `registerViewLinkClickHook` :3983, `registerThisAsViewEA` :4173, `attachInlineLinkSuggester` :1089, `getAPI` :1167 |

### 5.3 How EA commits to a view

`addElementsToView()` (`:4140-4164`) gets the ready target view, takes the workbench elements, and calls `view.addElements({newElements, images, ...})`. `create()` (`:1470-1730`) is the file-creation path: it loads/merges a template, builds frontmatter (`excalidraw-plugin: parsed` by default), concatenates serialized elements, and writes a new drawing file through the vault (the exact serializer is shared with the save path). This is why the CLI `create` command can honestly claim “uses the existing EA serializer” (`docs/CLI.md:59-66`).

`getExcalidrawAPI()` (`:3500-3506`) exposes the raw `ExcalidrawImperativeAPI`, so scripts can bypass EA and call `api.updateScene`, `api.addFiles`, etc. That is the escape hatch that makes EA both powerful and un-sandboxable.

---

## 6. CLI / automation protocol

The plugin ships a first-class agent-facing protocol, not merely an internal script helper.

### 6.1 Transport and registration

- Native registration requires Obsidian API **1.12.2+**, desktop, and the host's `registerCliHandler` method; older hosts simply omit native handlers (`src/core/managers/ExcalidrawCLI.ts:30-38`; docs `docs/CLI.md:3-7`).
- It registers a root `obsidian-excalidraw-plugin` command and one command per action: ``${manifest.id}:${action}`` (`ExcalidrawCLI.ts:33-37`).
- The same dispatcher is available in-process as `await ea.executeCLI(request)` (`src/shared/ExcalidrawAutomate.ts:1179-1186`) and `plugin.executeCLI` (`src/core/main.ts:319`).
- CLI can be invoked as `obsidian vault="..." obsidian-excalidraw-plugin:read path=...` (`docs/CLI.md:15-20`).

### 6.2 Commands

`CLI_COMMANDS` (`src/core/cli/cliCommands.ts:16-30`):

| Command | Purpose | Notes |
|---|---|---|
| `help`, `status`, `schema`, `api` | discovery/readiness | `api` exposes EA docs and the supported Lib subset |
| `list` | list drawings | exact paths, paging |
| `read` | read explicit live/disk drawing | `source=auto|live|disk`; `detail=summary|elements|images`; no base64 bodies |
| `open` | open a ready view | can run configured drawing scripts |
| `create` | create a new drawing | exact path, never overwrite, skeleton batch |
| `apply` | one bounded edit with optimistic revision | `expectedRevision`, operations `add/update/delete/connect/group/ungroup/image/imageMetadata/latex` |
| `export` | render SVG/PNG to explicit path | `overwrite`, theme, scale, padding, image policy, bounds |
| `script` | run a trusted local EA script once | requires `trusted=true`; explicitly “not transactional or sandboxed” |
| `skill` | return offline agent instructions | `format=json|markdown` |
| `result` | look up session receipt | 15-minute receipt window |

### 6.3 Protocol shape and guards

- Result base: `apiVersion:1`, `session`, `command`, `status`, `ok`, `mutation`, `persistence`, `warnings`, optional `data`/`target`/`revision`/`error` (`docs/CLI.md:29-33`; `ExcalidrawCLI.base` at `ExcalidrawCLI.ts:118-120`).
- Input limit 2 MiB; output limit 512 KiB; JSON depth ≤30; finite numbers only; dangerous keys (`__proto__`, `prototype`, `constructor`) rejected (`src/core/cli/cliProtocol.ts:4-5,24-48`).
- Vault paths must be exact, visible, relative; no `..`, `.` segments, leading slash, or reserved characters (`cliProtocol.ts:51-58`).
- Flags and JSON fields may not disagree; `command` must match the native action; input file cannot equal output (`ExcalidrawCLI.ts:88-97`).
- Stable error codes and recovery text (`CLIError`, `cliProtocol.ts:8-15`); receipt replay keyed by request ID for 15 minutes (`cliCommands.ts:14`).
- Writes return a persistence receipt; `mutation: applied` does not imply `persistence: saved` (`docs/CLI.md:92-98`).
- Optimistic concurrency: `apply` requires a fresh `revision` from a live read; stale revisions are rejected; a changed snapshot returns `STALE_REVISION` (`docs/CLI.md:120-130`).

### 6.4 Script engine

`src/shared/Scripts.ts` compiles user scripts with:

```ts
const AsyncFunction = (async () => {}).constructor;
return new AsyncFunction("ea", "utils", script);
```

(`Scripts.ts:195-203`). It strips YAML frontmatter, caches compiled scripts by file/stat, and executes them with an `ea` instance and a `utils` object (`executeScriptFile` `:1023`, `executeScriptFileForCLI` `:1046`, `executeScript`: `:1091`, `executeExecutable` `:1114`). The CLI command calls this with `ea`, `utils.input`, and `utils.excalidrawLib` and requires `trusted=true` (`src/core/cli/cliScripts.ts`; `cliCommands.ts:27`). This is arbitrary same-realm code execution: it is powerful and deliberately not a security boundary. A DSH reimplementation should **not** copy this model; DSH tools are structured and the plugin has no reason to execute arbitrary user code.

The repository also ships a large script library: 183 directory entries in `ea-scripts/` (181 top-level files: 90 `.md`, 87 `.svg`, 2 `.js`, plus indexes/store) and training material under `docs/AITrainingData/`. Those scripts are part of the AGPL repository; they are evidence of the API's real-world usage, not code to port.

---

## 7. Data model and format compatibility

### 7.1 Two on-disk formats

| Format | How it is recognised | Content |
|---|---|---|
| legacy `.excalidraw` | file extension is `excalidraw` | raw JSON scene `{type:"excalidraw", version:2, source, elements, appState, files}`, tab-indented (`ExcalidrawData.loadLegacyData` `:1143-1178`; save `ExcalidrawView.ts:1466-1469`) |
| modern `.excalidraw.md` | Markdown file whose frontmatter has the `excalidraw-plugin` key | frontmatter + prose + `# Excalidraw Data` sections + JSON/compressed JSON drawing block |

Detection: `FileManager.isExcalidrawFile()` returns true for extension `excalidraw`, or when `metadataCache.getFileCache(file).frontmatter[FRONTMATTER_KEYS.plugin.name]` exists, or for a cached drawing path (`src/core/managers/FileManager.ts:97-111`). The plugin registers the `.excalidraw` extension (`src/core/main.ts:445`) and the `excalidraw` view type (`src/constants/constants.ts:459`).

### 7.2 Scene JSON

The serializer emits a fixed six-key object (`ExcalidrawData.generateMDBase`, `src/shared/ExcalidrawData.ts:1716-1728`):

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "<runtime export origin>",
  "elements": [ /* live elements followed by deleted tombstones */ ],
  "appState": { /* persisted subset */ },
  "files": { "<fileId>": { "id", "mimeType", "dataURL", "created", "lastRetrieved" } }
}
```

- `type` is `excalidraw`, `version` 2; the blank-drawing constant uses `version:2` and a release-tag `source` (`src/constants/constants.ts:466-468`).
- In the Markdown path `files` is normally `{}` after `syncFiles()` clears it (`ExcalidrawData.ts:2066`); binaries live in the vault and are referenced from `## Embedded Files`.
- In the legacy `.excalidraw` path `files` may contain base64 data URLs because there is no Markdown envelope to externalize into.
- `source` comes from the runtime's `getExportSource()` (`window.EXCALIDRAW_EXPORT_SOURCE || window.location.origin`, `@zsviczian/excalidraw/dist/obsidian/excalidraw.development.js:2694`); our fixtures set `app://obsidian.md` to emulate the Obsidian host.
- `appState` is a **cleaned subset**. The fork's `serializeAsJSON` calls `cleanAppStateForExport` (`@zsviczian/excalidraw/dist/obsidian/excalidraw.development.js:83737,84011`); our generated fixtures retained only `gridSize` and `viewBackgroundColor`. The plugin separately decides which appState changes are persistence-relevant (`src/view/trackedAppState.ts:4-20`), but the final JSON is whatever the Excalidraw export cleaner keeps. Do not assume every tracked field round-trips.

### 7.3 Markdown envelope (modern format)

The structure constructed by `generateMDBase` + `getMarkdownDrawingSectionAsync` (`ExcalidrawData.ts:1631-1758`; `excalidrawMarkdownParsing.ts:103-129`):

````markdown
---
excalidraw-plugin: parsed
other-frontmatter: values
---
back-of-the-note prose (ordinary Obsidian Markdown)

# Excalidraw Data

## Text Elements
<raw text> ^<textElementId>

## Element Links
<elementId>: [[target]]

## Embedded Files
<fileId>: [[path/to/attachment.png]]

%%
## Drawing
```json            (or ```compressed-json)
<scene JSON>
```
%%
````

Details:

- `# Excalidraw Data` and the `%%`/`## Drawing` markers are a fixed, hand-maintained envelope. `getExcalidrawMarkdownHeader()` has a chain of regex fallbacks for older layouts and lint damage (`excalidrawMarkdownParsing.ts:309-460`), so parsing is intentionally lenient; writing uses the canonical layout above.
- `## Text Elements` lines are `<rawText> ^<elementId>` (`generateMDBase`, `ExcalidrawData.ts:1649-1666`). The element's three text fields are documented in the source comment: `text` = displayed (possibly wrapped/parsed), `originalText` = unwrapped (parsed or markup), `rawText` = original Markdown without wrapping (`ExcalidrawData.ts:1-7`). This is why scripts must update all three when changing text (`docs/AITrainingData/excalidraw-automate/SKILL.md` text-element section).
- `## Element Links` maps element IDs to Obsidian links for text and non-text elements (`generateMDBase`, `:1668-1676`).
- `## Embedded Files` maps a `fileId` to a vault path or an external URL, and equations appear as `fileId: $$latex$$` (`generateMDBase`, `:1678-1712`; parser `:1069-1105`). Markdown-image blocks use their own marker token (`MARKDOWN_IMAGE_EMBEDDED_FILE_TOKEN`, `:1711`). Mermaid is deliberately **not** serialized here; it lives in the image element's `customData` (`generateMDBase` comment at `:1678`). The parser regex is `([\w\d]*):\s*!?\[\[([^\]]*)]]\s*(\{[^}]*})?\n` for files and a separate URL regex for `http(s)/file/ftp`.
- `%%` is Obsidian's comment syntax; the drawing JSON is inside a Markdown comment so it is hidden in reading view.
- Compressed blocks use ` ```compressed-json ` and LZString `compressToBase64`, split into chunks of **256 characters separated by blank lines** (`src/utils/sceneDataUtils.ts:24-33`). Decompression strips all `\n`/`\r` before `decompressFromBase64` (`:39-51`). The regex is `DRAWING_COMPRESSED_REG` (`excalidrawMarkdownParsing.ts:24-27`).
- Uncompressed blocks use ` ```json `; `getJSON()` picks compressed first, then plain, then fallbacks (`excalidrawMarkdownParsing.ts:71-100`).

### 7.4 Element facts that matter for compatibility

| Fact | Value | Evidence |
|---|---|---|
| Element id | 8-character nanoid from a 62-character alphabet (example fixture ids `node-start`, generated bound-text ids like `HFEKn1vr`) | `src/constants/constants.ts:234-237` (`nanoid = customAlphabet(..., 8)`); fixtures |
| File id | 40-char lowercase hex = SHA-1 of file bytes (+ optional key) | `EmbeddedFileLoader.ts:3083-3112`; fixture `6808…` replaced by exported PNG `c7c1…` |
| Text | `text`, `originalText`, `rawText`; bound labels carry `containerId`; containers list bound text in `boundElements` | `ExcalidrawData.ts:1-7`; fixtures `text-and-labels.excalidraw` |
| Arrows | `startBinding`/`endBinding` with `elementId`, `mode`, `fixedPoint`; arrow label is a bound text element with `containerId` = arrow id | `arrows-bindings.excalidraw`; `ExcalidrawData.ts:1-7` (bound text handling in view) |
| Freedraw | `points` are 2-tuples, `pressures` is a parallel number array, `simulatePressure` boolean, optional `customData.strokeOptions` | `freedraw-pressure.excalidraw`; `@zsviczian/excalidraw/types/element/src/types.d.ts` (`ExcalidrawFreeDrawElement`) and the fork's `restoreFreedrawPoints`; source docs for pen options |
| Frames | membership is `element.frameId`; frame element carries `name`; indices are fractional strings | `text-and-labels.excalidraw`; `@zsviczian/excalidraw` element type definitions |
| Tombstones | deleted elements are kept in `deletedElements` and re-appended to `scene.elements` on save | `ExcalidrawData.loadData` `:821-828`; `generateMDBase` `:1721` |
| Layer order | element array order + fractional `index`; sync calls `syncInvalidIndices` | `ExcalidrawView.updateScene` `:8297-8302`; merge insertion at `ExcalidrawView.ts:3884-3900` |
| Tie-break | higher `version` wins; equal version + different JSON → incoming wins | `ExcalidrawView.ts:3870-3882` |

### 7.5 What load does (and does not) preserve

- `loadData` parses the whole incoming scene **before** replacing the current model, so a malformed sync cannot poison a working live view (`ExcalidrawData.ts:747-754`; design doc §21).
- Text-element parsing and element-link parsing can mutate versions: `version++`/`versionNonce++` at `ExcalidrawData.ts:1016-1017` and `:1063-1064`. A read→write round trip is therefore **not guaranteed byte-stable**, and “no diff” cannot be inferred from a version bump alone. The upstream design doc records this as a known evidence point (`docs/Excalidraw Plugin File Persistence Lifecycle Design.md:20-23`).
- `loadData` can prefer a newer sibling `.excalidraw` file over the `.md` when `settings.syncExcalidraw` is enabled (`ExcalidrawData.ts:761-777`) — a Logseq/interop compatibility feature. A DSH plugin need not reproduce this unless interoperability requires it.
- Legacy load sets `compatibilityMode` (`:1153`) and always uses raw text mode (`:1177`). Modern load supports raw vs parsed Markdown text modes (`setTextMode`, `:1184`).

### 7.6 Compatibility matrix

| Dimension | What the upstream code accepts/writes | Compatibility note for DSH |
|---|---|---|
| Scene JSON version | writes `version: 2` (`generateMDBase` `:1719`); loader does not hard-reject other versions | Excalidraw's `restoreElements` normalizes legacy elements; preserve unknown properties when passing elements through |
| Legacy `.excalidraw` | raw tab-indented JSON; always loaded in raw text mode (`loadLegacyData` `:1143-1178`) | optional format for interop; modern `.md` is the primary target |
| Markdown envelope | canonical layout above; `getExcalidrawMarkdownHeader` has a long fallback chain for pre-2.2 layouts and lint damage (`:309-458`) | parse leniently, write canonically |
| `.md` detection | requires the `excalidraw-plugin` frontmatter key (or extension `.excalidraw`) (`FileManager.ts:97-111`) | a Markdown drawing without that key is invisible to the plugin |
| Compression | `json` or `compressed-json`; LZString base64 + 256-char chunks; setting can disable compression for Markdown-side editing (`ExcalidrawView.ts:1444-1448`) | support both on read; choose one on write and document it |
| Text mode | raw vs parsed Markdown text (`TextMode`, `ExcalidrawData.setTextMode` `:1184`) | raw mode is required for lossless round-trip of `[[links]]`; parsed mode is a display convenience |
| Frontmatter | unknown keys are preserved by substring surgery; only known keys are updated (`updateFrontmatterInString`, `sceneDataUtils.ts:100-114`) | preserve unknown frontmatter rather than reserializing YAML wholesale |
| Attachments | inline `files` data URLs in legacy JSON; external `## Embedded Files` links in modern Markdown; SHA-1 fileId | decide whether DSH owns attachment files or references vault paths; never drop the fileId mapping |
| Unknown element properties | fork's `restoreElement` spreads the original element then normalizes known fields (`@zsviczian/excalidraw/dist/obsidian/excalidraw.development.js:84280-84300`) | forward-compatible: keep unknown fields rather than schema-filtering them |

### 7.7 Metadata examples in the corpus

Two generated fixtures exercise metadata that the upstream format preserves:

- `metadata-uncompressed.excalidraw.md`: YAML frontmatter keys `excalidraw-plugin`, `tags`, `excalidraw-export-dark`, `excalidraw-export-transparent`, `excalidraw-export-padding`, `excalidraw-export-pngscale`, `excalidraw-autoexport`, `excalidraw-link-prefix`, `excalidraw-link-brackets`, `excalidraw-default-mode`, `excalidraw-font`, `excalidraw-font-color`; plus back-of-note prose, `## Text Elements`, `## Element Links`, inline `json`.
- `compressed-attachment.excalidraw.md`: `compressed-json`, `## Embedded Files` with `fileId: [[attachments/exported-preview.png]]`, image `customData.excalidrawCLI = {version:1,label,tags}`, element link on a rectangle.
- `freedraw-pressure.excalidraw`: `customData.strokeOptions` (highlighter/outline/constantPressure/smoothing/thinning/streamline/easing/taper), 7 points and 7 pressures, `simulatePressure:false`.

The full lists of frontmatter keys are `FRONTMATTER_KEYS` (`src/constants/constants.ts:313-400`) and the default frontmatter template (`:469-479`).

---

## 8. Dependency map

Direct runtime dependencies (`package.json`; versions below are **registry-resolved at the declared specifier**, not the repo lockfile’s pinned resolution — [evidence 09](evidence/upstream/09-dependencies.txt)):

| Dependency | Spec | Resolved | License | Role |
|---|---|---|---|---|
| `@zsviczian/excalidraw` | 0.18.145 | 0.18.145 | MIT | editor/runtime + serializers + types |
| `react`, `react-dom` | 19.2.8 | 19.2.8 | MIT | UI runtime |
| `lz-string` | ^1.5.0 | 1.5.0 | MIT | compressed-json |
| `pako` | ^2.1.0 | 2.2.0 (lockfile pins 2.1.0) | MIT AND Zlib | inflate embedded runtime |
| `nanoid` | ^5.1.16 | 5.1.16 | MIT | ids |
| `roughjs` | ^4.5.2 | 4.6.6 | MIT | hand-drawn shapes |
| `@zsviczian/colormaster`, `chroma-js` | ^1.2.2 / ^3.1.2 | 1.2.2 / 3.2.0 | MIT / BSD-3+Apache-2.0 | colour handling |
| `monkey-around` | ^2.3.0 | 2.3.0 | ISC | Obsidian monkey patching |
| `@lezer/lr`, `@popperjs/core`, `@radix-ui/number`, `clsx`, `es6-promise-pool`, `gl-matrix`, `path-data-parser`, `points-on-path`, `polybooljs` | — | — | MIT | parsing/geometry/UI helpers |

A lockfile-derived production closure (132 packages, no install) is 123 MIT, 3 Apache-2.0, 2 ISC, 1 MIT+Zlib, 1 0BSD, 1 BSD-3+Apache-2.0 and one package with **no declared license** (`fuzzy@0.1.3`); the closure and the gap are recorded in [evidence 09](evidence/upstream/09-dependencies.txt) and discussed in [`06-license-audit.md`](06-license-audit.md).

`@zsviczian/excalidraw@0.18.145` itself depends on ~30 packages (Jotai, CodeMirror, RoughJS, pica, perfect-freehand, browser-fs-access, …) and peer-depends on React 17/18/19 (`node_modules/@zsviczian/excalidraw/package.json`; evidence 09). Bundling the fork therefore pulls a large transitive tree even though the plugin's own `package.json` looks modest.

Dev/build: Rollup 4, TypeScript 5.9.3, Babel, terser, `uglify-js`, `cssnano`, `obsidian@1.8.7` typings, ESLint 9 + `eslint-plugin-obsidianmd`, Prettier, `@zsviczian/rollup-plugin-postprocess`, `@zsviczian/excalidraw-extras-api^0.1.1` (dev only). TypeScript 5.9.3 and Node ≥22 are required for the build. There is no `packageManager` field and the repo uses `package-lock.json`, despite the team's local use of pnpm.

---

## 9. Classification: what is reusable, adaptable, replaceable, and must-not-migrate

The new plugin is original MIT code; the upstream plugin is AGPL-3.0 (see [`06-license-audit.md`](06-license-audit.md)). “Reuse” below means reuse of **facts, formats, or MIT-licensed dependencies**, never AGPL source.

| Area | Classification | Why |
|---|---|---|
| `.excalidraw` / `.excalidraw.md` format spec, frontmatter keys, section grammar, compressed-json | **Reuse (facts)** | Interoperability requires it; formats/schemas are not the AGPL code. Fixtures + parser parity tests prove compatibility. |
| Generated fixture corpus | **Reuse** | Generated by the MIT runtime/serializer from our own scenes; no upstream drawing assets copied. Manifest records provenance. |
| Excalidraw element model and serializer (`@zsviczian/excalidraw` / upstream `@excalidraw/*`, MIT) | **Reuse as dependency** | MIT allows it with notice. Either bundle the fork's editor or use the upstream package; do not reimplement Excalidraw's rendering engine from scratch unless there is a product reason. |
| EA API *surface* (names, argument shapes, workflow) | **Adapt (reimplement)** | Useful behavioural spec for an agent tool facade; the code is AGPL and must not be ported. API names are facts; implementations must be independent. |
| CLI protocol (commands, `apiVersion`, revision receipts, persistence receipts) | **Adapt (reimplement)** | Excellent design reference for DSH tools: explicit target, optimistic revision, machine-readable outcome. The source is AGPL; reimplement the semantics. |
| Revision-based save coordinator | **Adapt (reimplement)** | The revision/trailing-save model solves real races; implement it fresh in the DSH host/browser split. |
| Version-based incremental merge | **Adapt (reimplement)** | Practical, non-CRDT merge for external edits; reuse the *rule* (higher version wins, incoming wins ties) but write our own merge and tests. |
| Markdown envelope writer/parser | **Adapt (reimplement)** | Must produce byte-compatible envelopes for Obsidian interoperability, but write independent parsing/serialization code and validate against fixtures. |
| Attachment externalization (`## Embedded Files`, SHA-1 fileId) | **Adapt (reimplement)** | Format fact + hashing rule are reusable; file IO must use DSH host APIs, not Obsidian vault APIs. |
| `ExcalidrawView` / `TextFileView` integration | **Replace** | Obsidian-specific: `Plugin.registerView`, `TextFileView`, `WorkspaceLeaf`, `MetadataCache`, `MarkdownRenderer`, `vault.on("modify")` have no direct DSH equivalent. DSH needs its own host/browser document lifecycle. |
| Obsidian UI, CSS, icons, localization | **Replace** | AGPL assets and Obsidian-specific DOM; build a DSH-native page/panel. |
| Embedded-file loader (PDF/Mermaid/LaTeX/Markdown embeds/AI) | **Replace/defer** | Huge Obsidian-coupled subsystem; only reimplement what the DSH product needs, using DSH services. |
| Script engine (`new AsyncFunction`, `window.ExcalidrawAutomate`) | **Replace** | Arbitrary same-realm code execution is the opposite of a structured tool API; DSH tools should be typed and permission-aware. |
| Runtime packaging via DEFLATE + base64 + `win.eval` | **Must-not-migrate** | Security/auditability/reproducibility problem; DSH plugins are normal ES modules. |
| Monkey patching Obsidian internals / Canvas internals (`monkey-around`, `CanvasNodeFactory`) | **Must-not-migrate** | Fragile, host-specific, and not needed in DSH. |
| `ea-scripts/`, `docs/**`, `testloader.js`, `obsidian-excalidraw.zip` | **Must-not-migrate** | AGPL repository content or generated artifacts; no per-file MIT grant. |
| Cross-window migration / popout / Electron teardown hacks | **Must-not-migrate** | Obsidian/Electron-specific; DSH has its own window/browser model. |

Two “reuse” decisions need explicit sign-off:

1. **Bundling the fork vs using upstream Excalidraw.** The fork is MIT but ships a 6.5 MB Obsidian-specific eval bundle and a modified editor; upstream `@excalidraw/excalidraw@0.18.0` is MIT and more standard, but lacks the fork's Obsidian host hooks and 0.18.145 changes. Start with upstream Excalidraw if the DSH integration can live outside the editor; consider the fork only if a required behaviour is fork-only. Either way, MIT notice required.
2. **Obsidian-format interoperability.** If the DSH plugin must open files created by the Obsidian plugin, replicate the envelope and merge semantics and run the fixture corpus as a compatibility suite. If it only needs its own format, the envelope can be simplified — but then it is not “drop-in compatible”, and the docs must say so.

---

## 10. Mapping onto the DSH plugin (context, not design)

The target DSH is **0.2.1-rc.2** while the public clone is 0.2.1-rc.3; the platform contract is documented separately in [`02-dsh-platform.md`](02-dsh-platform.md). Only the implications for porting are listed here:

| Upstream concept | DSH replacement | Consequence |
|---|---|---|
| Obsidian `Plugin` + `registerView` + `TextFileView` | Cordis plugin + host/browser halves; explicit file APIs | no free `setViewData`/`getViewData`/`save` bridge; we own read/write, debounce, atomicity, reload |
| Vault `modify` event + `MetadataCache` | host file watch/service or explicit save results | own-write suppression and external-change detection must be designed, not inherited |
| `WorkspaceLeaf`, `MarkdownView`, popouts, Canvas internals | DSH pages/panels/slots | no window migration code; simpler lifecycle |
| `ExcalidrawView` monolithic lifecycle | host scene model + browser editor state | split persistence (host) from rendering (browser); messages are data-only |
| `window.ExcalidrawAutomate` + `new AsyncFunction` script engine | typed DSH tools; no arbitrary eval | agent operations must be schema-validated, with explicit persistence receipts |
| Obsidian CLI `registerCliHandler` | DSH tools (and possibly host CLI) | reuse the *semantics* (exact path, revision, receipts), not the transport code |
| `@zsviczian/excalidraw` embedded via eval | normal bundle/import of MIT Excalidraw, or a browser-side runtime | avoid eval; check DSH web-shell DOM/CSS compatibility |
| Frontmatter/Markdown file as source of truth | host-owned file model with same envelope | must decide whether DSH writes Obsidian-compatible `.excalidraw.md` |

The strongest upstream lessons for DSH are behavioural, not structural:

1. **Words/state own timing**: the dirty revision must advance on durable element changes, and app-state persistence is a separate, narrower class.
2. **Saves are not reloads**: a successful write must not cause a naive reload; classify your own write, then decide whether external content is genuinely newer.
3. **Prepare before a synchronous save**: if the host save API is synchronous, serialize asynchronously beforehand and keep an immutable prepared snapshot.
4. **Explain persistence outcomes**: the CLI's `mutation` vs `persistence` distinction is the right model for an agent-facing tool.
5. **Do not claim CRDT semantics**: the upstream merge is version-based and can lose competing edits by design; DSH should either match that contract explicitly or do better, and say which.

---

## 11. Surprising or contradictory findings

1. **AGPL `LICENSE` vs MIT `package.json`.** The headline legal finding. See [`06-license-audit.md`](06-license-audit.md). Do not treat the plugin as MIT.
2. **Three versions for one commit.** `package.json`/lock 2.2.5, manifest 2.29.0, shipped zip 2.27.3; the bundle injects 2.29.0. The brief's “2.2.5” is only one of them.
3. **The plugin evaluates a compressed Excalidraw runtime with `win.eval`.** The production `main.js` is not a normal bundle of the editor; it ships the fork's prebuilt bundle as a deflate+base64 string (`rollup.config.mjs:17-21,92,221-226`). This is a reproducibility and security smell, and it is why the source imports `@zsviczian/excalidraw` as external while the code actually comes from the eval'd payload.
4. **`esbuild.config.json` is dead.** It exists (`{"minify":true}`) but nothing references it; the build is Rollup. The task brief's “rollup/esbuild” is only half true: Rollup is the build; esbuild config is vestigial.
5. **The npm `main` is not the plugin.** `package.json` main/types point to the `lib` automation library; the Obsidian plugin is `dist/main.js`. Importing the package expecting a plugin is a trap.
6. **The fork's npm artifact has no LICENSE file and its README is upstream's.** Its repository LICENSE is the upstream MIT text and package metadata says MIT, but the published `files` array excludes the license. Attribution is on the consumer.
7. **The repository has zero `.excalidraw` fixtures.** Search of the pinned tree found none; `test-data/` contains PDFs and screenshots, not drawings. The fixture corpus had to be generated, and its manifest says so.
8. **A version bump on load.** `ExcalidrawData.loadData` increments `version`/`versionNonce` while parsing text links (`:1016-1017`, `:1063-1064`), so read→write round trips are not byte-stable. The upstream design doc admits this and warns against treating a version bump as a new user edit.
9. **The persistence design doc is a roadmap, not a proof.** It records a failed 5b experiment, residual divergence between views, and open questions (`docs/Excalidraw Plugin File Persistence Lifecycle Design.md:1-72`). The save coordinator code looks mature, but the doc's own “acceptance” section says runtime convergence was still being validated. Our evidence is source-level; we did not reproduce multi-view convergence.
10. **The CLI is an agent protocol, not a side feature.** It has API versioning, receipts, optimistic revisions, persistence outcomes, stable error codes, and a portable “skill” document. This is more mature than most plugin automation surfaces and is the most directly reusable *design* in the repo.
11. **The partial clone blocks history verification.** `git rev-list --all --objects` and history searches hit missing promisor objects; we stopped network fetches. The commit hash and working tree are verified; historical claims (e.g. when the MIT field appeared) are not.
12. **AppState round-tripping is narrower than it looks.** The plugin tracks a rich app-state list (`trackedAppState.ts`), but the Excalidraw serializer's export cleaner kept only `gridSize` and `viewBackgroundColor` in our fixtures. Do not assume every tracked field is persisted.

---

## 12. Evidence index

| File | Contents |
|---|---|
| [`evidence/upstream/01-commit-and-version.txt`](evidence/upstream/01-commit-and-version.txt) | git identity, package/manifest versions, license header, tracked blob hashes |
| [`evidence/upstream/03-build-pipeline.txt`](evidence/upstream/03-build-pipeline.txt) | package scripts, tsconfig, rollup externals/outputs, eval payload lines, dead esbuild config |
| [`evidence/upstream/04-module-map.txt`](evidence/upstream/04-module-map.txt) | per-directory counts, largest files, entry/class declarations, manager inventory |
| [`evidence/upstream/05-call-path.txt`](evidence/upstream/05-call-path.txt) | pointer/onChange/onIncrement wiring, dirty/save/serialization, modify routing, merge/reload, dependency prop types |
| [`evidence/upstream/06-excalidraw-automate-api.txt`](evidence/upstream/06-excalidraw-automate-api.txt) | 157 public members with line numbers, type surface, global install |
| [`evidence/upstream/07-cli-and-scripts.txt`](evidence/upstream/07-cli-and-scripts.txt) | command registry, protocol guards, native registration, script engine, ea-scripts inventory |
| [`evidence/upstream/08-data-format.txt`](evidence/upstream/08-data-format.txt) | text fields, scene JSON, drawing fences, compression, frontmatter, embedded files, fileId, tombstones, compatibility mode |
| [`evidence/upstream/09-dependencies.txt`](evidence/upstream/09-dependencies.txt) | runtime/dev dependency specs, resolved licenses, import hotspots |
| [`evidence/upstream/10-license-evidence.txt`](evidence/upstream/10-license-evidence.txt) | LICENSE/package/manifest evidence, fork metadata, dependency license table, external MIT texts |
| [`evidence/upstream/11-fixtures.txt`](evidence/upstream/11-fixtures.txt) | absence proof, hashes, per-file summaries, decompression/restore validation, generator provenance |
| [`fixtures/upstream/manifest.json`](../fixtures/upstream/manifest.json) | machine-readable fixture manifest (path, SHA-1, commit, generation method, categories) |
| [`fixtures/upstream/tools/generate-fixtures.html`](../fixtures/upstream/tools/generate-fixtures.html) | reproducible generator (MIT runtime) |
| [`evidence/upstream/tools/summarize-fixtures.py`](evidence/upstream/tools/summarize-fixtures.py) | read-only corpus summariser used to produce evidence 11 |
| [`evidence/upstream/tools/parse-fixtures.mjs`](evidence/upstream/tools/parse-fixtures.mjs) | parser-parity check: the fixture corpus parses under the upstream drawing regex grammar and LZString 1.5.0 |

All line numbers refer to `upstream/obsidian-excalidraw-plugin/<path>` at the pinned commit unless the path starts with `.cache/` or is an installed package path.
