# 03 — Competitive validation of three migration options

**Question:** what is the smallest reliable way to give DeepSeek Harness the core Obsidian Excalidraw capabilities — an interactive scene editor, durable `.excalidraw` persistence, and agent control — without copying the plugin?

Three candidate architectures were evaluated against the same criteria. The evaluation uses the pinned sources from [`01-upstream-evidence.md`](01-upstream-evidence.md), the platform contract in [`02-dsh-platform.md`](02-dsh-platform.md), and two executable experiments: the [render spike](05-render-spike.md) and the [Host tool probe](08-verification.md#agent-tool-execution-in-a-real-host).

> **Terminology, kept strict.** An **installable DSH bridge plugin** would run inside Harness but delegate drawing/persistence to an external Obsidian instance. A **standalone DSH drawing editor** is a Harness plugin that owns an interactive canvas and scene files itself, with no Obsidian runtime. This project delivers the second; option A below is the first. They are not the same product and are not scored as if they were.

---

## 1. The options

### A. DSH plugin that bridges the existing Excalidraw CLI

Harness exposes a thin tool surface that shells out to (or speaks a socket/HTTP protocol with) the Obsidian plugin's automation/CLI layer, and opens Obsidian for the human to draw.

### B. Port the necessary drawing engine and UI into a DSH-native plugin

Reimplement/repackage the Obsidian plugin's scene model, interaction layer and persistence inside a Harness plugin, replacing Obsidian APIs with Harness APIs.

### C. Extract a shared drawing core, provide a native DSH adapter, keep the Obsidian CLI as an optional backend

Define a host-independent scene/revision core, render it through a native DSH adapter, and (optionally, later) place an Obsidian-backed adapter behind the same interface.

The shipped implementation is **C′**, a deliberately narrower C: the native DSH adapter and shared core are real; the Obsidian backend is a documented seam, not code.

---

## 2. What the experiments actually showed

### 2.1 Option A is not runnable as described

| Finding | Evidence |
|---|---|
| There is no standalone `excalidraw` executable or `bin` entry in the upstream package. The `main` export is the `lib/` automation library, not an Obsidian plugin and not a CLI. | [`01-upstream-evidence.md` §2.3, §7](01-upstream-evidence.md); upstream `package.json` `main`/`types`; no `bin` field |
| The CLI that exists is an **in-process protocol inside the plugin** (`src/core/cli/*`, apiVersion 1, optimistic `expectedRevision`, receipts), hosted by a running Obsidian instance. It is a good protocol design input — not a process that can be started without Obsidian. | [`01-upstream-evidence.md` §7](01-upstream-evidence.md) |
| No Obsidian runtime was available in this environment, and the available machine has no verified headless Obsidian path. Therefore a bridge could not be built or tested here; claiming otherwise would violate the task's evidence rule. | environment note in [`01-upstream-evidence.md`](01-upstream-evidence.md) |
| A bridge would leave the human's interactive canvas inside Obsidian, not Harness. It cannot satisfy “user views and interactively edits a scene in Harness” or “the plugin owns file persistence” as one product. | requirement mapping in [`04-adr-0001.md`](04-adr-0001.md) |

**Conclusion:** A is rejected as the primary architecture because its central dependency (a live Obsidian host) is unverified, its product boundary contradicts the interactive-editor requirement, and it cannot produce a self-contained installable plugin. It remains a legitimate *future integration* direction once an Obsidian runtime is available.

### 2.2 Option B is technically possible but disproportionate and license-risky

| Finding | Evidence |
|---|---|
| The upstream plugin is 277 `.ts`/`.tsx` files and 106,925 lines, layered on Obsidian's `Plugin`/`TextFileView`/`Vault` APIs. | [`01-upstream-evidence.md` §1, §3](01-upstream-evidence.md) |
| It persists through a Markdown envelope with frontmatter, text-element sections, element-link and embedded-file sections, LZString chunks, and a revision-merge path that is explicitly not a CRDT. | [`01-upstream-evidence.md` §5–§8](01-upstream-evidence.md) |
| Its production build embeds the Excalidraw fork as a DEFLATE+base64 string and evaluates it with `win.eval`, because Obsidian's plugin model expects one bundle. That build is not reproducible from the repository alone. | [`01-upstream-evidence.md` §2.2](01-upstream-evidence.md) |
| The repository's `LICENSE` is AGPL-3.0 while `package.json` says MIT; the contradiction is unresolved upstream. A port that copies source inherits the risk. | [`06-license-audit.md`](06-license-audit.md) |
| Porting the whole UI would require reimplementing Obsidian's view, command, settings, workspace, file and script surfaces inside Harness — most of it outside the four required capabilities. | requirement permit in the task brief; [`01-upstream-evidence.md` §3](01-upstream-evidence.md) |

**Conclusion:** B is rejected. The task explicitly optimizes for behavior preservation with the smallest reliable implementation; 100k lines of AGPL-ambiguous code is neither small nor reliable, and most of it serves Obsidian-only features.

### 2.3 Option C was validated incrementally

The two riskiest assumptions were tested before committing:

1. **Can the genuine Excalidraw React component run as a DSH client bundle?**
   - The spike produced a loader-format bundle with React external, mounted it with the page's React 18.3.1 module table, drew a rectangle and arrow with real mouse input, typed text, called `updateScene`, and exported SVG/PNG. 28/28 DSH-format assertions passed; 19/19 standalone assertions passed; zero external network requests; local font assets only.
   - Bundle: 8.01 MiB raw / 2.39 MiB gzip / 1.84 MiB brotli (React not embedded).
   - Evidence: [`05-render-spike.md`](05-render-spike.md), [`docs/evidence/render/`](evidence/render/).
2. **Can a DSH Host plugin expose typed tools, an HTTP route and a durable store with the official lifecycle?**
   - The isolated install experiment, lifecycle tests and the real-Host probe proved: bundle row activation, five tools with object-rooted JSON Schema, `connection`-fenced HTTP routes, atomic revisioned writes, idempotent retries, stale-fence conflict, and read-back hash verification.
   - Evidence: [`02-dsh-platform.md` §1–§6](02-dsh-platform.md), [`08-verification.md`](08-verification.md).

Only after both passed did the implementation commit to C′.

---

## 3. Weighted comparison

Scores: 1 = worst, 5 = best. “Weight” reflects the task's stated priorities (behavior preservation, verifiability, minimal reliable implementation), not general product taste.

| Criterion | Weight | A — bridge | B — full port | C′ — shared core + native adapter |
|---|---:|---:|---:|---:|
| Host independence | 20% | 1 — requires Obsidian | 4 — Harness only, but Obsidian assumptions leak | **5** — Harness only; renderer is MIT and host-neutral |
| Data fidelity | 20% | 4 — the real Obsidian serializer, but only through a live host | 5 — could be exact if fully ported | **4** — exact for `.excalidraw` v2 and our subset; `.md` envelopes out of scope |
| Agent control | 15% | 3 — the upstream CLI protocol is good, but inaccessible here | 4 — possible | **5** — five typed tools, revision fences, idempotency, permission boundary |
| Development risk | 15% | 5 — little code, but the dependency is unverified | 1 — 100k LOC, Obsidian APIs, embedded eval runtime | **4** — two spikes retired the main risks; remaining risk is bundle size |
| Maintenance | 15% | 3 — tracks two fast-moving projects | 2 — fork-sized maintenance | **4** — small original core; pins one renderer version |
| License compliance | 15% | 3 — the bridge itself is small, but calls AGPL software at runtime | 1 — copies AGPL-ambiguous source | **5** — original MIT core + MIT renderer; upstream contradiction documented |
| **Weighted total** | 100% | **3.05** | **2.85** | **4.55** |

The scores are judgments, kept explicit so a reader can disagree with a weight rather than with an opaque verdict. The executable evidence is what removed the two fatal unknowns from C′; A and B were not selected because of structural dependencies, not because their scores were close.

---

## 4. Rejected routes, stated explicitly

- **Not doing:** reimplementing Obsidian's Markdown envelope, script engine, ExcalidrawAutomate surface, PDF/Mermaid pipeline, settings UI, or the Obsidian CLI transport in v0.1.
- **Not doing:** pretending the Obsidian CLI is a headless process. It is an in-process protocol and requires Obsidian.
- **Not doing:** an iframe that embeds a separate Excalidraw page. Harness plugin UI must be a React component in a slot; the spike and final plugin both mount the real component directly.
- **Not doing:** a static image preview as the “editor”. The E2E test asserts real canvas elements after real mouse/keyboard input.
- **Not doing:** treating a process exit code as persistence success. Every write returns evidence only after atomic write, fsync, read-back parse and SHA-256 match; tests corrupt/fence/recover the store.

---

## 5. What still needs an experiment

| Open question | Why it matters | Planned check |
|---|---|---|
| Can the 8 MiB client bundle be split into a small entry + package-local `client.<name>.js` chunks under the DSH loader? | Boot cost; the spike's split probe worked in a generic loader but was not installed in a profile | v0.2: build a chunked variant, install in an isolated profile, measure boot and drawing |
| Does `.excalidraw.md` import/export matter to the target users? | Obsidian users' existing drawings are Markdown envelopes | User discovery before implementing; a parser can be isolated behind the import tool |
| Does an Obsidian backend behind the same `SceneBackend` seam add real value? | The only honest path to option A later | Requires a runnable Obsidian environment; not claimed now |
| Does the plugin survive a Harness upgrade across 0.2.x? | Client loader and tool contracts are rc-versioned | Re-run `scripts/verify.mjs` + E2E against each new rc |

---

## 6. Evidence index

| Claim | Evidence |
|---|---|
| Upstream call path, format, CLI protocol, build facts | [`01-upstream-evidence.md`](01-upstream-evidence.md), [`docs/evidence/upstream/`](evidence/upstream/) |
| Harness plugin/tool/client/transport contracts | [`02-dsh-platform.md`](02-dsh-platform.md), [`docs/evidence/dsh/`](evidence/dsh/) |
| Genuine Excalidraw canvas viability and bundle numbers | [`05-render-spike.md`](05-render-spike.md), [`docs/evidence/render/`](evidence/render/) |
| Native Host tools, persistence, conflict/retry behavior | [`08-verification.md`](08-verification.md), [`docs/evidence/verification/`](evidence/verification/) |
| License contradiction and obligations | [`06-license-audit.md`](06-license-audit.md) |
