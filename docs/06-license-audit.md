# 06 — Upstream license audit

**Status:** evidence collected, contradiction identified, no silent resolution.
**Scope:** zsviczian/obsidian-excalidraw-plugin @ `9e52063296ffcd3b38d6a2bd5b23546d7e6268f7`; its pinned Excalidraw runtime `@zsviczian/excalidraw@0.18.145`; the upstream Excalidraw packages it derives from; the direct third-party dependencies. This is a factual audit, not legal advice.

Raw evidence: [`docs/evidence/upstream/10-license-evidence.txt`](evidence/upstream/10-license-evidence.txt), [`docs/evidence/upstream/09-dependencies.txt`](evidence/upstream/09-dependencies.txt). License texts: [`docs/evidence/upstream/licenses/`](evidence/upstream/licenses/).

---

## 1. Headline finding: the repository declares two incompatible licenses

| Artifact | What it says | Exact evidence |
|---|---|---|
| `LICENSE` | **GNU Affero General Public License v3.0** (full FSF text, 661 lines, 34,523 bytes, sha256 `8486a10c…f07ef`) | `upstream/obsidian-excalidraw-plugin/LICENSE:1-2` — “GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007”; `LICENSE:540` — §13 Remote Network Interaction |
| `package.json` | **`"license": "MIT"`** | `upstream/obsidian-excalidraw-plugin/package.json:43` |
| `package.json` version | `"version": "2.2.5"` | `package.json:3` (the brief's “2.2.5” comes from here) |
| `manifest.json` / `manifest-beta.json` | version **2.29.0**; **no** `license` field at all | `manifest.json:4-11`; `manifest-beta.json:4-11` |
| `package-lock.json` | version 2.2.5 | `package-lock.json:3` |
| Source files | **no SPDX headers and no copyright headers** anywhere in `src/`, `scripts/`, or `rollup.config.mjs` | evidence file §4 (grep returned no matches) |
| README / CONTRIBUTING / release docs | **no license section or license statement** | evidence file §5 (grep returned no matches) |
| `obsidian-excalidraw.zip` (repo artifact) | ships the **same AGPL text** as `LICENSE`; its manifest is stale at 2.27.3 | evidence file §6 |

The contradiction is consistent with several stories — stale npm metadata, an undocumented dual-license offer, or an AGPL file copied in without updating `package.json`. The chronology narrows it slightly: GitHub’s API dates the LICENSE commit to 2026-05-13, and `package.json` at that same commit already said MIT (line 25) and still says MIT at the pinned commit (line 43); the LICENSE commit touched only `LICENSE`. Nothing in the repository states which story is true, so the audit does not choose one.

There is no honest way to collapse these into “the project is MIT”:

- The verbatim AGPL-3.0 license file is the only full license text in the repository.
- `package.json`'s `"license": "MIT"` is a one-token declaration with no MIT text, no copyright line, and no explanation.
- The Obsidian manifest (the file the plugin marketplace actually consumes) is silent.
- `git log --follow -- LICENSE` shows the file was added by a commit titled “Add GNU AGPL v3 License” (`8df4364b`). The public GitHub API confirms the date **2026-05-13** and that the commit added **only** `LICENSE` — it did not touch `package.json`, which still said MIT at HEAD ([evidence 12](evidence/upstream/12-github-history.txt), raw response in [12-license-commit.json](evidence/upstream/12-license-commit.json)). This makes an undocumented relicense or dual-license intent plausible, but no document states it. The local clone is a partial/promisor clone, so still earlier history was not fetched.
- The version fields themselves disagree (`2.2.5` vs `2.29.0`); the build injects the **manifest** version into the bundle (`rollup.config.mjs:133,264`), so the running plugin reports 2.29.0 even though npm metadata says 2.2.5. This is a warning that metadata in this repository is not a reliable authority.

**Conclusion (license):** treat the upstream plugin source as **AGPL-3.0** until the copyright holder resolves the contradiction in writing. The MIT token in `package.json` is not a sufficient license grant for the repository as a whole, because the repository also distributes the AGPL text and no per-file MIT headers. A downstream user cannot pick the more permissive of two conflicting declarations unilaterally.

**Consequences for this project:** the new DSH plugin must be a **clean-room reimplementation**, not a port, translation, refactor, or copy of upstream source. See §5 for the boundary we must hold.

---

## 2. The Excalidraw runtime fork is MIT — but attribution is still required

| Package | Version | Declared license | Evidence |
|---|---|---|---|
| `@zsviczian/excalidraw` (pinned runtime) | 0.18.145 | MIT | installed `package.json:45`; registry metadata `license: MIT` |
| `@excalidraw/excalidraw` (upstream base) | 0.18.0 | MIT | tarball `package/package.json:30`; registry metadata |
| `@excalidraw/common` | 0.18.0-f0063e113 | MIT | registry metadata |
| `@excalidraw/element` | 0.18.0-f0063e113 | MIT | installed `package.json` + registry metadata |
| `@excalidraw/math` | 0.18.0-f0063e113 | MIT | registry metadata |

The fork's **repository** `LICENSE` is byte-for-byte the upstream Excalidraw MIT text:

> MIT License
>
> Copyright (c) 2020 Excalidraw

(fetched from `https://raw.githubusercontent.com/zsviczian/excalidraw/master/LICENSE`, sha256 `1352d204…d8be`; identical to `https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.0/LICENSE`). Copies are saved in [`docs/evidence/upstream/licenses/`](evidence/upstream/licenses/).

Two weak spots in the published artifact:

1. **The npm tarball contains no `LICENSE` file.** `@zsviczian/excalidraw@0.18.145` ships only `README.md`, `dist/`, `types/`, `package.json` (evidence §12d). The `files` field is `["dist/*", "types/*"]`, so the repository LICENSE is not packaged. The same is true of upstream `@excalidraw/excalidraw@0.18.0` (§12c). MIT's attribution condition therefore has to be satisfied by *our* distribution, not by the package.
2. **Attribution is ambiguous in the fork.** Its `repository` points at `github.com/zsviczian/excalidraw` but its `bugs`/`homepage` point at upstream `excalidraw/excalidraw` (`package.json:72-73,136`), its README is the unmodified upstream README, and 0.18.145 is a large fork delta (Mermaid 3.0.0, Obsidian host hooks, pen options). MIT permits this; it does not remove the obligation to reproduce the copyright and permission notice.

**Obligation if we depend on or bundle the fork:** include the full MIT text and the line `Copyright (c) 2020 Excalidraw` in `THIRD_PARTY_NOTICES.md` (and in any shipped bundle), plus a note that the runtime is the zsviczian fork at 0.18.145. Do not describe the fork as “ours”.

---

## 3. Direct dependency licenses (runtime)

Resolved from the registry at the exact specifiers in `package.json` (full table in evidence §10). All are permissive; none is copyleft.

| Dependency | Resolved | License | Note |
|---|---|---|---|
| `@zsviczian/excalidraw` | 0.18.145 | MIT | runtime/editor; see §2 |
| `react`, `react-dom` | 19.2.8 | MIT | pinned exactly |
| `lz-string` | 1.5.0 | MIT | compressed-json payloads |
| `pako` | 2.2.0 | MIT AND Zlib | runtime inflate for the bundled Excalidraw payload |
| `nanoid` | 5.1.16 | MIT | element/file ids |
| `roughjs` | 4.6.6 | MIT | hand-drawn rendering |
| `@zsviczian/colormaster` | 1.2.2 | MIT | colour math |
| `chroma-js` | 3.2.0 | BSD-3-Clause AND Apache-2.0 | permissive, but **two** notice sets apply if redistributed |
| `monkey-around` | 2.3.0 | ISC | Obsidian monkey-patching; notice required if redistributed |
| `@lezer/lr`, `@popperjs/core`, `@radix-ui/number`, `clsx`, `es6-promise-pool`, `gl-matrix`, `path-data-parser`, `points-on-path`, `polybooljs` | see evidence | MIT | permissive |

Dev-only dependencies include `obsidian@1.8.7` (MIT), Rollup, TypeScript, ESLint, Prettier, Babel, `cssnano`, `uglify-js`, `@zsviczian/rollup-plugin-postprocess`. They are not part of the runtime obligation unless their code is bundled (Babel/terser output is not generally a copyrightable derivative of the tool; the *bundled* libraries are). Full lists: [`docs/evidence/upstream/09-dependencies.txt`](evidence/upstream/09-dependencies.txt).

A lockfile-derived production closure (132 packages, no install needed) is **123 MIT, 3 Apache-2.0, 2 ISC, 1 MIT+Zlib, 1 0BSD, 1 BSD-3+Apache-2.0 and one with no license field**: `fuzzy@0.1.3`, a transitive dependency of the fork. Its npm metadata has no `license`, and the upstream repository has no `LICENSE`/`LICENSE.md`/`COPYING` at the checked paths (fetched 2026-10-28). The fork's own MIT declaration does not automatically relicense that embedded third-party code. If the DSH plugin bundles the fork's Obsidian runtime, this is an unresolved notice gap; if it uses upstream `@excalidraw/excalidraw`, the same `fuzzy` dependency is still present. Record it in `THIRD_PARTY_NOTICES.md` as “no license declared by upstream” rather than silently omitting it. Raw closure output: [evidence 09](evidence/upstream/09-dependencies.txt).

This table is **not** a complete transitive closure. If the new plugin bundles `@zsviczian/excalidraw`, its transitive dependencies (Jotai, CodeMirror, RoughJS, pica, etc.) need their notices too; the fork's own dependency list is in evidence §“Fork package dependency list”. The safest release mechanism is a generated `THIRD_PARTY_NOTICES.md` from the actual production lockfile, not a hand-written list.

---

## 4. What AGPL-3.0 would require if upstream code were reused

If any upstream plugin source were copied, adapted, or translated — even partially, even with renamed identifiers — the new plugin would be a modified/derived work under AGPL-3.0. In that case:

- The derivative must be licensed under AGPL-3.0 (`LICENSE:196` §5 “Conveying Modified Source Versions”).
- Corresponding source must be offered to recipients; §13 (`LICENSE:540`) extends this to users interacting with a modified version remotely over a network.
- MIT/BSD/ISC components can be combined with an AGPL work (they impose no copyleft of their own), but the combined distribution must still satisfy AGPL; §13 additionally permits combining with GPLv3 works specifically (`LICENSE:553-559`).
- The AGPL's patent and termination provisions would attach to our plugin, which is incompatible with the project's stated objective of an original MIT-licensed DSH plugin.

That is the entire reason the task says “quote only short excerpts for evidence and never copy implementation”. A few short quotations for an evidence document are the normal, minimal use; the plugin source itself must contain none of it.

**What is *not* protected by AGPL (or copyright generally):** file formats, JSON schemas, field names, protocol shapes, API/method names, observable behaviour, and facts about how the system works. Those are the things this evidence document records. There is a grey zone around identical comment prose, doc text, CSS, icon assets, and scripts; we do not copy those.

**Specific upstream assets to avoid:**

| Asset | Risk | Decision |
|---|---|---|
| `src/**` (106,925 lines) | AGPL unless proven otherwise | read-only evidence; never copy |
| `ea-scripts/**` (183 directory entries; 181 top-level files: 90 `.md`, 87 `.svg`, 2 `.js`) | part of the AGPL repository. Only `LayerManager.md` and `LayerManager.svg` carry `SPDX-License-Identifier: MIT`; the other scripts have no per-file grant. One archived SVG embeds a Font Awesome Pro icon under a commercial license. | never copy into the new plugin; reimplement any needed automation from behaviour |
| `docs/**`, `AutomateHowTo.md`, `docs/CLI.md` prose | AGPL doc text | paraphrase, do not paste; short quotes only in evidence |
| `testloader.js` (4.8 MB generated bundle) | vendored/generated third-party code; unclear provenance | do not copy |
| `obsidian-excalidraw.zip` | built artifact containing the same AGPL code | do not redistribute |
| `@zsviczian/excalidraw` fork | **MIT** | may be used/bundled with notice (see §2) |
| Upstream Excalidraw 0.18.0 packages | **MIT** | may be used/bundled with notice |

---

## 5. Clean-room procedure enforced by this repo

1. **Read, do not copy.** Upstream is evidence. The plugin implementation lives in `src/` and is written from the format/protocol facts and our own fixtures, not by editing upstream files.
2. **No textual transplantation.** No copy/paste of functions, comments, CSS, localization files, script library entries, or README prose. The only upstream strings in this repo are short, attributed quotations in `docs/` and fixtures that were *generated* by the MIT runtime.
3. **Independent design.** The DSH plugin's host/browser split, tool schemas, file persistence and scene model are specified in the other docs in this folder; they are not a port of `ExcalidrawView`, `ExcalidrawData`, or `ViewSaveCoordinator`.
4. **License metadata is consistent.** The new plugin is MIT (`package.json` of this repo). If it bundles the Excalidraw runtime, that runtime remains MIT and gets a notice; MIT and our MIT project are compatible. (The one-way rule is MIT → AGPL, i.e. in the direction we are deliberately not going.)
5. **Fixtures are generated.** The pinned upstream checkout contains **zero** `.excalidraw` / `.excalidraw.md` files (evidence `11-fixtures.txt` §1). Our corpus was generated with the MIT runtime/serializer, and the attachment PNG was exported by us, not copied from `test-data/`. Fixture manifest records generation method and commit.
6. **No upstream name claim.** “Excalidraw” is the upstream project's brand. The plugin name/description should make clear it is a DSH integration, not an official Excalidraw release. Trademark policy was **NOT investigated** in this audit (UNVERIFIED) — treat it as a separate release check.
7. **Legal review before publishing.** The AGPL/MIT contradiction is real and unresolved. If the intended use ever requires copying upstream code, obtain written clarification from the copyright holder first; do not rely on the `package.json` token.

---

## 6. Answers to the questions the team asked

**“Is the upstream plugin MIT or AGPL?”**
Both declarations exist; the repository as distributed is AGPL-3.0 by license text, with a contradictory `"license": "MIT"` field. We assume AGPL for compliance purposes (the conservative assumption) and do not copy code. This is not a resolution of the contradiction; it is a risk posture. The contradiction should be raised with the upstream author if the project ever wants to reuse code.

**“Is `@zsviczian/excalidraw` safe to use?”**
Yes, under MIT, provided the MIT notice and `Copyright (c) 2020 Excalidraw` are reproduced in our distribution. The published tarball omits the LICENSE file; we must supply the notice ourselves. The fork's provenance is visible in its repository LICENSE and `package.json`, even though its README is upstream's.

**“What must the new plugin avoid?”**
Any copying from the AGPL plugin repository (source, scripts, docs, CSS, assets). Format facts, API shapes and behaviour are fair game; text and code are not. If we bundle the Excalidraw runtime, comply with MIT. If we later copy even a small upstream function, the whole plugin's license position changes to AGPL — a decision for the project owner, not an incidental implementation choice.

---

### Evidence index

- [`docs/evidence/upstream/10-license-evidence.txt`](evidence/upstream/10-license-evidence.txt) — raw header/metadata/hash evidence, fork and upstream metadata, dependency license table.
- [`docs/evidence/upstream/09-dependencies.txt`](evidence/upstream/09-dependencies.txt) — dependency specs, resolved licenses, import hotspots.
- [`docs/evidence/upstream/licenses/excalidraw-0.18.0-MIT.txt`](evidence/upstream/licenses/excalidraw-0.18.0-MIT.txt) — upstream MIT text.
- [`docs/evidence/upstream/licenses/zsviczian-excalidraw-master-MIT.txt`](evidence/upstream/licenses/zsviczian-excalidraw-master-MIT.txt) — fork MIT text (byte-identical).
- [`docs/evidence/upstream/11-fixtures.txt`](evidence/upstream/11-fixtures.txt) — fixture provenance and absence proof.
- [`docs/evidence/upstream/12-github-history.txt`](evidence/upstream/12-github-history.txt) — GitHub API chronology of the AGPL LICENSE commit (2026-05-13), showing it did not update `package.json`.
