# 02 — DeepSeek Harness plugin platform contract

Evidence-grade analysis for the Excalidraw plugin (host + browser halves, agent tools, file
persistence). Everything below is either **read from source** (public clone, path:line), **read
from the installed app** (0.2.1-rc.2 `app.asar` docs/packages), **queried from the live Host**
(`cordis_inspect_query`, raw output saved), or **measured** in the isolated experiment in §6.
Claims that could not be verified are marked **UNVERIFIED** in place.

Convention: `path:line` means the file at that path in this workspace, `upstream/deepseek-harness/…`
is the public clone. Raw inspect output and experiment logs live in
[`docs/evidence/dsh/`](evidence/dsh/).

---

## 0. Sources, versions, and what is actually live

| Fact | Value | Evidence |
|---|---|---|
| Live installed Harness | **0.2.1-rc.2** | `dsh --version` → `0.2.1-rc.2` ([live-profile.txt](evidence/dsh/live-profile.txt)) |
| Live profile | `desktop`, dir `$DSH_PROFILE_DIR` = `~/.dsh/profiles/desktop` | same |
| Public clone | commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` (2026-10-23), **root version 0.2.1-rc.3** | `upstream/deepseek-harness/package.json`; `git log -1` |
| Live client-modules package | `@deepseek-ai/dsh-client-modules@0.2.1-rc.2`, `dsh.client = { platform: "web", inject: [], immediately: true }` | `app.asar/dsh/node_modules/@deepseek-ai/dsh-client-modules/package.json` |
| Installed version's own plugin docs | `…/dsh-agent-preset/skills/cordis-plugin-development/references/*.md` (read from `app.asar` with the file-read tool) | cited as "installed skill reference" |

**Version caveat.** The clone is one release candidate *ahead* of the running app. Source citations
below are rc.3; where the contract matters for the delivered plugin, it is corroborated by the
installed skill reference (rc.2) and, for the tool surface, by the live Host itself. I found **no
contradiction** between the two versions on any contract in this document, but the rc.3 clone can
contain additive fields the rc.2 package does not have. The Excalidraw plugin must be written
against **rc.2 semantics** (the app it will run in) and re-checked after any app update.

**Live capability boundary of this analysis.**

- Works: `host/Service.listService` (catalog, 86 KB), `host/Tool.listTools` (123 KB, full tool
  schemas), `host/Config.listConfigs` (204 live Loader entries).
- Blocked: **every query that passes `input`** — the inspect bridge rejected `input` with
  `Error: … rejected input: "input" must be an object`, including `input: {}` and a JSON string
  ([live-inspect-attempts.txt](evidence/dsh/live-inspect-attempts.txt)). So the per-service exact
  contract view, the per-entry Config schema, and `Slots.listSubTree(root)` could not be captured.
- Blocked: **every client-platform query** (`Builtin.listBuiltins`, `Slots.listSubTree`) timed out
  after 10 s with `Open or reconnect the Harness page, then retry` — no page was connected to the
  client inspect bridge during this run. The live slot tree is therefore **UNVERIFIED**; slot
  facts below come from the installed rc.2 skill reference, the rc.3 source, and the reference
  plugin's proven registration.

---

## 0.1 Short version (the decisions this document supports)

1. **One npm package, two halves.** Host: an ESM module exporting `apply`/`inject` (+ optional
   `Config`) or a service class. Browser: `exports["./client"]` containing
   `window.__ModuleLoader__.load({id: <package name>, factory(require){…}})`.
2. **One bundle row** inserted by the package's own `cordis.patch.yml`; the profile lists the
   package in `dsh.profile.bundles`. Install = package install + that list entry (CLI `dsh plugin
   add` or `plugin_manager install_bundle`), uninstall = the reverse.
3. **Everything is an effect.** Register services, routes, timers, tools, slots, styles and locale
   through `ctx.effect`/`ctx.on` and return the disposer; the Loader disposes them when the row is
   disabled or the plugin reloaded. Do not rely on async disposers at process exit.
4. **Tools:** `name`, `description`, `parameters` (JSON Schema), **mandatory** `output {schema,
   render}` and `execute`; the registry validates only the output schema, so validate your own
   arguments. `tools.register` returns the disposer. `restrict` is per-agent; `guard` only denies;
   real confirmation goes through `ctx.approval` (open turn required).
5. **Browser module table is 12 words** (React, cordis, zod, client-store, ui-slots,
   ui-primitives, dockkit, react-virtual). Everything else must be bundled; never ship a second
   React.
6. **UI:** register the page into `main` (`key: <panel id>`, keyed/root) and its icon into
   `sidebar.panellist` (`id: <same panel id>`, list/root, `label`, `order`) — the reference plugin
   is a proven example. `ctx.layout.selectPanel(id)` navigates.
7. **Browser ↔ Host:** same-origin `fetch` on a `webServer.register({kind:'prefix'})` route whose
   handler first calls `ctx.get('connection').requestRejection(req)` (403 trust fence, then 401
   cookie check). Alternatives: `connection.fetch.register` (exact `/api` routes, owner Peers only),
   `connection.rpc.handle`, or a WebSocket upgrade + `admitConnection`. Never add a second auth
   scheme.
8. **State:** plugin state in `$DSH_HOME/<plugin-id>/` (or `ctx.storageDomain` when you want
   schema + change events); user `.excalidraw` files stay ordinary workspace files. The Host is not
   sandboxed — path discipline is the plugin's own job.
9. **A 3–5 MB client bundle is loaded, parsed and executed at every page boot** for every user
   (all client rows activate at boot; `immediately` only changes prefetch timing). Split the heavy
   editor into a package-local `client.<name>.js` chunk loaded via `require.async`, serve fonts/WASM
   from a custom Host route (package assets reject non-image types), and keep `client.js` small.
10. **Bounds:** no iframe pages, no custom client packages at runtime, no plugin-run HTTP server, no
    new session event types, no worker entry point for plugin code. Those need source-level changes
    or a separate app (§8).

---

## 1. Lifecycle: package → bundle → row → fiber → effect

### 1.1 The five units

```
npm package  --(dsh.bundle.patch)-->  bundle layer
profile/package.json dsh.profile.bundles  --(ordered layers)-->  composed entry tree (rows)
row  --(cordis-plugin-loader)-->  Loader entry  --(cordis)-->  plugin fiber  --(ctx.effect)-->  disposable
```

A **profile** is a directory under `$DSH_HOME/profiles/<name>` with a `package.json` (plugin
dependencies + `dsh.profile.bundles`) and its own `cordis.patch.yml`. Composition imports the
root entry list from `cordis.yml` (always `[]`), applies each selected bundle's patch files **in
`bundles` order**, then the profile's own patch layer, then launcher `--patch` overlays:
`upstream/deepseek-harness/packages/boot/app-boot/src/profile.ts:1-18`. A **bundle** is any npm
package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` (string or
ordered list) — `profile.ts:47-70`.

Module resolution is **two-anchor**: a row's package name resolves first from the dsh
installation (packages shipped with the app, e.g. `@deepseek-ai/dsh-base`), then from the profile
directory (`profile.ts:14-18`). The runtime resolution also supplies installation-carried packages
to Node's ESM and CommonJS resolvers, so a plugin *can* `import '@deepseek-ai/cordis'` without
declaring it — but the set of importable packages is version-dependent, which is why the reference
plugin deliberately imports nothing from the harness (`src/host/tools.js:308-316` says so
explicitly) and ships its own JSON-Schema compiler.

### 1.2 Row shape and patch dialect

A row has `id`, `name` (module specifier), optional `config`, and optional `disabled`, `inject`,
`intercept`, `isolate`. Patch semantics, from the installed
`cordis-composition-reference` skill (the rc.2 authority) and visible in the composed dump:

- `insert: [rows]` appends rows; with an `id` naming a `group: true` row, it appends inside that
  group.
- A patch with an `id` and no `insert` **targets** that row; supplied fields replace row fields,
  and **`config` is replaced wholesale, never deep-merged**. A truthy `name` only asserts identity.
- `disabled` accepts bool/null/`!!js` expression evaluated at every mount decision. A disabled row
  omits required `config` unless `group: true` forces activation.
- `!!js` scalars are Loader expressions (never `!js`); inside `config` they are evaluated after the
  row's injections activate, against that plugin's context — e.g. `!!js dshHomePath('sessions')`.
- `group: true` + `name: cordis:group` makes `config` a nested entry list; `cordis:include` loads a
  literal YAML/JSON entry list.
- `isolate` maps service names to `true`/realm labels (service-instance isolation); scope controls
  contribution visibility.
- Non-insert patches without a nonempty `id`, and targets matching no row, are warned and skipped.

A real composed tree is in [experiment/dump-config-after-add.txt](evidence/dsh/experiment/dump-config-after-add.txt):
360 lines, framework rows with `disabled: !!js '!ctx.get(''profileContext'')'` (dump lines 6, 11-12,
…) and our fixture bundle appended as `# == dsh-expt-fixture` + row `expt-fixture` (lines 361-365).

### 1.3 Install / uninstall / disable

**CLI path** (used by our experiment): `dsh plugin --profile <name> <pnpm args…>` forwards to pnpm
inside the profile directory (`upstream/deepseek-harness/apps/cli/src/args.ts:188`,
`apps/cli/src/plugin.ts:71-107`). Installing a local package writes:

1. `profiles/<name>/package.json` → `dependencies["<pkg>"] = "link:<abs path>"` **and** appends the
   package to `dsh.profile.bundles` (observed: [plugin-add](evidence/dsh/experiment/plugin-add.stdout.txt),
   [composed tree after add](evidence/dsh/experiment/dump-config-after-add.txt); the manifest itself
   is reproduced in §6);
2. a `node_modules/<pkg>` symlink to the source directory (pnpm `link:` protocol, hoisted linker);
3. a lockfile update.

Uninstalling removes the dependency and the `bundles` entry, but **pnpm's `link:` symlink stays in
`node_modules`** (dangling). Measured: §6.3. A plugin must therefore never be resolved by scanning
`node_modules`; DSH resolves via the `bundles` list, which is why the leftover link is harmless —
but it is a real difference between "uninstalled" and "clean".

**App path (sanctioned live install):** `plugin_manager` `install_bundle` performs package
installation and bundle selection; do not reproduce those steps with shell commands (installed
skill reference `references/host-plugin.md:66-68`). Its result model matters for verification:
`application` is `applied` / `failed` / `overridden` / `restart-required` (`failed` requires
diagnosis, `overridden` means a higher layer wins); installing a new bundle can activate through
HMR, **replacing** an installed package requires a restart, and an unchanged slot id does not prove
new browser code loaded (`host-plugin.md:68-70`).

**Disable** is a row-level state, not a package removal: `disabled: true` (or an expression) makes
the Loader skip/dispose the fiber, and every `ctx.effect` inside the plugin runs its disposer. The
composed tree shows framework rows disabled by expression this way
([dump lines 6, 11-12](evidence/dsh/experiment/dump-config-after-add.txt)).

**Client code replacement** is revision-driven: the artifact revision is a hash of the bundle's
`mtimeMs`, `ctimeMs`, and `size` (`upstream/deepseek-harness/packages/client/modules/src/index.ts:219-224`),
and a changed revision invalidates the module, tears down the entry fiber, removes owned styles,
re-imports and refreshes (`packages/client/modules/src/client/entries.ts:163-200`).

### 1.4 Config declaration and validation

A Host plugin declares config with a Cordis plugin `Config` (schemastery `z` or zod v4, anything
implementing Standard Schema):

```js
export const Config = z.object({ dataDir: z.string().default(''), dryRun: z.boolean().default(true) })
```

Validation happens at activation, not at patch-parse time:
`upstream/deepseek-harness/vendor/cordis/src/fiber.ts:50-62` calls
`runtime.Config['~standard'].validate(config)`, throws on `issues` (async validation is
unsupported), and publishes the parsed value as the second `apply(ctx, config)` argument.

Two consequences that matter:

1. **Unknown keys are not rejected.** The schemastery Standard-Schema face resolves with
   `strict = false` (`vendor/schemastery/src/index.ts:290-303`) and the object resolver
   `merge(result, data)`s undeclared keys back in (`:812-823`). A plugin must normalize/clamp its
   own config (the reference plugin does exactly that in `normalizeConfig`, see §5).
2. **A matching override replaces the complete config**, so the user's patch layer must restate
   every field a row needs (patch dialect above).

Live Config surface: `host/Config.listConfigs` returned **204 entries** with per-row status
`tree` / `inactive` / `schema` / `absent` and `patchId` separate from `id`
([host-Config.listConfigs.p1.txt](evidence/dsh/host-Config.listConfigs.p1.txt)). Status `absent`
means the package publishes no Config; `schema` means a validated schema exists. Querying one
entry's exact JSON Schema requires the blocked `input` path (see §0) — **UNVERIFIED** for the
reference plugin, but its `apply` normalizes config defensively anyway.

### 1.5 What `ctx.effect` guarantees (and what it does not)

Contract, from `vendor/cordis/src/fiber.ts`:

- An effect body returns **one disposer, a promise of one, or a (async) iterable of several**;
  generator effects register each yielded disposer as it is produced (`fiber.ts:66-88`,
  `:340-400`).
- Disposers run **in reverse registration order** when the owning fiber unloads, and the fiber
  awaits them (`fiber.ts:66-72`, `:694-730`). A plugin fiber's disposer awaits its own `inertia`
  before reporting disposal complete (`fiber.ts:265-297`).
- Ownership is the **caller's context**: `tools.register`, `ctx.provide`, `locale.register`,
  `slots.register`, `webServer.register`, `storageDomain` mounts all return the disposer for that
  registration; `ctx.provide(name, service)` returns the disposer (`ctx.provide` usage in the
  reference plugin, §5). `slots.register` is deliberately a prototype method so the Cordis service
  proxy binds `this.ctx` to the **caller's** fiber at call time — that is what routes the effect
  into the right plugin (`packages/client/ui-renderer/src/client/registry.ts:166-207`).

**Process shutdown is bounded and racy for async work.** The CLI wraps the whole tree in a
`createProcessShutdown(dispose)` with a 5 s grace, SIGTERM → exit 0, SIGINT → exit 130
(`upstream/deepseek-harness/apps/cli/src/process-shutdown.ts:1-76`,
`apps/cli/src/profile-boot.ts:270-310`). Measured on the isolated profile
([fixture log](evidence/dsh/experiment/fixture-events.log), trials in
[fixture-events-1..6.log](evidence/dsh/experiment/)):

- a **synchronous** disposer ran in **6/6** trials (`sync-probe-disposed`);
- an **async** disposer (50 ms `await`) started in 6/6 trials but completed in only **1/6**; the
  process exited 9–10 ms after the start in the other five.

Rule for the Excalidraw plugin: **do not put durable work behind an async disposer at process
exit.** Flush/flush-on-write inside the tool call or the HTTP handler; keep disposers for closing
handles (`store.close()`, timers, sockets) and accept that shutdown may cut them off. The reference
plugin follows this pattern (sync `store.close()` in an effect; `await scheduler.stop()` in another)
— see §5.

**UNVERIFIED:** fiber disposal on a *live* row disable/restart in the running app (would require
touching the live profile).

---

## 2. Host tool registration contract

### 2.1 Exact `ToolDefinition` (required vs optional)

From `upstream/deepseek-harness/packages/core/tools/src/contracts.ts:26-101` — `ToolDefinition
extends ToolSchema`, so `name`, `description`, `parameters` come from `ToolSchema`:

| Field | Required | Contract |
|---|---|---|
| `name` | yes | registry key; duplicate within a scope throws; `run_code` is reserved and cannot be registered or shadowed (`packages/core/tools/src/index.ts:139-147`) |
| `description` | yes | model-facing |
| `parameters` | yes | **raw JSON Schema**, projected to the model as a lossless-JSON snapshot (name, description, parameters, plus `deferLoading` when true) — `packages/core/tools/src/schema.ts:641-650`; a non-lossless value throws at projection time. The registry validates it only against the *supported subset* (`assertSupportedJsonSchema`), **not** against object-rootedness — the object root is a model-gateway requirement that every shipped tool satisfies (live list confirms) |
| `output` | **yes** | `{ schema, render(args, value): ContentBlock[], presentationMeta?(args, value): JsonValue }` (`contracts.ts:20-31`). Missing/malformed throws `must declare output { schema, render, presentationMeta? }` (`index.ts:132-137`) |
| `execute(args, exec)` | yes | returns the canonical lossless-JSON value declared by `output.schema`; must observe/forward `exec.signal` |
| `projectContent?` | no | install execution-prepared content before `tools/post-execute` |
| `finalizeContent?` | no | synchronous last-mile model-content transform; must be total and not throw |
| `timeoutMs?` | no | cooperative budget, **never** sent to the model; declaring asserts the tool forwards `exec.signal` |
| `isConcurrencySafe?` | no | pure sync classifier; only literal `true` opts into a parallel group |
| `presentCall?` | no | pure pending-state UI card from `args` (replay-safe, may run on old args) |
| `presentResult?` | no | pure completed-state UI card from `args` + durable result |

The registry additionally validates `output.schema` with `assertSupportedJsonSchema`
(`packages/core/tools/src/json-schema.ts:385-389`) and `timeoutMs` positivity
(`index.ts:138-147`). `assertObjectJsonSchema` (object-root enforcement, `json-schema.ts:397-405`)
is used for **subagent/workflow structured output**, not for tool `output.schema`.

`register()` returns the **exact disposer** that unregisters (`index.ts:122-153`), and can take
`{ when: (ctx) => boolean | Promise<boolean> }` for step-time activation
(`contracts.ts:115-127`).

### 2.2 Two ways to author a tool (do not mix)

1. **`defineTool`** (`packages/core/tools/src/schema.ts:555-633`) — typed authoring DSL. It
   compiles the compact parameter map into JSON Schema (`:578-579`), compiles output schema
   (`:579`), validates arguments on every `execute` and throws `ToolArgsError` (`:598-602`), and
   project/presentation callbacks that throw or fail validation fall back to `undefined`.
   Parameter semantics: the map is an **implicit open object root**; requiredness is
   `required: true` per property; nested objects must state `additionalProperties`; `type: 'json'`
   is author-only unconstrained JSON (`schema.ts:101-115`).
2. **Hand-written `ToolDefinition`** — what a plain-JS plugin does (the reference plugin, §5). The
   registry only checks `output` shape and the output schema; **it does not validate `parameters`
   or incoming args for you**, so the plugin compiles its own JSON Schema and validates arguments
   itself.

### 2.3 Scoping

- Registered on a plugin's root context → **global**: visible to every agent whose preset admits
  plugin tools. Registered on an `agent.ctx` (from an `agent/created` listener) → **scoped**: that
  layer shadows globals, and `ScopeKey` chains intersect (`index.ts:199-260`).
- `tools.restrict({allow?, deny?})` only filters **global** tools and only from a **scoped**
  context — a global restriction throws (`index.ts:162-190`). It cannot name `run_code`.
- `tools.guard((execution) => reason | undefined)` is the synchronous, order-independent denial
  surface: guards have no "allow" result, so ordering can never turn a denial back into permission
  (`contracts.ts:383-391`).
- A denial that must *await* something belongs in `tools/pre-execute` returning `ask`
  (installed skill reference `references/practices.md:17`).
- Human approval: `ctx.approval.request(req)` with `{agent, toolName, callId?, reason?,
  signal?}` → `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`
  (`packages/interaction/user-approval/src/types.ts:32`, `src/index.ts:140-230`); the ask requires
  an **open turn** because the audit pair is logged. The reference plugin instead uses an
  in-band `confirm: true` argument + `dryRun` — cheaper, but not a host-enforced permission.

### 2.4 Live confirmation

`host/Tool.listTools` returned the live tool surface, including the reference plugin's 12 tools
**exactly as its own compiler produced them** — object-rooted JSON Schema, `required` array, no
`additionalProperties` (e.g. `scale_commander_preview` with `required: ["account_id"]`)
([host-Tool.listTools.txt](evidence/dsh/host-Tool.listTools.txt)). That is direct evidence that
the published contract is "raw JSON Schema in, render function out", and that a plain-JS plugin can
satisfy it without `defineTool`.

**UNVERIFIED:** live `output.schema` enforcement per tool (would require calling a tool with an
invalid canonical value), and live guard/approval behaviour for these tools.

---

## 3. The client half

### 3.1 Manifest: `dsh.client` + `exports["./client"]`

`dsh.client` is parsed and **validated** by `parseDshClient`
(`upstream/deepseek-harness/packages/client/modules/src/client/manifest.ts:165-190`):

| Field | Required | Meaning |
|---|---|---|
| `platform` | **yes**, string | only `"web"` is composed into the browser graph (`packages/client/modules/src/index.ts:903`) |
| `inject` | no, `string[]` | **package names** whose factories must arrive before this row materializes, and Cordis package edges for composition (`manifest.ts:44-65`) |
| `external` | no, `string[]` | exact non-inject module specifiers this row requests |
| `immediately` | no, boolean | stage-one prefetch tier: load the script during module-face boot |

The bundle file is `package.json` `exports["./client"]` — a string or `{ default: string }`;
declaring `dsh.client` without it is a composition error
(`packages/client/modules/src/index.ts:201-213`, `:908-910`). The **registration id must equal the
package name**: the loader addresses the browser module by it and the graph row is keyed on it
(reference `build.mjs:100-113`).

The reference plugin's manifest is a valid example:
`/Volumes/ZHITAI/ScaleInsights插件开发/package/package.json:29-45` →
`{"plugin": true, "kind": "server", "bundle": {"patch": "./cordis.patch.yml"}, "client":
{"platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-locale",
"@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-sidebar",
"@deepseek-ai/dsh-client-ui-primitives"]}}`.

### 3.2 Delivery: `/plugins` combo scripts and the boot graph

The node half scans live Loader entries, reads each package's manifest + `dsh.client` + bundle
metadata, and composes `window.__DSH_BOOT__`: `{ rev, release?, entries: [{id, url, rev, inject?,
immediately?, external?}], batches: [{phase:'bootstrap'|'application', url, rev, entries}] }`
(`manifest.ts:44-110`).

URLs are document-relative references under one prefix:

- row URL: `/plugins/??<id>/client.js&rev=<hash>` (single resource; `comboSearch`/`comboUrl`,
  `packages/client/modules/src/index.ts:270-286`);
- batched combo: `/plugins/??<id1>/client.js,<id2>/client.js&rev=<hash>` — several plugins' bundles
  concatenated into **one** `text/javascript; charset=utf-8` response (`:840-860`);
- package-local chunk: `/plugins/<id>/client.<name>.js?rev=<hash>` (`:290-294`, regex `:198-199`);
- package asset: `/plugins/<id>/assets/<path>` (`:1244-1255`, regex `:236-240`);
- `rev` is a 12-hex hash of the bundle artifact's mtime/ctime/size (`:219-224`); responses carry an
  immutable cache header.

The route is registered by the client-modules node half as `{ kind: 'prefix', path: '/plugins' }`
(`index.ts:703`). Anything not an exact advertised URL, current revision, or existing chunk is a
**404** (`index.ts:1256-1269`) — verified live: `/plugins/dsh-scale-commander/client.js` with
guessed `rev` values → 404 ([live-http-probes.txt](evidence/dsh/live-http-probes.txt)).

**Every row activates at page boot.** `bootClient` creates one Loader entry per manifest row,
imports/activates all of them and awaits quiescence; an entry whose module cannot be imported is
marked failed and **fails startup** (`upstream/deepseek-harness/packages/client/web/src/boot-client.ts:36-60`).
So a plugin's entry script is fetched, its factory executed, and its plugin `apply` run on every
page load — `immediately` only decides whether that happens in the stage-one prefetch or slightly
later. Deferring heavy code therefore requires a package-local **chunk**, not a manifest flag
(§7 item 2).

### 3.3 Bundle format: `window.__ModuleLoader__.load({id, factory})`

```js
window.__ModuleLoader__.load({
  id: 'dsh-excalidraw',              // === package name === graph row id
  factory(require) {                 // runs once, at materialization
    const React = require('react')   // module table
    // ... bundle body ...
    return { apply, inject }         // the Cordis client plugin
  },
})
```

Exact types: `ClientBundleRegistration {id, chunk?, factory(require: ClientBundleRequire)}` and
`ClientBundleRequire` = synchronous `(specifier) => unknown` + `async(specifier)` for package-local
chunks + `asset(reference)` for package assets (`manifest.ts:349-376`). The facade is **queue before
boot, live after**: `ClientModuleLoaderTarget {mode:'queue'|'live', pendingQueue, load(reg),
create(options)}` (`manifest.ts:397-408`); the module system drains the queue when the shell creates
it (`packages/client/modules/src/client/system.ts:160-175`).

The model is **lazy CJS** (documented at `manifest.ts:9-27`):

- executing a bundle script only **registers** its factory; all module side effects (including CSS
  injection) live inside the factory closure and run at **materialization**, not script execution;
- materialization happens on first `import`/`require` and is memoized in `loadCache`; a factory
  requiring another registered module materializes it recursively;
- resolution order: seed word → memoized record → graph row (register dependency factories, then
  own factory) → registered factory → **throw** (the runtime mirror of the build-time bundle
  purity gate). Loading is async, so a dynamically requested package must have registered its
  factory before a consumer materializes.

### 3.4 The module table is exactly 12 specifiers

`packages/client/web/src/seed.ts:26-42` is the complete, frozen platform table:

```
react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis, zod,
@tanstack/react-virtual, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

Consequences for the Excalidraw plugin:

- React (and JSX runtime) comes from the page; **never** bundle a second React copy. esbuild must
  externalize `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` (reference
  `build.mjs:78-95`) and resolve them through the `require` handed to the factory.
- Everything else (Excalidraw core, its dependencies) must be **inside the bundle** — there is no
  `node_modules` in the page and no CDN.
- The installed skill reference explicitly warns **not to require Harness Client packages** as
  modules (`references/practices.md:35`) even though some appear in the table: they change without
  notice and a throwing component blanks the slot entry. `dsh.client.inject` entries only order
  activation.
- `dsh.client.external` is for a *graph row* specifier (another client plugin's package), not for
  arbitrary npm packages.

### 3.5 Slot registration API

`ctx.slots.register(options, Component)` returns the disposer; the options shape is
`name` (target slot) plus kind-specific fields, `locale`, `inject`, `children`, `store`,
`registrant` (`packages/client/ui-slots/src/index.ts:762-845`, register at `:1207`):

- `keyed` slots (`main`): `key` + optional `priority`;
- `list` slots (`sidebar.panellist`, `conversation.view`, `conversation.composer.dock`):
  `id`, optional `order`, `label` (string or `() => string`), `priority`;
- `chain`: `select` + `priority`; `single`: `priority` only;
- `locale: '<ns>'` puts the framework's `t` on the component props and **requires an installed
  locale face** (a missing dictionary fails loud);
- `inject`/`children`/`store` bind shared props/state to the entry.

Recommended pattern — and what the reference plugin does — is to register **behind a declaration**:

```js
ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key: PANEL_ID, locale: NS,
  inject: () => ({ toasts }) }, Page))
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist',
  id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, Icon))
```

`slots.inject(key, cb)` installs an effect for each **declaration lifetime** of the slot: the
callback runs when the declaration exists (synchronously if it already does), is disposed when the
declaration collapses, and runs again on re-declaration; the whole controller belongs to the
caller's fiber (`packages/client/ui-renderer/src/client/registry.ts:209-260`). Registering
directly (without `inject`) also works while the slot is already declared, but loses that
re-declaration behaviour (the reference uses `inject` for both entries).

Slot facts for our three targets:

| Slot | Kind | Scope | Declared by | Notes |
|---|---|---|---|---|
| `main` | `keyed` | `root` | `packages/client/ui-layout/src/client/index.ts:73` (declaration at `:182-183`) | central panel selected by sidebar entry id; key `conversation` is reserved for the Conversation. `retainMainPanels` keeps the registered keys in the live layout store so navigation does not drop a selection (`ui-layout/src/client/index.ts:167-175`); that store is explicitly **transient** (`ui-layout/src/client/stores.ts:12-17`), i.e. not a persistence mechanism |
| `sidebar.panellist` | `list` | `root` | `packages/client/ui-sidebar/src/client/contract/slots.ts:36` | "Each list id addresses the matching main panel; the sidebar owns the button and resolves its label from list metadata." So **entry `id` must equal the `main` `key`** |
| `conversation.view` | `list` | `session` | `packages/client/ui-conversation/src/client/contract/slots.ts:278` | a Conversation target view (tab), session-scoped props |
| `conversation.composer.dock` | `list` | `session` | `packages/client/ui-conversation/src/client/contract/slots.ts:294` | ambient rows below the composer card; the least invasive surface for a small panel |

Navigation from plugin code: `ctx.layout.selectPanel(id | null)` throws if no `main` panel with
that key is registered (`packages/client/ui-layout/src/client/service.ts:71-78`).

### 3.6 Styles, locale, and what disposal actually removes

- **Styles:** register inside `apply` through `ctx.effect` and remove the `<style>` in the returned
  disposer — the reference plugin's `src/client/index.jsx:53-59` is the canonical form. The loader
  *also* claims untagged styles created during materialization and tags them `data-plugin="<id>"`,
  then removes them on code replacement / unlinking / pruning
  (`system.ts:76-93`, `entries.ts:147,195`, `system.ts:425-470`, `entry-lifecycle.ts:19-28`) — but
  **not** on a plain fiber unload. A plugin that injects CSS at factory top level will leave dead
  `data-plugin` styles after being disabled.
- **Locale:** `ctx.locale.register(ns, {en, zh})` returns a disposer (throws if the same ns+locale
  registers twice); `ctx.locale.bind(ns)` returns a memoized `t`
  (`packages/client/locale/src/client/index.ts:403-423`, `:459-467`). Slot entries that declare
  `locale` fail loud if no dictionary is installed for the active locale.
- **Factories must stay side-effect free** (installed skill reference `references/ui-plugin.md:13`):
  register styles, timers, listeners and other resources in `apply` with `ctx.effect`/`ctx.on` and
  return their cleanup.

### 3.7 How the browser half calls the Host — options and auth

**Option A (reference plugin): own HTTP route + Connection fence.** The Host half registers one
prefix route and asks Connection to admit each request:

- `ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => webCtx.webServer.register({kind:'prefix',
  path:'/scale-commander/api', handler:(req,res)=>api.handle(req,res)}), label))` —
  `/Volumes/ZHITAI/ScaleInsights插件开发/package/src/host/index.js:6-22`;
- inside the handler, before any routing: `const rejection = this.admit(req); if (rejection !==
  undefined) { sendJson(res, rejection, {error:{code:'unauthorized', …}}); return }` —
  `src/host/api.js:150-157`, where `admit` is `(req) => ctx.get('connection')?.requestRejection?.(req)`
  (`src/host/index.js:9`);
- the browser calls `fetch('/scale-commander/api/...', {credentials:'same-origin'})` and adds no
  credential of its own — `src/client/lib/api.js:51-58`.

What `requestRejection`/`admit` do (`packages/client/connection/src/rpc-host.ts:123-137`):

1. Host/Origin trust fence first — untrusted authority → **403** (DNS-rebinding and cross-site
   defence; rationale in `packages/client/connection/src/api-request-trust.ts:1-14`);
2. browser session authentication — no/expired cookie → **401**;
3. otherwise the request is admitted with the shared **owner Peer**.

Browser auth mechanics (`packages/client/connection/src/browser-auth.ts`):

- the app opens the GUI with a per-process **launch token** as the URL's sole query parameter
  (`?token=…`, `TOKEN_QUERY='token'`, `:14-20`, `:240-249`). A GET of `/` carrying exactly one valid
  token mints a signed session cookie and redirects `303` to the directory-relative clean `./`
  with `referrer-policy: no-referrer` (`:265-289`);
- the cookie name is `dsh-auth-` + `base64url(sha256(authority))` (`:116-118`), the value is an
  HMAC-signed payload bound to that authority with an issue/expiry window (`:371-382`); API cookies
  add a `PeerId` and are version 2, browser cookies are version 1 (`:32-55`, `:356-369`);
- the signing secret is a persisted credential record (`credentialKey('client-connection',
  'browser-session')`, `:12`), so cookies survive a Host restart and are per-authority.

The live probes confirm the ordering: no cookie → 401 on both `/` and `/scale-commander/api/*`;
foreign Host header → 403; unknown path *under* the plugin prefix → still 401 because the fence runs
before routing ([live-http-probes.txt](evidence/dsh/live-http-probes.txt)).

**Option B: `ctx.connection.fetch.register`.** Exact routes under `/api`, Fetch in/out, body mode
declared, and only **owner Peers** reach them; the shared handler answers 403 for other principals
(`packages/client/connection/src/rpc.ts:153-176`). No manual auth code.

**Option C: `ctx.connection.rpc.handle(channel, handler)`.** Logical RPC channels carried by the
current transport, including streaming (`rpc.ts:178-225`).

**Option D: generated `@Remote` RPC (`ctx.remote.*`).** The pattern the first-party UI uses
(`@Remote(...)`-decorated service methods discovered by typert). It requires DSH's code generation
and package build; a plain-JS plugin bundle cannot opt in. **UNVERIFIED** for third-party use.

**Option E: WebSocket.** `webServer.registerUpgrade({path, handler})` plus
`connection.admitConnection(request)` which claims the socket for an API Peer
(`packages/host/webserver/src/index.ts:77-82`, `rpc-host.ts:144-162`).

Recommendation for Excalidraw: use **A + E** (prefix JSON API for commands, one upgrade route for
scene-change push) **or A + SSE** (a route that holds the response open — `WebRoute.handler`
explicitly may hold it, `webserver/src/index.ts:52-58`). Do not invent a second auth scheme: the
cookie is the only credential, and the fence must run before reading a body. Cap body size (the
reference uses 2 MiB → 413, `api.js:23`, `:208-228`) and never trust client-supplied identity.

---

## 4. Plugin-owned state, storage services, and sandbox implications

### 4.1 `$DSH_HOME` and what lives there

`resolveDshHome` honours an explicit path, then `$DSH_HOME`, then `~/.dsh`; `dshHomePath(...)`
joins onto it (`upstream/deepseek-harness/packages/util/home-paths/src/index.ts:135-160`). The
**live** home contains `profiles/`, `sessions/`, `storages/`, `skills/`, `cache/`, `attachments/`,
plus plugin-owned directories `scale-commander/` and `hypit-studio/`
([live-profile.txt](evidence/dsh/live-profile.txt)). The convention is visible in the reference
plugin's `resolveDataDir`: configured path, else `join(DSH_HOME, 'scale-commander')`
(`src/host/index.js:46-52`), created with `mkdirSync(..., {recursive:true})` in `apply`.

### 4.2 Options for plugin state, ranked by cost

| Option | Use for | Contract / caveat |
|---|---|---|
| Plugin-owned dir `$DSH_HOME/<plugin-id>` | caches, libraries, indexes, SQLite sidecars | survives reinstall/repointing; files are plain; **you own migrations, locking, atomicity** |
| `ctx.storageDomain` (domain KV) | typed records with schema + change events | declare a `DomainSpec` (name `UNIT_NAME_RE`, version, layout `single`/`per-record`, zod tables), `open(spec)` and close it yourself in an effect (`packages/storage/storage-domain/src/spec.ts:35-105`; lifecycle note `src/index.ts:84-103`). Backends are `json` (one file per unit) and `sqlite` (`packages/storage/README.md:20-26`). Live-composed base config: `storage-json` root `!!js dshHomePath('storages')`, `storage-domain` backend `json` ([dump lines 95-104](evidence/dsh/experiment/dump-config-after-add.txt)) |
| Working directory + `ctx.fs` | user-facing files (the `.excalidraw` scenes) | `ctx.fs` writes/edits take a `sandboxPolicy` and return versioned outcomes; use `ctx.workingDirectory` for the session directory (`workingDirectory` service: `defaultDirectory`, `get`, `ensure`, `set`) |
| `ctx.credentials` | secrets | two key spaces (refs and records); never return values to the browser; the reference plugin mirrors its vault into it when mounted (`src/host/vault.js`) |
| Session log events | **not allowed** | no new event `type` (unknown stored events need `ignorable: true`, which live `Session.append` cannot set); `appendPluginRecord` is reserved for DSH experimental packages (installed skill reference `references/practices.md:21`) |

### 4.3 Sandbox implications

- Sandboxing confines **subprocess execution** (`bash`/`subprocess` tools): modes `read-only`,
  `workspace-write`, `danger-full-access`, with per-platform backends (macOS Seatbelt, Linux
  bwrap/Landlock, Windows ACL) and one-time escalation on denial —
  `upstream/deepseek-harness/packages/sandbox/README.md:1-10`.
- **Plugin Host code is not sandboxed.** It runs in-process in the Host's Node runtime with full
  filesystem/network privileges. The reference plugin writes SQLite and a secret sidecar under its
  own DSH_HOME directory with `node:fs`/`node:sqlite`, and serves HTTP routes — none of that passes
  through the sandbox.
- Therefore the plugin must do its own path discipline: resolve and validate every path the agent
  or the browser asks it to touch, keep scene files inside the workspace unless the user says
  otherwise, and use temp-file + rename for atomic writes. If it wants the *session's* directory,
  read it from `ctx.workingDirectory`, not from `process.cwd()`.

For Excalidraw this splits cleanly: **scene files** are ordinary workspace files (agent tools and
the editor both address the same paths through the Host service); **plugin state** (scene index,
libraries, undo snapshots) goes to `$DSH_HOME/dsh-excalidraw/`; **secrets** (none planned) would go
through `ctx.credentials`.

---

## 5. Reference plugin walkthrough (mechanism only)

Root: `/Volumes/ZHITAI/ScaleInsights插件开发/package` (read-only).

| File | Mechanism | Evidence |
|---|---|---|
| `package.json` | `type: module`; `exports` includes `"."`, `"./client"`, `"./locale/*.json"`, `"./icon"`; `dsh.bundle.patch`, `dsh.client {platform:'web', immediately:true, inject:[…4 client packages]}`; `files` ships `lib/index.js`, `lib/client.js`, `lib/host/*.js`, patch, locales, icon | `:1-45` |
| `cordis.patch.yml` | one `insert` row `id: scale-commander`, `name: '@local/dsh-scale-commander'`, full `config` block; comment states one Host row owns storage, client, engine, scheduler, HTTP API and tools | `:1-21` |
| `build.mjs` | locates the package by walking up to a `package.json` with `dsh.bundle.patch`; copies `src/host`+`src/shared` to `lib/`; writes `lib/index.js` re-exporting named exports **with no default export** (comment: the Loader prefers `exports.default` and then reads `inject` off it, so the namespace must carry `apply` and `inject` side by side); bundles the browser half with esbuild (`--format=iife --global-name=__scaleCommander --jsx=automatic`), externals `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`; wraps the IIFE in `window.__ModuleLoader__.load({id, factory(require){…return __scaleCommander}})`; the factory receives `require`, so React resolves from the page table | `:30-119` |
| `lib/index.js` | 1-line re-export: `export { apply, inject, PLUGIN_ID, resolveDataDir, resolvePassphrase } from './host/index.js'` | `:1` |
| `src/host/index.js` | `export const inject = ['tools']` (tools required; web carrier optional); `resolveDataDir`/`resolvePassphrase`; `apply` builds `Store` (SQLite), `Repository`, `CredentialVault` (mirrors into `ctx.get('credentials')`), services, `ApiServer`; **every resource is an effect**: `ctx.provide('scaleCommander')` + effect disposer, `ctx.inject(['webServer'], … webServer.register prefix …)`, scheduler start/stop effect, providers+store close effect, tool disposer aggregator effect; `normalizeConfig` clamps every value | `:34-43`, `:60-197`, `:203-272` |
| `src/host/api.js` | `API_PREFIX='/scale-commander/api'`; regex router `method + '/path/:param'`; `handle()` runs `this.admit(req)` first (Connection fence), parses URL under the prefix, caps JSON body at 2 MiB, returns `{ok:true}`/result, and maps `ApiError`/unknown errors to `{error:{code,message,details?}}` with status; sets `x-request-id` | `:20-23`, `:44-51`, `:150-228` |
| `src/host/tools.js` | hand-written `ToolDefinition`s: `ctx.tools.register({name, description, parameters: compileParameterSchema(...), output:{schema, render}, presentCall, execute})`; `execute` catches errors into `{error:{code,message}}`; `compileParameterSchema` turns a compact `{prop:{type, required, description, items, properties}}` DSL into object-rooted JSON Schema (explicit comment: linked plugins may not have access to runtime modules, so it does not import a Harness schema helper); 12 tools, each a thin wrapper over the same service the browser uses | `:14-60`, `:308-345` |
| `src/client/index.jsx` | `apply(ctx)`: `ctx.effect(() => ctx.locale.register(NS, {en, zh}), label)`, `t = ctx.locale.bind(NS)`, `ctx.effect(style inject → () => style.remove())`, `ctx.slots.inject('main', () => ctx.slots.register({name:'main', key:PANEL_ID, locale, inject:()=>({toasts})}, Page))`, same for `sidebar.panellist` with `{id, order:20, locale, label:()=>t('panel')}` | `:46-75` |
| `src/client/panel.js` | the page component: tabs, resources, modals, toasts; calls `globalApi`/`accountApi` from `client/lib/api.js` | `:1-120` |
| `src/client/lib/api.js` | `fetch(API_BASE + path, {credentials:'same-origin'})`, JSON envelope parsing, `ApiFailure(code,message,status,details)` — no plugin auth | `:10-72` |
| `src/client/lib/state.js` | `useResource(load, deps)` with a generation counter so a late response cannot overwrite a newer one; `usePersistent` | `:67-120` |
| `src/host/store.js` | `node:sqlite` database file `<dataDir>/scale-commander.sqlite`, `close()` in an effect | used by `src/host/index.js:75-80`, `:194-197` |
| `locale/{en,zh}.json` | display metadata (`meta.title`/`meta.description`) + dictionaries | ship with the bundle |

**What is exemplary:** the effect discipline (everything has a disposer), the single prefix route +
Connection fence, the hand-written JSON Schema, the `exports["./client"]` + IIFE wrapper, the
`main` + `sidebar.panellist` pair, and the "normalize config" habit.

**What not to copy for Excalidraw:** 12 broad tools with in-band `confirm: true` (we want fewer,
typed tools and real approval where destructive); polling resources instead of a push channel; a
104 KB browser bundle (Excalidraw will be 30–50× larger — see §7); a monorepo-style single host
row that owns everything (keep the editor service, the API and the tools separable).

---

## 6. Minimal reproducible install/uninstall experiment (isolated `DSH_HOME`)

All paths are inside this workspace: `DSH_HOME=$PWD/.tmp/dsh-home`. The live profile was never
touched. Fixture kept at [experiment/fixture-plugin](evidence/dsh/experiment/fixture-plugin),
logs in [experiment/](evidence/dsh/experiment/).

### 6.1 Fixture

`.tmp/fixture-plugin/` — a dependency-free Host-only bundle:

```json
{ "name": "dsh-expt-fixture", "version": "0.0.1", "private": true, "type": "module",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "dsh": { "plugin": true, "kind": "server", "bundle": { "patch": "./cordis.patch.yml" },
           "client": { "platform": "web", "immediately": true } } }
```

`cordis.patch.yml`: one `insert` row `id: expt-fixture`, `name: dsh-expt-fixture`, `config:
{label: hello-from-fixture}`. `lib/index.js` exports `name`, `inject = []`, and `apply` that logs
`apply` + registers one sync and one async `ctx.effect` writing to `$FIXTURE_EVENT_LOG`.

### 6.2 Install, compose, boot, remove (exact commands)

```sh
export DSH_HOME=/Volumes/ZHITAI/DSHExcalidraw/.tmp/dsh-home

# 1. install (offline, local directory; pnpm 11.28.5 from the app runtime)
dsh plugin --profile exp1 add /Volumes/ZHITAI/DSHExcalidraw/.tmp/fixture-plugin
#   -> exit 0; stderr: dsh: initialized profile exp1 at .../profiles/exp1
#   -> pnpm: + dsh-expt-fixture 0.0.1 <- ../../../fixture-plugin   (288 ms)

# 2. compose
dsh --profile exp1 --dump-config          # exit 0, 365 lines, ends with the fixture row

# 3. boot the isolated profile with lifecycle logging, then stop it
FIXTURE_EVENT_LOG=$PWD/.tmp/events.log timeout -s TERM 15 dsh --profile exp1
#   -> runs until SIGTERM (timeout exit 124), no stdout/stderr

# 4. uninstall
dsh plugin --profile exp1 remove dsh-expt-fixture    # exit 0, 207 ms

# 5. compose again
dsh --profile exp1 --dump-config          # exit 0, 360 lines, 0 occurrences of the fixture
```

Observed state changes (verbatim outputs in
[plugin-add](evidence/dsh/experiment/plugin-add.stdout.txt) /
[plugin-remove](evidence/dsh/experiment/plugin-remove.stdout.txt)):

| Artefact | After add | After remove |
|---|---|---|
| `profiles/exp1/package.json` | `dependencies["dsh-expt-fixture"] = "link:/Volumes/ZHITAI/DSHExcalidraw/.tmp/fixture-plugin"`; `dsh.profile.bundles = ["@deepseek-ai/dsh-base", "dsh-expt-fixture"]` | dependency gone; `bundles = ["@deepseek-ai/dsh-base"]` |
| `node_modules/dsh-expt-fixture` | symlink → fixture dir | **dangling symlink remains** (pnpm `link:` artefact) |
| `pnpm-lock.yaml` | updated | updated |
| composed tree | fixture rows at lines 361-365 (`# == dsh-expt-fixture`) | 0 occurrences |

Booting the isolated profile proves the **host export shape** is honoured: `apply` ran with the
patch config (`2026-10-27T20:54:51.886Z apply {"label":"hello-from-fixture"}`), i.e. named
`export function apply` + `export const inject` + the row's `config` is the working rc.2 form. The
profile itself is `@deepseek-ai/dsh-base` only (no app command), so the process idled until SIGTERM
— which is what made it a clean shutdown test.

### 6.3 Disposal measurements (the point of the experiment)

Six shutdown trials of the same fixture, each `timeout -s TERM 6..20`:

| Trial | sync disposer | async disposer start | async disposer end | process-exit code |
|---|---|---|---|---|
| [1](evidence/dsh/experiment/fixture-events-1.log) | ✅ | ✅ | ❌ (exit 9 ms later) | 0 |
| [2](evidence/dsh/experiment/fixture-events-2.log) | ✅ | ✅ | ✅ (+58 ms) | 0 |
| [3](evidence/dsh/experiment/fixture-events-3.log) | ✅ | ✅ | ❌ (exit 9 ms later) | 0 |
| [4](evidence/dsh/experiment/fixture-events-4.log) | ✅ | ✅ | ❌ (exit 9 ms later) | 0 |
| [5](evidence/dsh/experiment/fixture-events-5.log) | ✅ | ✅ | ❌ (exit 10 ms later) | 0 |
| [6](evidence/dsh/experiment/fixture-events-6.log) | ✅ | ✅ | ❌ (exit 10 ms later) | 0 |
| [earlier 300 ms variant](evidence/dsh/experiment/fixture-events.log) | ✅ | ✅ | ✅ (+300 ms) | 0 |

Interpretation: fiber disposal **does** await disposers in-process — trial 2 waited the full 58 ms
and the 300 ms variant waited 310 ms — but the **process exit path can win the race**: five of six
50 ms trials exited ~9 ms after starting the async disposer and never recorded its completion.
Practical rule: treat async cleanup at shutdown as best-effort; persist before returning.

### 6.4 What this experiment does NOT verify

Live-profile installation; activation through HMR; the browser half (`lib/client.js` was present but
no page was connected, so no slot registration was observed); `plugin_manager install_bundle`;
uninstall while the app is running; behavior of a bundle whose `dsh.client` composes into the live
graph. Those need a page-connected session and the sanctioned installer.

---

## 7. Risks for a 3–5 MB client bundle

Mechanisms below are from source; magnitudes are qualitative and marked.

1. **No compression by default.** `webServer` config defaults `compression: 'none'`
   (`packages/host/webserver/src/index.ts:119-127`). Bundle responses are served with immutable
   cache headers but uncompressed unless the profile sets `compression: 'gzip'`. On loopback this
   is acceptable; over `--remote`/SSH it is a real cost. *Mitigation:* gzip in the profile row or
   ship smaller chunks.
2. **One classic script, executed at every page boot.** Every client entry is a plain
   `<script src>` combo (`packages/client/modules/src/client/system.ts:15-28`); all manifest rows
   are imported and activated at boot and a failed import fails startup
   (`packages/client/web/src/boot-client.ts:36-60`). `immediately: true` only moves the fetch into
   the stage-one prefetch tier (`manifest.ts:52-65`) — **it does not avoid loading the entry**. A
   5 MB `client.js` is therefore parsed and its factory executed on every page load, for users who
   never open the editor. *Mitigation:* keep the entry factory tiny and `require.async` the editor
   chunk on first open (see item 6).
3. **Batch concatenation.** Combo URLs concatenate several plugins' bundles into one response
   (`packages/client/modules/src/index.ts:270-286`, `840-860`). A 5 MB row makes the boot response
   ≥5 MB for everyone in that batch.
4. **Page-lifetime retention.** The loader memoizes materialized modules in `loadCache` for the
   page's lifetime (`manifest.ts:9-20`, `417-427`); the entry's exports, closures and any
   module-level caches stay resident even after the panel closes. The keyed `main` slot renders
   only the selected key, so the page component itself does unmount on deselection
   (`ui-layout/src/client/AppFrame.tsx:40-43`), but module scope does not — release large
   documents/scene copies in an unmount effect, not in module state.
5. **Only 12 externals; everything else is inside the bytes.** Excalidraw + its deps (and any
   shape-library code) must be bundled; no CDN, no `node_modules` at runtime. *Mitigation:* same as
   any web app — tree-shake, minify, avoid duplicate React (already external).
6. **Chunk support exists but is manual.** The loader accepts package-local chunks named
   `client.<name>.js` next to `client.js` at the same `rev` and resolves them through
   `require.async(specifier)` (`index.ts:198-199`, `290-294`; `manifest.ts:349-361`). esbuild's
   IIFE format cannot code-split, so a split build must emit the chunk files explicitly (two esbuild
   entries, or ESM + a wrapper). This is the main lever to keep boot cost flat. **UNVERIFIED**:
   no first-party plain-JS plugin in this install ships chunks; I did not exercise `require.async`.
7. **Fonts and WASM cannot be package assets.** The `/plugins/<id>/assets/*` route resolves only
   `.svg`, `.png`, `.webp`, `.jpg`, `.jpeg` and returns **404** for anything else
   (`packages/client/modules/src/assets.ts:18-24`; `index.ts:1214-1225`). Excalidraw's woff2 fonts
   (and any wasm) must be inlined into the bundle (base64 → +33 % size) or served by a **custom
   Host route** with correct `content-type`/cache headers. The custom route is preferable: it also
   keeps fonts out of the boot script.
8. **HMR/replacement re-downloads the whole module.** Revision is mtime/ctime/size based
   (`index.ts:219-224`); every rebuild invalidates the module, tears down the fiber, removes owned
   styles and re-imports (`entries.ts:163-200`). During development, a 5 MB bundle means a
   multi-second reload each edit. *Mitigation:* build the light client half for UI iteration and
   keep the editor chunk for when it is actually needed; or develop against a smaller scene.
9. **Main-thread jank at first open.** Parsing/executing 3–5 MB plus Excalidraw's initial render
   blocks the UI thread. The module-table dialect documents no worker entry point for a plugin's
   client half, so plan the work on the main thread. *Mitigation:* lazy chunk, skeleton panel, and
   prefetch on hover of the sidebar icon.
10. **Version coupling.** The 12-word module table and `dsh.client` validation are the whole
    ABI (`parseDshClient` throws on malformed fields; `platform` must be `'web'`). A bundle built
    against rc.3 must be re-verified on rc.2 — the app it will run in. Keep the build pinned to the
    table's specifiers and fail the build if esbuild resolves any `@deepseek-ai/*` into the bundle
    (add a metafile check; the reference `build.mjs` only externalizes React).
11. **Transport details on the plugin's own request path.** The Host answers a bundle/chunk request
    by reading that file at request time (bodies are lazy) and it computes revisions from artifact
    metadata, not content (`index.ts:219-224`, `:776-780`). A stale `rev` in a browser cache is a
    **404**, not a stale script, so the boot graph and the files on disk must change together — DSH
    guarantees that at compose time; a plugin that rewrites its own `lib/client.js` while running
    must expect the next HMR/compose cycle, not a hot swap of bytes.

**Suggested budget for the Excalidraw plugin** (engineering recommendation, not measured): initial
`client.js` ≤ 300 KB (icon, launcher, panel shell, API client, locale) so boot cost stays flat;
editor chunk 3–4 MB loaded on first panel open via `require.async`; fonts/any WASM served by a Host
route under the plugin's own prefix; images as content-revisioned package assets;
`immediately: false` (keeps the entry out of the stage-one prefetch, nothing more).

---

## 8. What a DSH plugin can and cannot do (for this project)

**Can do (all verified in source or live):**

- one Host row owning a service, an HTTP API, timers, and agent tools, all disposed by the Loader;
- register typed agent tools with exact JSON Schema, custom rendering/presentation, timeouts,
  parallel-safety, per-step activation, and human approval;
- own a full-page browser UI in `main` plus a `sidebar.panellist` icon, with its own React tree,
  styles and locale, reading Host data over a same-origin cookie-authenticated route;
- persist plain files under `$DSH_HOME` and versioned user scene files in the workspace, atomically;
- ship assets (raster/vector images) through the package-asset route;
- install from a local directory with `plugin_manager install_bundle` or `dsh plugin add`.

**Requires source-level DSH changes or a separate app (not achievable from a plugin bundle):**

- replacing the shell's root/sidebar/settings seats (they are `single` slots already occupied by
  `ui-layout`/`ui-sidebar`/`ui-settings`); adding a *new* root-level surface is limited to the
  declared slots (`shell.bottom`, `shell.overlay`, `shell.leading`, `main` keys);
- an iframe-hosted page with host theme/locale (explicitly discouraged: the iframe loses theme
  tokens and `ctx.locale` — `references/practices.md:33`);
- new session event types (refused on reopen unless `ignorable`, which live append cannot set);
- a plugin-run HTTP server, custom protocol, or native window; the plugin must use `webServer`;
- importing arbitrary client npm packages at runtime, or requiring Harness Client packages;
- Worker threads for plugin client code: the module-table dialect has no worker entry point for a
  bundle's own code, so a 5 MB parse stays on the main thread;
- changing tool schemas/permissions of other plugins globally (`restrict` is agent-scoped only;
  `guard` only denies);
- native file dialogs / OS integration beyond what `directoryPicker` and `open-in-app` expose.

---

## 9. Open items for the next evidence pass

1. Client slot tree with a connected page (`Slots.listSubTree` for `main`, `sidebar.panellist`,
   `conversation.view`, `conversation.composer.dock`) — currently **UNVERIFIED** (timeouts, §0).
2. Exact live Config JSON Schema for the reference plugin (`Config.listConfigs` with `name`/`entry`)
   — blocked by the `input` rejection.
3. Live install/uninstall through `plugin_manager` (sanctioned path) with `application` states.
4. Empirical size/timing for a 3–5 MB bundle (parse, first paint, HMR rebuild) once the editor is
   scaffolded.
5. `require.async` chunk loading with a real two-entry build.
6. Whether the live profile sets `compression: 'gzip'` (reading it would require rewriting the live
   profile; not done).

---

## Appendix A — Evidence index

| File | What it is |
|---|---|
| [host-Service.listService.catalog.txt](evidence/dsh/host-Service.listService.catalog.txt) | raw live Host service catalog (86 KB; `tools`, `webServer`, `connection`, `storage`, `storageDomain`, `clientModules`, `workingDirectory`, `credentials`, `sandbox`-family, …) |
| [host-Tool.listTools.txt](evidence/dsh/host-Tool.listTools.txt) | raw live tool surface incl. the 12 reference-plugin tools and their published JSON Schema |
| [host-Config.listConfigs.p1.txt](evidence/dsh/host-Config.listConfigs.p1.txt) | raw live Config directory (204 entries, statuses) |
| [live-inspect-attempts.txt](evidence/dsh/live-inspect-attempts.txt) | exact failures for `input` queries and client-platform queries |
| [live-http-probes.txt](evidence/dsh/live-http-probes.txt) | unauthenticated / foreign-Host / unknown-path probes (401, 403, 404) |
| [live-profile.txt](evidence/dsh/live-profile.txt) | installation + profile topology, plugin data dirs under `$DSH_HOME` |
| [experiment/](evidence/dsh/experiment/) | fixture plugin, add/remove logs, composed dumps before/after, six lifecycle logs |
