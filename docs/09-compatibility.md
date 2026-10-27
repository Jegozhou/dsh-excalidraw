# 09 — Supported, partially compatible, and unsupported

The compatibility range is deliberately narrow. It is defined by what the automated tests actually cover, not by what the upstream plugin can do.

## 1. Formats

| Format | Status | Notes |
|---|---|---|
| Plain `.excalidraw` JSON, `type: "excalidraw"`, `version: 2` | **Supported** | Read, validated, edited, written. This is the format Excalidraw itself saves/loads. |
| Obsidian `.excalidraw.md` envelope | **Unsupported** | Frontmatter + text/link/embedded sections + `json`/`compressed-json` fence + LZString chunks. The parser rejects it with a clear “not valid JSON” error; tests assert the rejection. |
| Legacy Obsidian `.excalidraw` (tab-indented raw scene) | **Supported if it is valid JSON** | Whitespace is irrelevant to the parser; the plugin writes 2-space JSON. |
| Excalidraw library files (`.excalidrawlib`) | **Unsupported** | Out of scope. |
| Encrypted / password-protected scenes | **Unsupported** | Out of scope. |
| Externalized attachments (`[[path]]` instead of data URLs) | **Unsupported** | Our image attachments are data URLs in the `files` map. |

## 2. Element types

| Type | Read | Create from Agent | Edit (moving/style) | Notes |
|---|---|---|---|---|
| rectangle | yes | yes | yes | default roundness `{type:3}` |
| ellipse | yes | yes | yes | |
| diamond | yes | yes | yes | |
| arrow | yes | yes | yes | bindings to element ids; arrowheads; no elbow editing in v0.1 |
| line | yes | yes | yes | |
| text | yes | yes | yes | host-side width approximation; Excalidraw re-measures |
| freedraw | yes | yes | limited | points/pressures preserved; no per-point editing tool |
| image | yes | yes | limited | requires `fileId` + image data URL; no crop/scale editing through tools |
| frame / magicframe | yes | no | only x/y/size via UI | preserved; not created by tools |
| embeddable / iframe | yes | no | via UI | preserved; network content is the browser's responsibility |
| future/unknown types | **no** | no | no | rejected by the validator (`unsupported_element`) rather than silently dropped |

## 3. Document fields

| Field | Status | Notes |
|---|---|---|
| `elements` | Supported | validated and normalized |
| element ids | Supported | preserved; max 128 chars; uniqueness enforced |
| `boundElements` | Supported | reciprocal arrow bindings repaired |
| `containerId` (bound text) | Preserved | deleting a container tombstones its text children |
| `groupIds`, `frameId` | Preserved | grouping/frame membership visible in the UI |
| `link` | Sanitized | http(s), mailto, `#element`, wiki `[[…]]` survive; `javascript:` etc. become null |
| `customData` | Preserved | size-capped by the scene byte cap |
| `files` | Supported | image data URLs only |
| `appState.viewBackgroundColor` | Supported | |
| `appState.gridSize`, `gridModeEnabled` | Supported | |
| other `appState` (zoom, scroll, theme, selection, current item style) | **Dropped** | declared partial: files are smaller and deterministic, but zoom/theme don't round-trip |
| `source` | Set to this plugin on create; external values preserved | Not a signature |

## 4. Editing and persistence behaviors

| Behavior | Status |
|---|---|
| Draw/move/resize/delete elements in the real canvas | Supported (Excalidraw) |
| Undo/redo within the session | Supported (Excalidraw) |
| Save with `Cmd/Ctrl+S` / Save button | Supported |
| Autosave | Not implemented; explicit save is intentional so conflicts are visible |
| Revision fence / concurrent-writer detection | Supported |
| Reload from disk / overwrite recovery | Supported |
| Idempotent retries | Supported (`request_id`) |
| Crash recovery from backup | Supported (simulated crash states tested) |
| Merge concurrent element edits | **Unsupported** — no CRDT; conflict surfaces to the person |
| File rename/delete from the UI | Not implemented (files can be managed on disk) |
| Multi-scene tab editing | Not implemented; one scene at a time |

## 5. Rendering and assets

| Area | Status |
|---|---|
| Genuine Excalidraw canvas | Supported; React 18.3.1 from the page |
| Local fonts | Supported; all 234 woff2 files shipped (Latin + CJK); no CDN requested on the DSH page |
| Local locale chunks | Supported; all 55 shipped |
| Strict CSP with `font-src 'self'` | Local fonts load; Excalidraw's hardcoded esm.sh fallback attempts are blocked and harmless (measured in the render spike) |
| `.excalidraw` SVG/PNG export | Available in the library but not exposed in the UI (v0.2 candidate) |
| Theme | Follows the host light/dark detection; Excalidraw controls use its own theme prop |

## 6. Agent capability boundary

| Capability | Status |
|---|---|
| List/read/create/update/validate scenes | Supported |
| Add/update/delete elements, set background/grid, bind arrows | Supported |
| Set arbitrary element fields not in the strict patch schema | **Unsupported** — rejected rather than passed through |
| Read/write arbitrary file paths | **Unsupported by design** — scene-name alphabet only |
| Execute scripts, read PDFs, fetch URLs, run OCR | **Unsupported by design** |
| Merge text layout exactly as a browser would | Partial — deterministic approximation |
| Verify a save from another process | Supported via revision/hash read-back |

## 7. Host and deployment

| Surface | Status |
|---|---|
| DSH 0.2.1-rc.2, live client loader and tool registry | Verified |
| DSH 0.2.1-rc.3 public clone contract | Read and compared; no contradiction, but the running app is rc.2 |
| Headless composition (no `webServer`) | Supported; tools and storage still work |
| Remote/HTTPS Harness, Windows/Linux | Not tested |
| Multiple Harness processes sharing one drawings directory | File lock is best-effort; not tested across hosts/network filesystems |
| Plugin disable/uninstall cleanup | Covered by lifecycle tests; the assistant/route/service disappear with the effects |

## 8. Explicit non-goals

OCR, PDF, Mermaid-to-Excalidraw, the Obsidian script engine, a script marketplace, Obsidian note-graph integration, Excalidraw libraries, real-time collaboration, encryption, and a full Obsidian-compatible Markdown envelope are not implemented. Each would add a surface that is not required for the four core capabilities, and some would import AGPL code or an unbounded network/security surface.
