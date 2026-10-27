# 07 — Capability contract (v0.1)

This document is the contract the implementation is held to. It defines the scene data model, the persistence alphabet, the five tool schemas, revision and save semantics, error codes, permissions, lifecycle and the UI-to-Host surface. The code paths named here are the normative implementation; the tests in [`08-verification.md`](08-verification.md) are the evidence.

## 1. Actors and trust boundaries

| Actor | Capability | Boundary |
|---|---|---|
| Person | Views and edits scenes in the Harness `main` panel; saves and resolves conflicts | Browser session cookie; Harness `connection.requestRejection` admits the same-origin page |
| Agent | Calls the five tools; sees revisions and hashes | DSH tool registry; arguments are untrusted JSON and re-validated by the core |
| Host plugin | Owns the drawings directory, writes files, serves local assets | In-process Node code; path discipline is enforced by the plugin, not by a sandbox |
| Untrusted file content | May arrive as a `.excalidraw` dropped into the directory or as agent element input | Parsed with `assertSafeKeys`, validated, normalized, size-capped; cannot execute code |

There is **no arbitrary path input** on any surface. Tools and HTTP routes accept a *scene name* matching:

```text
^[a-z0-9](?:[a-z0-9._-]{0,63})$        and the name must not contain ".."
```

The name maps to `<drawingsDir>/<name>.excalidraw`; a resolved path that is not directly inside `drawingsDir`, a symlinked scene file, or a symlinked drawings root is rejected (`permission_denied`). See [`src/core/store.ts`](../src/core/store.ts) (`scenePath`, `init`, `read`).

## 2. Scene data model

The on-disk document is the public `.excalidraw` JSON v2 format:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://github.com/Jegozhou/dsh-excalidraw",
  "elements": [ /* Excalidraw elements */ ],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null,
    "gridModeEnabled": false
  },
  "files": {
    "<fileId>": {
      "id": "<fileId>",
      "mimeType": "image/png",
      "dataURL": "data:image/png;base64,...",
      "created": 1793136000000
    }
  }
}
```

### 2.1 Elements

The strict Agent input supports eight creatable types:

| Type | Required input | Notable generated fields |
|---|---|---|
| `rectangle`, `ellipse`, `diamond` | `x`, `y`, `width?`, `height?` | common style fields, seed, version, roundness |
| `arrow`, `line` | `x`, `y`, `points?` or width/height | `startBinding`/`endBinding`, arrowheads, bound elements |
| `text` | `x`, `y`, `text` | `fontSize`, `fontFamily`, `textAlign`, measured box |
| `freedraw` | `x`, `y`, `points` | pressures, `simulatePressure` |
| `image` | `x`, `y`, `width`, `height`, `fileId` | status/scale/crop; the fileId must exist in `files` |

The reader additionally preserves `frame`, `magicframe`, `embeddable` and `iframe`, so a document produced by Excalidraw with those elements can be opened and saved without dropping them. Unknown *well-formed element fields* are preserved on read/write; a field that would pollute a prototype is rejected. See [`src/core/types.ts`](../src/core/types.ts) and [`src/core/elements.ts`](../src/core/elements.ts).

**Compatibility caveat:** host-side text width is measured with a deterministic approximation (`measureTextWidth`), not a browser canvas. Excalidraw re-measures text when it opens the scene; an agent-authored text box can differ by a few pixels from a hand-drawn one. This is a declared partial-fidelity area, not a silent claim of pixel equality.

### 2.2 Attachments

- `files` is keyed by `fileId`; each entry must carry `data:image/(png|jpeg|gif|webp|svg+xml);base64,`.
- An image element must reference an existing file.
- Limits: 64 files, 8 MiB of data-URL characters per scene by default, config-tunable downward.
- Other attachment kinds (PDF, arbitrary binary) are out of scope. Obsidian's externalized `[[path]]` attachment model is not reproduced.

### 2.3 App state

Only `viewBackgroundColor`, `gridSize` and `gridModeEnabled` round-trip. Zoom, scroll, theme and selection are intentionally not persisted. Excalidraw's other `appState` keys are dropped on save, which keeps drawings deterministic but is narrower than Excalidraw's own save. Declared in [compatibility](09-compatibility.md).

## 3. Persistence contract

### 3.1 Directory layout

```text
<drawingsDir>/                          # default <DSH_HOME>/excalidraw/drawings
  <name>.excalidraw                    # the portable document
  .dsh-excalidraw/
    <name>.meta.json                   # revision sidecar
    backups/<name>.<revision>.excalidraw
    locks/<name>.lock                  # cross-process write lock
