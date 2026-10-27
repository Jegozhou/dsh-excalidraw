# 08 — Independent verification

This document reports what was run, on which environment, with which result, and what remains unverified. The rule is the same as the task's: a result is evidence only when the command and its output can be reproduced.

## 1. Environment

| Fact | Value |
|---|---|
| OS | macOS on Apple silicon (`/Volumes/ZHITAI`, APFS) |
| Node | v24.15.0 |
| Package manager | pnpm 11.28.5 |
| DeepSeek Harness (live Desktop) | 0.2.1-rc.2 |
| DSH public clone used for source citations | 22ddee3792402c3e70ec5f86a63c3e3e895a2f60 (root version 0.2.1-rc.3) |
| Browser for E2E / spike | system Google Chrome (headless), Playwright-core |
| Excalidraw renderer | `@excalidraw/excalidraw@0.18.1` (MIT) |
| Upstream Obsidian Excalidraw | commit 9e52063296ffcd3b38d6a2bd5b23546d7e6268f7, package version 2.2.5 |

## 2. One-command Host verification

```sh
node scripts/verify.mjs
```

It runs, in order: TypeScript typecheck → production build (Host + client + assets) → unit tests → integration tests → packaging checks. The complete transcript is [`docs/evidence/verification/verify-transcript.txt`](evidence/verification/verify-transcript.txt).

Result: **VERIFY OK**.

| Suite | Tests | Result | What it proves |
|---|---:|---|---|
| `test/unit/elements.test.ts` | 12 | pass | Element factories, text measuring, links, prototype-pollution rejection, normalization, atomic ops, validation |
| `test/unit/store.test.ts` | 12 | pass | Atomic save evidence, revision fence, idempotency, two-instance concurrency, temp-file ignoring, corrupt-file backup recovery, sidecar reconciliation, name traversal, symlink rejection, invalid-file listing |
| `test/unit/lifecycle.test.ts` | 3 | pass | Five tools registered with object schemas; two web routes; provided service; tool execution; stale-fence and invalid-name envelopes; disposal removes everything; headless mode keeps tools |
| `test/unit/retry.test.ts` | 3 | pass | Repeated apply/save request ids return committed facts without a second mutation; app-state merge |
| `test/integration/api.test.ts` | 11 | pass | Real loopback HTTP: health, create/list/read/save, stale save 409, invalid name, invalid scene, editor status, auth fence on API and assets, asset MIME types and traversal, unknown routes, 25 MiB body rejection, service/tool parity |
| `test/integration/fixtures.test.ts` | 6 | pass | Golden corpus parse/validate/fixed-point, all documented categories present, ids and bindings intact, attachment round-trip, `.excalidraw.md` explicitly rejected, persistence through the real store |
| `test/integration/bundle.test.ts` | 9 | pass | Bundle/row/exports metadata, client loader id and external React, Host exports, version consistency, tool schemas, locale metadata, icon, asset route inputs |
| **Total** | **56** | **pass** | |

The transcript records per-suite timings (≈0.6 s typecheck, ≈0.7 s build, ≈0.6 s unit, ≈3.2 s integration).

## 3. Real-browser end-to-end (isolated Harness)

### Setup

A throwaway profile was created under a workspace-local `DSH_HOME`; the live Desktop profile was not used for the E2E:

```sh
export DSH_HOME="$PWD/.tmp/e2e-home"
dsh --profile e2e --from-default-profile web --dump-config   # creates base + web-app
dsh plugin --profile e2e add /Volumes/ZHITAI/DSHExcalidraw
dsh plugin --profile e2e add ./test/e2e/probe-bundle
dsh --profile e2e --no-open --port 49174 --host 127.0.0.1
```

The boot line prints a tokenized URL (`?token=…`); the token is redacted in the saved evidence (see [`isolated-install.txt`](evidence/verification/isolated-install.txt)).

### Test

```sh
DSH_E2E_URL='http://127.0.0.1:49174/?token=…' \
DSH_E2E_HOME="$PWD/.tmp/e2e-home" \
node test/e2e/dsh-ui.e2e.mjs
```

