# Evidence for docs/02-dsh-platform.md

Collected 2026-10-28 against the running DeepSeek Harness 0.2.1-rc.2 (profile `desktop`,
GUI `http://127.0.0.1:49163`) and the public clone at
`upstream/deepseek-harness` @ `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` (0.2.1-rc.3).

| File | Source | How to reproduce |
|---|---|---|
| `host-Service.listService.catalog.txt` | `cordis_inspect_query` host `Service.listService`, no input | repeat the call; ~86 KB catalog |
| `host-Tool.listTools.txt` | `cordis_inspect_query` host `Tool.listTools` | repeat; shows the live 12 reference-plugin tools + their JSON Schema |
| `host-Config.listConfigs.p1.txt` | `cordis_inspect_query` host `Config.listConfigs` | repeat (page 1 of 204 entries) |
| `live-inspect-attempts.txt` | the two failed inspect paths | copy of the exact errors; see the file |
| `live-http-probes.txt` | `curl` against `127.0.0.1:49163` | commands listed in the file |
| `live-profile.txt` | read-only shell inspection of `$DSH_HOME`, `$DSH_PROFILE_DIR`, installed package version | commands listed in the file |
| `experiment/` | isolated `DSH_HOME` install/uninstall/boot experiment | see below |

Why some inspect queries are missing: any query that passes an `input` argument was rejected by the
inspect bridge (`"input" must be an object`), and every client-platform query timed out because no
page was connected to the client inspect bridge. Exact messages are in
`live-inspect-attempts.txt`. No live profile file was modified.

## Reproducing the isolated experiment

```sh
cd /Volumes/ZHITAI/DSHExcalidraw
export DSH_HOME=$PWD/.tmp/dsh-home

# fixture package (also archived under experiment/fixture-plugin)
mkdir -p .tmp/fixture-plugin/lib   # then restore the four files from experiment/fixture-plugin

dsh plugin --profile exp1 add "$PWD/.tmp/fixture-plugin"     # install  (exit 0)
dsh --profile exp1 --dump-config  > dump-config-after-add.txt # row appears at lines 361-365

FIXTURE_EVENT_LOG=$PWD/.tmp/events.log timeout -s TERM 10 dsh --profile exp1
#   apply + sync/async effect logs; process exits 0 on SIGTERM

dsh plugin --profile exp1 remove dsh-expt-fixture            # uninstall (exit 0)
dsh --profile exp1 --dump-config  > dump-config-after-remove.txt  # 0 occurrences
```

Measured facts: the profile is initialised with `@deepseek-ai/dsh-base` + the added bundle; add
writes a `link:` dependency, a `node_modules` symlink and a `pnpm-lock.yaml` entry; remove clears the
dependency and the `bundles` entry but **leaves the dangling symlink**; a synchronous `ctx.effect`
disposer ran in 6/6 shutdown trials while a 50 ms async disposer completed in 1/6 (process exit won
the race in the rest).
