# 04 — Render spike: embedding the genuine Excalidraw component in a DSH client plugin

**Task:** task-3 — decide, empirically, whether the DSH Excalidraw plugin should
embed the real `@excalidraw/excalidraw` React component or fall back to a custom
lightweight canvas editor.

**Verdict: EMBED the genuine component.** It bundles, mounts, draws, exports and
survives the DSH `window.__ModuleLoader__` contract — including on the **React
18.3.1** that the live DSH shell actually seeds. The measured costs are bundle
size (mitigable by chunking) and one small host-side route for `.woff2` fonts.
No blocking incompatibility was found.

| Question | Answer |
| --- | --- |
| Bundles with esbuild into one self-contained classic script? | **Yes** — 8.01 MiB raw / 2.39 MiB gzip with React external; React is not embedded |
| Mounts and paints in real Chrome? | **Yes** — 19/19 standalone assertions, 28/28 DSH-contract assertions |
| Real mouse/keyboard drawing + scene read-back? | **Yes** — rectangle, arrow and text created via input events; scene JSON read through the API |
| Imperative API works? | **Yes** — `updateScene`, `getSceneElements`, `getAppState`; exports are package-level (`exportToSvg`/`exportToBlob`), not on the instance |
| `convertToExcalidrawElements` bindings? | **Yes** — arrow `start`/`end` bindings become real `startBinding`/`endBinding` + `boundElements` |
| Works through the DSH loader wrapper with page-supplied React? | **Yes** — require(`react`) resolves from the module table; component reports React 18.3.1 |
| CSP / worker / font / ResizeObserver blockers? | **None** on the real DSH page (no CSP). Strict-CSP behaviour and the hardcoded esm.sh fallback are documented below |
| Trailing risk | Bundle size + font route; chunked build recommended |

Evidence: [`docs/evidence/render/`](evidence/render/) — screenshots, assertion
JSON, network/console logs, canonical element JSON, bundle size report.

---

## 1. Method

The spike is deliberately outside `src/` and does not install anything into the
live DSH profile. Everything lives under
[`spikes/render/`](../spikes/render/):

```
spikes/render/
  package.json                    React 19.2.0 (standalone), React 18.3.1 (DSH harness alias),
                                  @excalidraw/excalidraw 0.18.1, playwright-core 1.56.0, esbuild 0.28.1
  src/standalone.js               React 19 page: Excalidraw mount + CSS/font injection + lib surface
  src/dsh-entry.js                DSH plugin module (inject/apply) + tagged <style> injection
  src/module-table.js             emulates packages/client/web/src/seed.ts with React 18.3.1
  public/standalone.html          standalone page
  public/dsh.html (+ -lean)       DSH __ModuleLoader__ harness pages
  public/static/harness.js        emulated loader facade: queue -> live, require table, style claiming
  public/static/dsh-mount.js      minimal slots renderer: materialize -> apply(ctx) -> mount component
  scripts/build.mjs               esbuild builds + size report + font/lazy asset copies
  scripts/server.mjs              static server; /dsh is faithful (no CSP), /dsh-csp adds a strict CSP
  scripts/ui-smoke.mjs            Playwright: mount, real drawing, scene read-back, API, exports, slot resize
  scripts/dsh-loader-smoke.mjs    Playwright: DSH wrapper format, external React 18.3.1, CSP pass, lean pass
  scripts/canonical-elements.mjs  convertToExcalidrawElements + serializeAsJSON evidence (Lead request)
  public/assets/fonts/            copied Excalidraw woff2 assets
  public/lazy/                    Excalidraw dist chunks for the lean bundle
  public/build/                   standalone.js, module-table.js
  dsh-bundle/                     spike copy of the DSH package: package.json + client.js + lib/index.js + build.mjs
  dist/size-report.json           all numbers quoted below
  artifacts/                      screenshots, scene JSON, network/console logs, exports
```

Exact environment: **Node 24.15.0**, **pnpm 11.7.0**, **esbuild 0.28.1**,
**@excalidraw/excalidraw 0.18.1** (npm integrity
`sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==`),
**React 19.2.0** for the standalone page, **React 18.3.1** for the DSH harness
(the live shell version), **Google Chrome 156.0.8078.48** headless via
**playwright-core 1.56.0** with `executablePath` (no Playwright browser download).

Reproduce:

```bash
cd spikes/render
pnpm install --ignore-workspace --store-dir /Volumes/ZHITAI/DSHExcalidraw/.cache/pnpm-store
node scripts/build.mjs
node scripts/ui-smoke.mjs
node scripts/dsh-loader-smoke.mjs
node scripts/canonical-elements.mjs
# manual inspection: node scripts/server.mjs  (then / and /dsh)
```

---

## 2. Can esbuild bundle it? Yes — sizes and asset inventory

The package ships a pre-split production build (`dist/prod/`: `index.js` +
6 chunks + `locales/` + `fonts/` + `data/`). esbuild resolves the whole graph;
`react`, `react-dom`, `react/jsx-runtime` are marked external for the DSH build,
and `@excalidraw/excalidraw/index.css` is loaded with the esbuild `text` loader
so the plugin can inject it as a tagged `<style>`.

### 2.1 Measured bundles (`dist/size-report.json`)

| Artifact | What it is | raw | gzip | brotli |
| --- | --- | --- | --- | --- |
| `dsh-bundle/client.js` | **DSH loader format**, React external, all Excalidraw lazy imports inlined | **8,395,789 B (8.01 MiB)** | **2,507,785 B (2.39 MiB)** | 1,933,834 B (1.84 MiB) |
| `public/build/standalone.js` | self-contained IIFE incl. React 19 (evidence page) | 8,586,560 B (8.19 MiB) | 2,568,692 B (2.45 MiB) | 1,986,477 B (1.89 MiB) |
| `public/build/dsh-client-lean.js` | DSH format, lazy locale/export chunks external (`/lazy/`), mermaid still inlined | 4,897,476 B (4.67 MiB) | 1,403,540 B (1.34 MiB) | 1,054,701 B (1.01 MiB) |
| split-ESM probe `entry.js` | **initial** entry when Excalidraw's dynamic imports are split into chunks | **729,885 B (0.70 MiB)** | **207,629 B (0.20 MiB)** | 168,909 B (0.16 MiB) |
| split-ESM probe chunks | 54 lazy chunks | 8,321,212 B total (incl. entry) | — | — |
| `public/build/module-table.js` | React 18.3.1 module table emulation (not shipped in a plugin) | 142,027 B | 45,640 B | 39,931 B |

Top single-file contributors (esbuild metafile, by output bytes): the font-subset
/ export chunk `chunk-EIO257PC.js` 1.78 MB, mermaid parser 0.66 MB, Excalidraw
`index.js` 0.49 MB, cytoscape 0.44 MB, Excalidraw `chunk-K2UTITRG.js` 0.44 MB,
KaTeX 0.27 MB, mermaid core 0.20 MB, React DOM client 0.17 MB (in the standalone
build only), CSS 0.14 MB, plus 55 locales.

### 2.2 Runtime asset inventory shipped by the package

| Asset group | Files | Bytes | Notes |
| --- | --- | --- | --- |
| `dist/prod/fonts/` | **234 woff2** | **13,107,068 B (12.50 MiB)** | Xiaolai (CJK) alone is 12,371 KiB across ~180 unicode-range subsets; all Latin families together are **0.42 MiB** (Assistant 79, Liberation 69, Cascadia 64, Excalifont 63, Nunito 56, Virgil 55, ComicShanns 31, Lilita 12 KiB) |
| `dist/prod/locales/` | 55 | 1,648,766 B | dynamically imported; all inlined in the single-file build |
| `dist/prod/index.css` | 1 | 144,689 B | injected style after font-URL rewrite: 144,921 B, 1050 rules |
| JS | `index.js` 502,077 B + 8 chunks | **2,290,046 B** chunks | `chunk-EIO257PC.js` 1,824,966; `chunk-K2UTITRG.js` 439,257; `chunk-6U3AYISY.js` 22,458; subset/worker + small chunks 2,815 |
| `dist/prod/data/` | 1 | — | logo image module |

**Implication:** the genuine component is a *large* renderer. The initial cost
is controllable: the split probe shows a **0.70 MiB / 0.20 MiB gzip initial
entry** with 54 on-demand chunks, versus 8.0 MiB if everything is inlined. The
single-file build is the simplest proof and the worst case, not the recommended
productions shape.

### 2.3 React version reality check

The task brief said "use React 19"; the **live DSH shell seeds React 18.3.1**
(`upstream/deepseek-harness/packages/client/web/src/seed.ts`, lockfile
`react@18.3.1`). Both were exercised:

* standalone page: React **19.2.0**, Excalidraw mounts and all drawing/API checks pass;
* DSH harness: module table supplies React **18.3.1**; the bundle's
  `require('react')` returns that instance and the mounted component reports
  `data-react-version="18.3.1"`.

Excalidraw 0.18.1's peer range is `^17.0.2 || ^18.2.0 || ^19.0.0`, so the
embedding is compatible with the current shell and with a future React 19 shell.

---

## 3. Does it mount and can you actually draw? Yes

Standalone run — **19/19 assertions**, real Chrome, real mouse/keyboard:

1. `/` loads a self-contained page, Excalidraw root is 1280×800, canvas has size, CSS injected (screenshot `01`).
2. `r` + mouse drag (260,220)→(540,380) creates a **rectangle**; scene read-back shows `type:"rectangle"` (`02`).
3. `a` + drag creates an **arrow** (`03`).
4. `t` + click + keyboard text + Escape creates a **text** element (`04`).
5. `convertToExcalidrawElements` + `api.updateScene({elements})` replaces the scene with rectangle + ellipse + text (`05`).
6. `exportToSvg` returns 7,411-byte SVG (`exports/scene.svg`); `exportToBlob` returns a valid PNG (10,637 B, magic `89504e470d0a1a0a`, `exports/scene.png`).
7. Fonts: `document.fonts` loaded families are exactly `Assistant`, `Excalifont`; **all woff2 fetches hit the local origin**, zero external requests, zero CSP violations.
8. A constrained slot (720×480) is filled exactly; resizing the container to 520×360 is followed within 2 px (ResizeObserver works) (`06`, `07`).

Screenshots: [`04-standalone-text.png`](evidence/render/screenshots/04-standalone-text.png)
(the genuine toolbar, properties panel, hand-drawn Excalifont text),
[`05-standalone-updateScene.png`](evidence/render/screenshots/05-standalone-updateScene.png),
[`06-slot-720x480.png`](evidence/render/screenshots/06-slot-720x480.png),
[`07-slot-resized-520x360.png`](evidence/render/screenshots/07-slot-resized-520x360.png).

Scene JSON from real input: [`scene-after-drawing.json`](evidence/render/json/scene-after-drawing.json)
(rectangle, arrow with `points`, text with `containerId`, full element
properties); after imperative update: [`scene-after-updateScene.json`](evidence/render/json/scene-after-updateScene.json).

### Headless-only gotchas (not product bugs)

* Headless Chrome delivers keyboard events to the **focused** document; the
  smoke scripts click the canvas once before pressing tool shortcuts. A real
  user focus click does the same.
* Excalidraw's welcome overlay is rendered on an empty scene and does not block
  the canvas, but hiding it (`initialData.appState.showWelcomeScreen: false`)
  keeps the first screenshot clean.
* Empty-scene text measurement is async: assert after `document.fonts.ready`.

---

## 4. DSH loader contract verification

The bundle is a **classic script** registering a closure factory:

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-excalidraw',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    /* esbuild CJS body: require("react") etc. are page module-table lookups */
    return module.exports;
  },
});
```

Harness `scripts/dsh-loader-smoke.mjs` emulates
`packages/client/modules/src/client/system.ts` + `client/web/src/seed.ts`:
queue → `materialize()` → live, `require` restricted to the seed table, style
claiming of untagged `<style>` elements, a minimal `slots` service, and the
mount of the registered slot component.

**28/28 assertions pass.** Key evidence
([`dsh-loader-results.json`](evidence/render/json/dsh-loader-results.json)):

| Check | Result |
| --- | --- |
| bundle loads as classic script, no top-level `import`/`export` | pass |
| React is **not embedded** (no `react.production.min`, no React internals) | pass |
| factory `require` calls are only module-table words | `react`, `react/jsx-runtime`, `react-dom` |
| page-supplied React version | `18.3.1` |
| component sees the page React (`data-react-version` on the surface) | `18.3.1` |
| plugin module exports `inject` + `apply`; slot registered | `{ name: 'conversation.composer.dock', id: 'excalidraw-canvas', order: 5 }` |
| CSS injected as `<style data-plugin data-plugin-css>` | 1050 rules, 144,921 B, font URLs absolute local |
| `window.EXCALIDRAW_ASSET_PATH` | `http://…/plugins/@local/dsh-excalidraw/assets/` |
| real drawing through the loader bundle | rectangle + text, Excalifont loaded locally |
| page errors / CSP violations / external requests (faithful DSH page) | 0 / 0 / 0 |