The driver is Playwright-core with system Chrome. It behaves like a person: dismisses the onboarding overlay, clicks the sidebar Excalidraw entry, creates a scene, selects tools from the real toolbar, drags on the interactive canvas, types text, presses `Cmd+S`, reloads the page and reopens the scene, then forces a concurrent-writer conflict and recovers by overwriting.

**Result: 13/13 steps passed.** Full JSON: [`e2e-report.json`](evidence/verification/e2e-report.json).

| Step | Assertion |
|---|---|
| Boot the isolated Harness page | Page loads; no plugin error in the boot audit |
| Dismiss onboarding overlays | Modal no longer blocks the sidebar |
| Open the Excalidraw panel | `.dsh-exc-page` and the Excalidraw canvas exist |
| Create a scene | Canvas API becomes available; a real `<canvas>` element exists |
| Draw a rectangle with a real pointer drag | Live scene contains `rectangle` |
| Draw an arrow with a real pointer drag | Live scene contains `rectangle, arrow` |
| Create text with a real click and keystrokes | Live scene contains `rectangle, arrow, text` |
| Save with keyboard and verify the file | API revision 2; 3 elements; on-disk SHA-256 equals the API hash; sidecar revision/hash/actor correct; request id recorded |
| Host records that the editor mounted | `/health` shows `mounted: true`, scene name, size, no error |
| Reload and reopen the scene from disk | Canvas reconstructs the same three element types |
| Detect a concurrent writer and recover | External PUT makes revision 3; stale UI save shows the conflict banner with revision 3; **Overwrite anyway** produces revision 4 with four elements |
| Reload after recovery | Four elements survive: `arrow, rectangle, rectangle, text` |
| Browser console | No plugin errors |

Screenshots (inspected after the run):

- [`01-drawn.png`](evidence/verification/screenshots/01-drawn.png) — rectangle, arrow and typed text on the real canvas, with the scene list on the left.
- [`03-conflict.png`](evidence/verification/screenshots/03-conflict.png) — the conflict banner offering Reload / Overwrite, with revision 3 named.
- [`04-final.png`](evidence/verification/screenshots/04-final.png) — the recovered scene after reload with four elements.

The page-health record captured after the E2E run:
`{"mounted":true,"sceneName":"e2e-mvr6z2sy","elementCount":4,"width":945,"height":815,"build":"0.1.0","error":null}`.

## 4. Agent tool execution in a real Host

The UI test proves the human path. A second, test-only probe bundle proves the agent path against the real Harness tool registry (not a fake context):

- It waits for the five `excalidraw_*` tools to appear in `ctx.tools.schemas()`.
- Calls `ctx.tools.register` output through `ctx.tools.get(name).execute(args)`.
- Creates a scene with rectangle + bound arrow + text, reads it, applies add/update/delete, retries the same request id, attempts a stale fence, attempts a path-escape name, validates the applied scene, lists it, and verifies the on-disk bytes, SHA-256, sidecar revision and actor.

**Result: `ok: true`.** Full JSON: [`agent-probe-report.json`](evidence/verification/agent-probe-report.json).

| Probe step | Result |
|---|---|
| tools visible | all five, exact names |
| create | revision 1, 3 elements |
| readBefore | revision 1, 3 elements |
| apply | revision 2; added 1, updated 1, deleted 1 |
| duplicateRetry (same request id) | revision 2, `duplicate: true`, no second mutation |
| staleFence | `revision_conflict`, `currentRevision: 2` |
| invalidName (`../escape`) | `invalid_name` |
| readAfter | revision 2, 4 elements |
| validate | `valid: true`, no diagnostics |
| diskEvidence | file exists, 3368 bytes, SHA-256 equals the tool result, meta revision 2, `updatedBy: "agent"`, 4 elements |

The probe is test-only code under [`test/e2e/probe-bundle/`](../test/e2e/probe-bundle/) and is not part of the shipped plugin.

## 5. Installation and lifecycle evidence

| Surface | Result | Evidence |
|---|---|---|
| Live Desktop profile, official `plugin_manager install_bundle` | Package installed, bundle appended, `application: restart-required` (`package-moved`), exit code 0. The plugin is present in `dsh.profile.bundles`; it will load on the next Harness restart. | [`live-install.txt`](evidence/verification/live-install.txt) |
| Isolated profile, CLI `dsh plugin add` | Profile created from the shipped `web` template; bundle appended; instance boots with the plugin and serves `/dsh-excalidraw/api/health` | [`isolated-install.txt`](evidence/verification/isolated-install.txt) |
| Activation/disposal without a Harness process | Five tools, two routes and the provided service are registered; disposal removes all of them | `test/unit/lifecycle.test.ts` |
| Tool registration in a real Host | Five tools visible and callable | agent probe above |

