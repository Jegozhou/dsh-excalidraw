# Spike DSH client package: genuine Excalidraw renderer

This directory is a **spike copy** of the shape a real DSH client package must
have. It is *not* installed into the live profile and it is not published.

```
dsh-bundle/
  package.json          # dsh.client declaration + exports["./client"]
  client.js             # GENERATED: window.__ModuleLoader__.load({ id, factory(require) })
  lib/index.js          # Node half: asset route patch (standard asset route cannot serve woff2)
  lib/assets/fonts/     # (copy here for a real install) Excalidraw's 234 woff2 files
  build.mjs             # rebuild script (esbuild wrapper, React external)
```

## What the bundle is

`client.js` is a classic script that registers a closure factory:

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-excalidraw',
  factory(require) {
    var module = { exports: {} }
    /* esbuild CJS output; react/react-dom/react/jsx-runtime stay external */
    return module.exports
  },
})
```

Contract details verified against
`upstream/deepseek-harness/packages/client/modules/src/{client/system.ts,client/manifest.ts}`:

* `require(specifier)` resolves **only** the page module-table words. The live
  shell seeds `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
  `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`,
  `@deepseek-ai/dsh-client-store`, `...-ui-slots`, `...-ui-primitives`,
  `...-ui-dockkit` (`packages/client/web/src/seed.ts`).
* The live shell seeds **React 18.3.1** (not React 19). The bundle must therefore
  stay React-18 compatible; Excalidraw 0.18.1 declares
  `react ^17.0.2 || ^18.2.0 || ^19.0.0`, and this spike proves the bundle runs
  on the page-supplied 18.3.1.
* The factory returns the Cordis plugin module (`inject` + `apply`). Styles the
  factory injects are claimed by the loader when they are untagged; the bundle
  also tags them itself, matching the tsdown preset convention
  (`<style data-plugin="…" data-plugin-css="…">`).

## Build

From `spikes/render` (the spike root):

```bash
pnpm install --ignore-workspace --store-dir /Volumes/ZHITAI/DSHExcalidraw/.cache/pnpm-store
node scripts/build.mjs            # writes dsh-bundle/client.js and the size report
```

The build externalizes `react`, `react-dom`, `react-dom/client`,
`react/jsx-runtime`; compiles `@excalidraw/excalidraw/index.css` with the
esbuild `text` loader; and inlines Excalidraw's lazy imports (locales, mermaid,
export worker) because a single classic script cannot use native `import()` for
package-local files.

## CSS and font strategy

* **CSS**: injected at factory execution as one tagged `<style>` element
  (144.9 KB, 1050 rules). `url("./fonts/Assistant/…")` rules are rewritten to
  absolute package-route URLs because an injected `<style>` resolves relative
  URLs against the *document*, not the package.
* **Fonts (FontFace API)**: set `window.EXCALIDRAW_ASSET_PATH` to an **absolute**
  URL of the font base *before mounting* (Excalidraw `new URL(fontPath, base)`
  requires an absolute base). The client half computes it as
  `new URL('plugins/@local/dsh-excalidraw/assets/', document.baseURI).href`, so
  it works under any mount path.
* **Why `lib/index.js` exists**: the standard package asset route
  (`plugins/<pkg>/assets/<path>`, `exports["./assets/*"]`) serves only
  `svg/png/webp/jpg/jpeg`; `.woff2` answers 404
  (`packages/client/modules/src/assets.ts`, `PACKAGE_ASSET_MEDIA_TYPES`).
  The Node half registers a prefix route on `ctx.webServer` for
  `GET /plugins/@local/dsh-excalidraw/assets/<path>` with
  `content-type: font/woff2` (and image MIME), shadowing the built-in route for
  this package. Copy `node_modules/@excalidraw/excalidraw/dist/prod/fonts` to
  `lib/assets/fonts/` for a real install.
* **CDN fallback**: Excalidraw 0.18.1 hardcodes
  `https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/` as a last-resort
  font base next to `EXCALIDRAW_ASSET_PATH`. On the DSH page (which has **no
  CSP**) local fonts resolve first and the fallback is never requested — proven
  with 0 external requests. Under a strict `font-src 'self'` CSP, Chromium
  reports blocked attempts for unused faces but the fallback never completes and
  local fonts still render (see `docs/04-render-spike.md`). If the shell ever
  adds CSP, patch the fallback out of the bundle at build time.

## Known constraints

* Single-file worst case: **8.01 MiB raw / 2.39 MiB gzip** (React external).
  Splitting Excalidraw's lazy imports yields a **0.70 MiB / 0.20 MiB gzip**
  initial ESM entry plus 54 chunks; the repo's tsdown client preset is the right
  way to get that shape with `require.async` chunk registration.
* The plugin needs a sized host element (`width/height: 100%`); Excalidraw uses
  `ResizeObserver` and follows container resizes (720x480 -> 520x360 measured).
* No worker/CSP issues at mount; the font-subset tooling chunk (export path) is
  inlined and degrades to main-thread work because the worker URL resolves to
  the main bundle.