Screenshot of the real component running through the loader harness:
[`08-dsh-loader-mounted.png`](evidence/render/screenshots/08-dsh-loader-mounted.png).

**Bundle design notes that matter for the real plugin**

* React (and `react-dom`, `react/jsx-runtime`) must stay external; the shell
  owns the React instance. The built client.js contains
  `require("react")`/`require("react-dom")`/`require("react/jsx-runtime")`
  and no React runtime.
* Inject the stylesheet **during factory execution** and tag it
  (`data-plugin`, `data-plugin-css`) exactly like the DSH tsdown preset's
  `styleInjectionModule`; the loader claims untagged styles too, but tagging is
  what the preset emits and what HMR bookkeeping expects.
* `dsh-bundle/package.json` shows the required package shape:
  `exports["./client"]`, `dsh.client { platform: "web", inject: [] }`,
  plus `exports["./assets/*"]` if images are added.

---

## 5. Imperative API: what works, what is where

| Capability | Location | Result |
| --- | --- | --- |
| `getSceneElements`, `getAppState`, `getFiles`, `updateScene`, `setActiveTool`, `scrollToContent`, `refresh` | **instance** API (`excalidrawAPI` prop) | all functions; `updateScene({ elements, captureUpdate: 'IMMEDIATELY' })` replaced the scene and read back exactly |
| `exportToSvg`, `exportToBlob`, `exportToCanvas` | **package-level exports**, not on the instance | work on the current scene; used with `api.getSceneElements()/getAppState()/getFiles()` |
| `serializeAsJSON(elements, appState, files, 'local')` | package export | produced a 3,719-byte document with `type`, `version`, `source`, `elements`, `appState`, `files` |
| `convertToExcalidrawElements(skeletons, opts)` | package export | created all 7 requested skeleton types; see §6 |
| `restore(document, null, null)` | package export | round-tripped the serialized binding scene back into the live editor and rendered it |

**Export path detail:** `exportToSvg`/`exportToBlob` embed the scene fonts (the
package ships a font-subset worker + shared chunk, `subset-worker.chunk.js` /
`subset-shared.chunk.js`). In the single-file build those dynamic imports are
inlined, so the worker URL resolves to the main bundle; the library's own guard
detects this and falls back to main-thread subsetting. Export still succeeds
(SVG 7.4 KB, PNG 10.6 KB in the evidence), with no console errors.

### Canonical element-factory evidence (Lead request)

[`canonical-elements.json`](evidence/render/json/canonical-elements.json) —
`convertToExcalidrawElements` called in the same headless Chrome page, for the
exact 7 skeletons requested:
rectangle, ellipse, diamond, arrow, line, text, freedraw. All 7 convert; the
full element JSON is in `combinedElements` (package
`@excalidraw/excalidraw@0.18.1`, integrity in the JSON).

Observations recorded in [`conversion-notes.json`](evidence/render/json/conversion-notes.json):

* **Bindings are expressible in skeleton form.** Passing `start: { id }` /
  `end: { id }` with `{ regenerateIds: false }` yields
  `startBinding: { elementId, focus, gap }`, `endBinding: …` and reciprocal
  `boundElements` on both rectangles, and the transform recomputes
  `points` to span the bound shapes (`[[0.5,0.5],[359.5,179.5]]`).
  IDs are only preserved with `regenerateIds: false`.
* The transform **recomputes text size** from the text content and font
  (`width: 120` requested → `47` actual for "Hello"; height 25).
* Freedraw points/pressures are preserved as given.
* A degenerate explicit `points: [[0,0],[0,0]]` wins over binding-derived
  geometry (the arrow stays zero-length); omit `points` for bound arrows or
  pass the intended span.

[`serialize-asjson.json`](evidence/render/json/serialize-asjson.json) is the
**exact** `serializeAsJSON` output for two rectangles + an arrow bound at both
ends + a text element (two bindable shapes are required to bind both ends);
[`serialize-asjson.parsed.json`](evidence/render/json/serialize-asjson.parsed.json)
is the pretty parsed copy, and
[`12-binding-scene.png`](evidence/render/screenshots/12-binding-scene.png)
shows that exact document after `restore` — the arrow renders connected and the
text renders in Excalifont.