```

### 3.2 Revision sidecar

```json
{
  "schema": "dsh-excalidraw/revision@1",
  "name": "architecture",
  "revision": 7,
  "sha256": "…64 hex…",
  "byteLength": 4211,
  "elementCount": 12,
  "updatedAt": "2026-10-28T03:20:11.000Z",
  "updatedBy": "agent",
  "previousRevision": 6,
  "previousSha256": "…",
  "recentRequests": [
    { "id": "agent-2026-10-28-1", "revision": 7, "sha256": "…", "at": "…" }
  ]
}
```

Revision starts at 1 for a created scene. A file with no sidecar (dropped in externally) reads as revision 0 and is reconciled when first read/written. A hash mismatch between file and sidecar is treated as a crash/external edit: the **file wins**, the revision advances, and the actor is recorded as `recovery`.

### 3.3 Save-success semantics

A write is reported successful only after all of the following hold:

1. The operation ran under the per-name in-process queue **and** an exclusive cross-process lock file;
2. The expected revision matched (unless it is the explicit browser overwrite path);
3. The previous bytes were copied to `backups/`;
4. New bytes were written to a temporary file, `fsync`ed, renamed over the target, and the directory was fsynced (best effort);
5. The sidecar was written atomically;
6. The target was **read back**, parsed, element count compared, and its SHA-256 compared to the reported hash;
7. On any verification failure, the previous bytes are restored and the call fails with `io_error`.

Evidence returned to callers: `name`, `revision`, `sha256`, `byteLength`, `elementCount`, `savedAt`, `verified: true`, `duplicate`. The browser additionally shows the first 12 hex characters in its status bar.

### 3.4 Idempotency

- `request_id` is optional but recommended. The last 32 successful request ids per scene are remembered.
- A repeated request id returns the committed revision/hash with `duplicate: true` and **does not run the mutation again**. This check happens before the revision fence, so a network-failure retry whose original write committed does not produce a spurious conflict.
- A repeated `create` is still rejected by name existence; creating is not idempotent by request id because the name is the identity.

### 3.5 Crash and corruption recovery

| State | Behavior |
|---|---|
| Leftover `*.tmp-*` file | Ignored by listings and reads; never treated as a scene |
| Scene file corrupt, matching backup exists | Newest valid backup restored, revision advanced, `updatedBy: "recovery"` |
| Scene file valid, sidecar missing/stale | Sidecar rebuilt; revision advances from the sidecar's last value or 0 |
| Lock file left by a dead process | Considered stale after 30 s and reclaimed; a live lock times out with `scene_busy` |
| Sidecar corrupt | Treated as absent; the scene file is authoritative |

Tests: [`test/unit/store.test.ts`](../test/unit/store.test.ts) covers each row.

### 3.6 Concurrency

- Two writers with the same expected revision: exactly one wins; the other gets `revision_conflict` with `currentRevision`, `currentSha256`, `expectedRevision`, `updatedAt`.
- The UI never auto-merges. It offers **Reload from disk** and **Overwrite anyway** (a forced write that becomes the next revision and is recorded as `ui`).
- The revision merge is not a CRDT and does not attempt to merge element-level edits.

## 4. Agent tool contract

All tools are registered on the plugin context and visible to every agent in the profile. Every `parameters` document is an object-rooted JSON Schema with `additionalProperties: false`; the Host re-validates at runtime because the schema is a contract, not the security boundary. The exact schema source is [`src/host/schema.ts`](../src/host/schema.ts).

Tool results are canonical JSON rendered as text. Failures are returned as `{ "ok": false, "error": { "code", "message", "details"? } }` so the model sees the stable code and reason instead of a transport exception.

### 4.1 `excalidraw_scene_list`

Input: `{}`.

Result: `{ ok: true, scenes: SceneSummary[] }`, where each row is `{ name, revision, elementCount, byteLength, updatedAt, updatedBy, sha256, valid }`. Unreadable files are reported with `valid: false` rather than failing the listing.

### 4.2 `excalidraw_scene_read`

Input:

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Scene name |
| `include` | `full` \| `summary` | no | default `full` |
| `element_type` | string | no | filter in `summary` mode |

Result (full): `{ ok, name, revision, sha256, updatedAt, updatedBy, byteLength, scene }`. Summary: element metadata (`id`, `type`, `x`, `y`, `width`, `height`, text for text elements, `isDeleted`) and the file ids.

### 4.3 `excalidraw_scene_create`

Input: `name` (required), `elements` (array of the strict element input), `app_state`, `files`, `request_id`.

Behavior: fails with `already_exists` if the file exists; otherwise writes revision 1 with save-evidence semantics. Arrow inputs can bind to explicit element ids in the same call via `startElementId`/`endElementId`.

Result: `{ ok, name, revision, sha256, byteLength, elementCount, savedAt, verified, summary }`.

### 4.4 `excalidraw_scene_apply`

Input:

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | |
| `expected_revision` | number | yes | from a recent read |
| `operations` | array (1–500) | yes | `add` \| `update` \| `delete` |
| `app_state` | object | no | subset merged over the stored state |
| `request_id` | string | no | idempotency key |

Operations are applied to a deep copy and validated as a whole; one bad operation rejects the entire call. `update` accepts only the declared visual patch fields; `delete` tombstones the element, removes references from arrows, and deletes bound text descendants. Bindings are repaired both ways (arrow → target and target's `boundElements`).

Result: `{ ok, name, revision, previousRevision, sha256, byteLength, elementCount, savedAt, verified, duplicate, operations:{added,updated,deleted,ids}, summary }`.

### 4.5 `excalidraw_scene_validate`

Input: `scene` (a complete `.excalidraw` object). Does not touch the store. Returns `{ ok, valid, diagnostics[], stats }` with structural errors, duplicate ids, unsupported types, invalid attachment data and bounds.

## 5. HTTP contract (browser half)

Base: `/dsh-excalidraw/api`, all same-origin, `credentials: same-origin`, admitted by `ctx.get('connection').requestRejection(req)` first. Errors use `{ error: { code, message, details? } }` with the `SceneError.status`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Plugin version, drawings dir, limits, last editor lifecycle evidence |
| GET | `/scenes` | Listing |
| GET | `/scenes/:name` | Full scene + revision + hash |
| POST | `/scenes` | Create (`{name, elements}`); the UI creates empty scenes |
| PUT | `/scenes/:name` | Save full scene (`{scene, expected_revision, request_id, force?}`) |
| POST | `/editor-status` | Browser lifecycle evidence (`mounted`, `canvas-ready`, `saved`, `unmounted`, `error`) |

`GET /dsh-excalidraw/assets/*` serves the Excalidraw CSS, font and locale files (whitelisted extensions, containment checked, `font/woff2`/`text/css`/etc.). This route exists because Harness's generic package-asset route is images-only (evidence: [`02-dsh-platform.md` §4](02-dsh-platform.md)).

## 6. Error codes

| Code | HTTP | Meaning |
|---|---:|---|
| `invalid_name` | 400 | Name fails the alphabet or contains `..` |
| `not_found` | 404 | Scene/element/file does not exist |
| `already_exists` | 409 | Create collided with an existing scene |
| `invalid_scene` | 422 | Structural document error |
| `invalid_operation` | 422 | Bad tool operation/patch/arguments |
| `revision_conflict` | 409 | Expected revision no longer current |
| `scene_busy` | 423 | Lock held by another writer past the timeout |
| `too_large` | 413 | Scene/attachment/request exceeds a cap |
| `too_many_elements` | 422 | Element cap exceeded |
| `permission_denied` | 403 | Path escape, symlink, or unauthenticated request |
| `corrupt_scene` | 500 | File unreadable and no valid backup |
| `io_error` | 500 | Write/read-back verification or OS failure |
| `unsupported_element` | 422 | Element type outside the readable range |
| `duplicate_id` | 409 | Element id already exists |
| `invalid_reference` | 422 | Binding or image file reference is missing |

## 7. Plugin lifecycle and configuration

- `export const inject = ['tools']` on the Host; tool registration is an effect, so unload removes them.
- `ctx.inject(['webServer'], …)` registers the two prefix routes; a headless composition keeps the store and tools and serves no HTTP.
- `ctx.provide('excalidrawScenes', service)` exposes the service; disposal removes it.
- Client `inject = ['locale', 'slots']`; locale, styles, asset path, `main` page and sidebar icon are all effects.
- Config is normalized and clamped in `src/host/index.ts`; unknown keys are ignored. Tunables: `drawingsDir`, `maxSceneBytes`, `maxElements`, `maxFiles`, `maxTextLength`.

The lifecycle test executes the plugin against a fake Cordis context, calls a tool, then disposes every effect and asserts that tools, routes and the provided service are gone ([`test/unit/lifecycle.test.ts`](../test/unit/lifecycle.test.ts)).

## 8. Editor lifecycle evidence

The browser reports to `/editor-status`:

- `mounted` with build id, canvas size and theme when the page mounts;
- `canvas-ready` with the live element count when the Excalidraw API is ready;
- `saved` with scene name, revision, sha256 and element count after a verified save;
- `unmounted` when the page effect is disposed;
- `error` if activation fails.

The Host exposes the accumulated state through `/health` (`editor.mounted`, `events`, `elementCount`, `width`, `height`, `build`, `error`). The E2E test asserts this evidence rather than trusting the UI's own success text.

## 9. Versioning and change rules

- Sidecar schema is `dsh-excalidraw/revision@1`; readers reject an unknown schema and rebuild from the file.
- Tool names and argument names are stable for v0.1. Adding fields is allowed; renaming or changing semantics requires a version bump and a compatibility note.
- The `.excalidraw` document is owned by Excalidraw, not by this plugin; the plugin's own extensions live in the sidecar and in the `source` string only.
- A Harness release that changes the client-loader format, tool contract or `connection` service requires re-running the E2E before claiming compatibility.