The live Desktop install was **not** forced to restart: restarting would terminate the session running this work. The plugin was fully exercised in the isolated instance, and the live profile is left with the verified bundle in place, pending restart. This distinction is repeated in the final report rather than blurred.

## 6. Golden corpus

Upstream repository search found **zero** `.excalidraw` payloads at the pinned commit, so the corpus was generated with the MIT Excalidraw 0.18.145 runtime and its provenance is disclosed in [`fixtures/upstream/manifest.json`](../fixtures/upstream/manifest.json):

- `text-and-labels.excalidraw` — standalone text, bound labels, frame membership, element links;
- `arrows-bindings.excalidraw` — two arrows, both-end binding, one-end binding, orbit bindings;
- `image-attachment.excalidraw` — an image element with a real PNG, 40-char SHA-1 file id;
- `freedraw-pressure.excalidraw` — points + parallel pressures;
- `metadata-uncompressed.excalidraw.md` and `compressed-attachment.excalidraw.md` — Obsidian envelopes, included to test the *declared unsupported* boundary.

Our tests require: parse, validate, no unsupported types, normalization is a fixed point, ids unique, every binding target exists, every image file exists, and the real store persists/reloads a fixture semantically unchanged. The Markdown envelopes are asserted to fail with a clear JSON-format message — they are not silently misread.

## 7. What is proven, what is inspected, what is unverified

### Automated and reproducible

- 56 Host/core tests, including corruption, concurrency, idempotency, permission boundaries and lifecycle disposal.
- 13-step real-browser E2E including a concurrent-writer conflict and recovery.
- Five agent tools executed in a real Harness Host with disk-hash verification.
- Golden-corpus round-trip and reference integrity.
- Packaging assertions (loader id, React external, object-rooted tool schemas, locale metadata, icon, assets).

### Human-inspected

- The three E2E screenshots were opened and reviewed: the canvas shows the drawn rectangle, arrow and text; the conflict banner names revision 3 and offers both recovery actions; the final scene shows four elements. This is a visual sanity check, not an automated pixel-diff.

### Not verified (stated, not hidden)

- **A full model-driven conversation** (`natural language → the LLM chooses the tool → result`) was not executed, because the isolated profile has no model credentials. The tools themselves were invoked through the same registry the model uses; the only unverified link is the model's tool-selection behavior, which belongs to the Harness/LLM, not this plugin.
- **Restart of the live Desktop profile.** The install is recorded as `restart-required`; the plugin is not claimed to be active in the live page until that restart happens.
- **Windows/Linux**, non-Chrome browsers, and remote/HTTPS deployments of the Harness Web UI.
- **`.excalidraw.md`** envelopes, Obsidian attachment externalization, Obsidian script engine, PDF/Mermaid, libraries and collaboration — explicitly out of scope.
- **True process-kill crash testing.** Crash states are simulated by leaving temp files, corrupting the scene, deleting/altering the sidecar and holding locks; the recovery logic is tested, but an actual `kill -9` at each fsync boundary was not.
- **Multi-user / multi-process throughput.** The lock is a file lock with stale recovery; it was tested with two `SceneStore` instances in one process, not across hosts or network filesystems.
- **Large-scene performance.** Element caps are enforced; a 5,000-element scene was not benchmarked for UI responsiveness.

## 8. Reproduce everything

```sh
# Host/core
node scripts/verify.mjs

# Golden corpus only
node --test test/integration/fixtures.test.ts

# E2E (requires an isolated Harness; see test/e2e/README.md)
DSH_E2E_URL='http://127.0.0.1:<port>/?token=<token>' \
DSH_E2E_HOME="$PWD/.tmp/e2e-home" \
node test/e2e/dsh-ui.e2e.mjs
```

The isolated profile and its data are under `.tmp/` and are ignored by git. The probe report, E2E report, screenshots and verify transcript are committed for reviewers who cannot rerun the environment.
