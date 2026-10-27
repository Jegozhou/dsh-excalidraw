# Documentation index

This repository is both the deliverable and its evidence trail. The order below follows the task: evidence → competing options → decision → contract → implementation → independent verification.

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 00 | **This index** | Map of claims to evidence |
| 01 | [Upstream evidence](01-upstream-evidence.md) | What the pinned Obsidian Excalidraw source actually does: build, call path, data format, automation/CLI protocol, dependency and reuse classification |
| 02 | [DSH platform contract](02-dsh-platform.md) | How a native Harness plugin is installed, activated, disposed, how tools and slots are registered, how the browser half talks to the Host, what a bundle costs |
| 03 | [Options comparison](03-options-comparison.md) | A bridge, a full port, and a shared-core native adapter, compared with executable evidence; rejected routes stated |
| 04 | [ADR-0001](04-adr-0001.md) | The accepted architecture (C′), its consequences and revisit triggers |
| 05 | [Render spike](05-render-spike.md) | Empirical proof that the genuine Excalidraw component runs in a DSH-format bundle: 19/19 + 28/28 assertions, bundle sizes, fonts, CSP, risks |
| 06 | [License audit](06-license-audit.md) | The upstream AGPL-3.0 vs MIT contradiction, fork/package licenses, the dependency closure, and what this project did about it |
| 07 | [Capability contract](07-capability-contract.md) | The data model, persistence semantics, five tool schemas, error codes, permissions, lifecycle |
| 08 | [Verification](08-verification.md) | 56 automated tests, the 13-step real-browser E2E, the real-Host agent probe, what is proven vs unverified |
| 09 | [Compatibility](09-compatibility.md) | Supported / partial / unsupported formats, elements, fields, editing and deployment surfaces |
| 10 | [Risks and evolution](10-risks-and-evolution.md) | Risk register, license obligations, and the minimal v0.2+ path |

## Evidence bundles

| Bundle | Contents |
|---|---|
| [`docs/evidence/upstream/`](evidence/upstream/) | Raw command outputs, dependency trees, format/CLI extracts, fixture generation and validation from the pinned Obsidian plugin |
| [`docs/evidence/dsh/`](evidence/dsh/) | Live inspect outputs, auth probes, isolated install/uninstall experiment and lifecycle logs for Harness |
| [`docs/evidence/render/`](evidence/render/) | Screenshots, JSON results, network logs, canonical element/serialization artifacts for the render spike |
| [`docs/evidence/verification/`](evidence/verification/) | Verify transcript, E2E report + screenshots, agent-probe report, live and isolated install evidence |
| [`docs/evidence/license-inventory.md`](evidence/license-inventory.md) | Bundled dependency licenses generated from the production esbuild metafile |

## Source map

| Path | Role |
|---|---|
| [`src/core/`](../src/core/) | Scene types, element factory/normalizer/validator, atomic mutation, revisioned store |
| [`src/host/`](../src/host/) | Cordis plugin, HTTP API, asset route, tool definitions and JSON Schemas |
| [`src/client/`](../src/client/) | Loader-format browser half: page, API client, locale, stylesheet |
| [`test/unit/`](../test/unit/) | Element, store, retry and lifecycle tests |
| [`test/integration/`](../test/integration/) | HTTP, golden corpus and packaging tests |
| [`test/e2e/`](../test/e2e/) | Real-browser E2E and the real-Host agent probe |
| [`fixtures/upstream/`](../fixtures/upstream/) | Generated golden corpus with provenance |
| [`spikes/render/`](../spikes/render/) | Runnable render spike (standalone page, DSH loader harness, build/server scripts) |
| [`lib/`](../lib/) | Built Host and client bundles shipped by the package |
| [`assets/`](../assets/) | Excalidraw CSS (font URLs rewritten), local fonts and locale chunks |

## Status at a glance

| Requirement | Status | Evidence |
|---|---|---|
| Install/load/unload/configure through the official mechanism | Proven | lifecycle tests, isolated profile, live install record |
| Interactive Excalidraw scene editing | Proven | render spike, E2E real input, screenshots |
| Typed, permissioned agent tools | Proven | five tools, real-Host probe, schema tests |
| Durable save/reopen with structural fidelity | Proven within the declared range | store tests, E2E hash/meta checks, golden corpus |
| Full Obsidian compatibility | **Not claimed** | compatibility boundaries |
| Model-driven natural-language → tool flow | **Not run** (needs model credentials); tools proven through the real registry | verification §7 |
| Live Desktop restart | **Pending** by design; isolated instance is the executed proof | live install record |

## Reproduce

```sh
node scripts/verify.mjs          # Host/core + packaging
node test/e2e/dsh-ui.e2e.mjs     # after starting an isolated Harness; see test/e2e/README.md
```