---

## 6. CSS and font asset strategy for DSH

### 6.1 CSS

Ship `@excalidraw/excalidraw/index.css` compiled as text and inject one
`<style>` tag during factory execution:

```js
const tag = document.createElement('style')
tag.dataset.plugin = PLUGIN_ID
tag.dataset.pluginCss = `${PLUGIN_ID}/excalidraw.css`
tag.textContent = css.replaceAll('url("./fonts/', `url("${assetBase}fonts/`)
document.head.appendChild(tag)
```

The rewrite is mandatory: the stylesheet's 4 `@font-face` URLs are relative
(`./fonts/Assistant/…`), and an injected `<style>` resolves relative URLs
against the **document URL**, not the package. Absolute asset URLs (below)
make it work under `/`, `/session/…`, or any mount path.

### 6.2 Fonts — `EXCALIDRAW_ASSET_PATH` + a host route

Upstream's own README documents the contract: copy
`dist/prod/fonts` to a served path and set
`window.EXCALIDRAW_ASSET_PATH` to it. The value must be **absolute** because
the library does `new URL(fontPath, base)`; the plugin computes:

```js
window.EXCALIDRAW_ASSET_PATH = new URL('plugins/@local/dsh-excalidraw/assets/', document.baseURI).href
```

**Important DSH constraint:** the standard package-asset route
`plugins/<pkg>/assets/<path>` serves **only images**. In
`packages/client/modules/src/assets.ts`, `PACKAGE_ASSET_MEDIA_TYPES` is exactly
`svg/png/webp/jpg/jpeg`; any other extension answers **404**, and the route only
exposes `exports["./assets/*"] -> lib/assets/*`. `woff2` cannot ride it.

Two concrete options:

1. **Host route (recommended).** The plugin's Node half registers a prefix route
   on `ctx.webServer` for the package's asset namespace and serves the tree with
   `content-type: font/woff2` (named web-server routes are resolved before the
   client-modules `/plugins` fallback, so this shadows the built-in asset route
   for this package only). The spike ships this as
   [`dsh-bundle/lib/index.js`](../spikes/render/dsh-bundle/lib/index.js):

   ```js
   export const inject = ['webServer']
   export function apply(ctx) {
     ctx.effect(() => ctx.webServer.register({
       kind: 'prefix',
       path: '/plugins/@local/dsh-excalidraw/assets',
       resource: serveAsset, // GET/HEAD, font/woff2 + image MIME, immutable cache, traversal guard
     }))
   }
   ```

   Ship the Excalidraw font tree as `lib/assets/fonts/`; the client half already
   computes `EXCALIDRAW_ASSET_PATH` as
   `new URL('plugins/@local/dsh-excalidraw/assets/', document.baseURI).href`.
   Because the route takes over the package's `/assets/` namespace, any images
   the plugin ships must live under the same tree (the handler serves images
   too). This is the only route that works for all 234 `.woff2` files.

2. **Trim + inline.** If CJK is not required, only the Latin families are
   needed (**0.42 MiB** of the 12.50 MiB). They can be inlined as `data:` URLs
   (base64 ≈ 0.56 MiB) into the injected CSS / font map, removing the host route
   entirely. Not viable with Xiaolai included.

Notes:

* Copy the whole `fonts/` tree for option 1; the CJK family is split into
  unicode-range subsets, so the browser downloads only the subsets the scene
  uses (the files are not all fetched up front).
* Font licenses are separate from the package's MIT code; the npm tarball ships
  no license files. See [`06-license-audit.md`](06-license-audit.md) for the
  notice obligation (`Copyright (c) 2020 Excalidraw`, MIT text) and the
  unresolved `fuzzy@0.1.3` notice gap in Excalidraw's transitive deps. Ship a
  generated `THIRD_PARTY_NOTICES.md`.

### 6.3 The hardcoded esm.sh fallback (and strict CSP)

Excalidraw 0.18.1 appends a fixed fallback base next to every font URL:
`https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/`
(`ASSETS_FALLBACK_URL` in the bundle). It is a **fallback only** — the local
`EXCALIDRAW_ASSET_PATH` URL is first in each `FontFace` src list.

Measured behaviour:

* **Faithful DSH page (no CSP — the real situation):** zero external requests in
  the entire run; local fonts only. The app page carries no CSP
  (`apps/*` only sets CSP for the sandboxed document preview and the login
  placeholder).
* **Strict-CSP stress (`font-src 'self'`):** the component still mounts, draws,
  and loads/render `Assistant` + `Excalifont` locally, but Chromium reports
  **230 blocked fallback attempts** for font faces it probes; **zero external
  responses** complete, so no bytes leave the machine. Evidence:
  [`dsh-strict-csp.json`](evidence/render/json/dsh-strict-csp.json),
  [`11-dsh-strict-csp.png`](evidence/render/screenshots/11-dsh-strict-csp.png).

If DSH ever adds a CSP, patch the fallback out at build time (or relax
`font-src` to include `https://esm.sh` — not recommended). With no CSP today,
the shipped bundle behaves exactly like the standalone page: no runtime CDN.

---

## 7. Chunking and the recommended production shape

The single-file bundle works, but it parses 8 MiB of JS up front and inlines
features most scenes never use (Mermaid/Katex/Cytoscape for the Mermaid dialog,
55 locales, the export/font-subset chunk).

The split-ESM probe (same entry, `splitting: true`) measures what chunking buys:

* initial entry: **729,885 B raw / 207,629 B gzip**;
* 54 lazy chunks, total 8,321,212 B; largest lazy chunks are the export/subset
  chunk (1.82 MB), mermaid (0.67 MB + support), cytoscape (0.53 MB), KaTeX
  (0.27 MB), plus per-locale files.

**Recommendation:** build the real plugin with the repository's
`clientBundle()` tsdown preset (Rolldown) rather than hand-rolled esbuild.
The preset is designed for exactly this shape: package-local dynamic imports
become chunks registered through the loader's `require.async`
(`window.__ModuleLoader__.load({ id, chunk, factory })`), CSS is injected and
tagged at factory execution, and asset imports are content-revisioned. The
spike proves the runtime and the sizes; the preset is the supported way to get
chunked output inside DSH. Its locale/lazy chunks still need a host route for
`.js` (same Node-half pattern as fonts, MIME `text/javascript`) because the
standard asset route is images-only.

The lean variant in this spike is the intermediate proof: lazy chunks left
external and rewritten to a host route cut the bundle from 8.01 → **4.67 MiB**
(2.39 → 1.34 MiB gzip), and the harness verified the default locale loads from
`/lazy/locales/en-B4ZKOASM.js` with status 200 before the editor becomes usable
([`10-dsh-lean-mounted.png`](evidence/render/screenshots/10-dsh-lean-mounted.png),
[`dsh-lean-network.json`](evidence/render/json/dsh-lean-network.json)).

---

## 8. Risks, ranked

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| 1 | 8 MiB single-file bundle / parse cost | Medium | Use tsdown chunked output (measured 0.70 MiB / 0.20 MiB gzip initial); trim Mermaid/locales lazily; lazy-mount the editor only when the panel opens |
| 2 | `.woff2` cannot use the package asset route | Low | Node-half prefix route (spike ships `dsh-bundle/lib/index.js`), or Latin-only data-URL fonts |
| 3 | Hardcoded esm.sh font fallback | Low | Never fetched on the real (no-CSP) page; patch out at build time if CSP is ever added |
| 4 | React version coupling | Low | Bundle keeps React external; verified with shell React 18.3.1 and React 19.2.0; peer range covers 17/18/19 |
| 5 | CSS injection requires inline styles | Low today | DSH sets no CSP on app pages; if `style-src` ever becomes strict, the tagged `<style>` needs `'unsafe-inline'`/nonce or a served CSS file |
| 6 | Font-subset worker is inlined in single-file build | Low | Library falls back to main-thread subsetting; export works. Chunked build restores the worker |
| 7 | Slot sizing/UI density | Low | Excalidraw fills its container and follows resize; for narrow panels set `UIOptions`/zen mode and give it ≥ ~640×480 |
| 8 | License notices | Low but mandatory | MIT notice + `Copyright (c) 2020 Excalidraw` in `THIRD_PARTY_NOTICES.md`; see `06-license-audit.md` |
| 9 | Welcome overlay / focus in headless tests | Test-only | hidden via `showWelcomeScreen: false`; click to focus before keyboard shortcuts in Playwright |

No blocker required falling back to a custom editor. A custom editor would only
be justified if the bundle budget were hard-capped around a few hundred KiB
*including* all editor features, or if the plugin needed a rendering model that
deliberately diverges from Excalidraw's scene format — neither is a current
requirement.

---

## 9. Verdict

**EMBED `@excalidraw/excalidraw@0.18.1`.**

* It satisfies the DSH client-loader contract (external React from the module
  table, classic-script closure factory, tagged style injection, slot
  registration) on the shell's actual React 18.3.1 and on React 19.
* It is genuinely interactive: real mouse/keyboard input produces real scene
  elements, which can be read back, mutated, serialized and exported.
* The real format is preserved end to end: `convertToExcalidrawElements`
  (including arrow bindings), `serializeAsJSON`, `restore`, SVG/PNG export.
* The only meaningful work items are packaging: a chunked production build and a
  small host route for woff2 fonts. Both are specified above with working
  prototypes.

---

## 10. Evidence index

| File | Contents |
| --- | --- |
| [`screenshots/01-standalone-mounted.png`](evidence/render/screenshots/01-standalone-mounted.png) | React 19 standalone mount |
| [`screenshots/02-standalone-rectangle.png`](evidence/render/screenshots/02-standalone-rectangle.png) | rectangle drawn by mouse |
| [`screenshots/03-standalone-arrow.png`](evidence/render/screenshots/03-standalone-arrow.png) | arrow drawn by mouse |
| [`screenshots/04-standalone-text.png`](evidence/render/screenshots/04-standalone-text.png) | text drawn by keyboard, properties panel, local Excalifont |
| [`screenshots/05-standalone-updateScene.png`](evidence/render/screenshots/05-standalone-updateScene.png) | `convertToExcalidrawElements` + `updateScene` |
| [`screenshots/06-slot-720x480.png`](evidence/render/screenshots/06-slot-720x480.png) | constrained slot |
| [`screenshots/07-slot-resized-520x360.png`](evidence/render/screenshots/07-slot-resized-520x360.png) | ResizeObserver follow-up |
| [`screenshots/08-dsh-loader-mounted.png`](evidence/render/screenshots/08-dsh-loader-mounted.png) | component through `__ModuleLoader__`, React 18.3.1 |
| [`screenshots/10-dsh-lean-mounted.png`](evidence/render/screenshots/10-dsh-lean-mounted.png) | lean bundle with `/lazy/` locale chunk |
| [`screenshots/11-dsh-strict-csp.png`](evidence/render/screenshots/11-dsh-strict-csp.png) | strict-CSP stress: renders, fallback blocked |
| [`screenshots/12-binding-scene.png`](evidence/render/screenshots/12-binding-scene.png) | `serializeAsJSON` → `restore` bound-arrow scene |
| [`json/ui-smoke-results.json`](evidence/render/json/ui-smoke-results.json) | 19/19 standalone assertions + all stages |
| [`json/dsh-loader-results.json`](evidence/render/json/dsh-loader-results.json) | 28/28 DSH-contract assertions (three passes) |
| [`json/dsh-loader-console.json`](evidence/render/json/dsh-loader-console.json) / [`json/dsh-loader-network.json`](evidence/render/json/dsh-loader-network.json) | console + network for the faithful pass |
| [`json/dsh-strict-csp.json`](evidence/render/json/dsh-strict-csp.json) | 230 blocked fallback attempts, 0 external responses |
| [`json/scene-after-drawing.json`](evidence/render/json/scene-after-drawing.json) / [`json/scene-after-updateScene.json`](evidence/render/json/scene-after-updateScene.json) | scene read-back after real input / imperative update |
| [`json/canonical-elements.json`](evidence/render/json/canonical-elements.json) | skeleton → canonical elements (Lead request) |
| [`json/serialize-asjson.json`](evidence/render/json/serialize-asjson.json) | exact `serializeAsJSON` output, bound arrow scene |
| [`json/conversion-notes.json`](evidence/render/json/conversion-notes.json) | transform semantics (bindings, ids, text sizing) |
| [`json/size-report.json`](evidence/render/json/size-report.json) | every bundle/asset number, versions, metafile summary |
| [`exports/scene.svg`](evidence/render/exports/scene.svg) / [`exports/scene.png`](evidence/render/exports/scene.png) | SVG/PNG exports from the live scene |
| [`../spikes/render/dsh-bundle/`](../spikes/render/dsh-bundle/) | spike package: `package.json`, generated `client.js`, font-route Node half, rebuild script |
