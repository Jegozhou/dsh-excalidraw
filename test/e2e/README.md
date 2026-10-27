# End-to-end test harness

The E2E suite intentionally does not run against a user's live Harness profile. It creates a throwaway profile under a workspace-local `DSH_HOME`, installs this repository as a bundle, and drives a second Harness instance on a fixed loopback port.

## Prerequisites

- The repository is built (`node build.mjs`) and `lib/`, `assets/` exist.
- `dsh` CLI on `PATH` (the same runtime as the installed app).
- Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (override with `CHROME_PATH`).
- Playwright-core installed (`pnpm install`).

## 1. Create and populate the isolated profile

```sh
cd /path/to/dsh-excalidraw
export DSH_HOME="$PWD/.tmp/e2e-home"
mkdir -p "$DSH_HOME"

# Create a fresh profile from the shipped web template (does not boot)
dsh --profile e2e --from-default-profile web --dump-config >/dev/null

# Install the plugin and the test-only probe bundle
dsh plugin --profile e2e add "$PWD"
dsh plugin --profile e2e add "$PWD/test/e2e/probe-bundle"
```

The profile's `package.json` should list both bundles under `dsh.profile.bundles`. The probe writes its report to `test/e2e/artifacts/agent-probe-report.json` on activation.

## 2. Start the isolated instance

```sh
DSH_HOME="$PWD/.tmp/e2e-home" dsh --profile e2e --no-open --port 49174 --host 127.0.0.1
```

The process prints `dsh web: http://127.0.0.1:49174/?token=…`. Keep the process running. The token is a launch credential; do not post a live URL publicly.

Wait until the plugin health route answers (the probe also needs ~10 s to activate):

```sh
# Open the token URL once in a browser (or use the Playwright run below) so a cookie exists.
curl -s -c /tmp/dsh-e2e-cookies -L 'http://127.0.0.1:49174/?token=…' -o /dev/null
curl -s -b /tmp/dsh-e2e-cookies 'http://127.0.0.1:49174/dsh-excalidraw/api/health'
```

Expected: `{"ok":true,"plugin":"dsh-excalidraw",…}`.

## 3. Run the UI E2E

```sh
DSH_E2E_URL='http://127.0.0.1:49174/?token=…' \
DSH_E2E_HOME="$PWD/.tmp/e2e-home" \
node test/e2e/dsh-ui.e2e.mjs
```

It creates a timestamped scene, draws a rectangle and arrow with real mouse drags, types text, saves with `Cmd+S`, verifies the file hash and revision sidecar, reloads and reopens, forces an external writer conflict, overwrites, reloads again, and asserts the four surviving elements. Artifacts land in `test/e2e/artifacts/`:

- `e2e-report.json` — step-by-step pass/fail
- `01-drawn.png`, `03-conflict.png`, `04-final.png` — screenshots
- `99-failure.png` on failure

## 4. Inspect the agent probe

```sh
cat test/e2e/artifacts/agent-probe-report.json
```

Expected: `"ok": true` with steps `create`, `readBefore`, `apply`, `duplicateRetry`, `staleFence`, `invalidName`, `readAfter`, `validate`, `list`, `diskEvidence`.

The probe runs once per Host boot. If the isolated instance is restarted it creates another uniquely named probe scene; this is intentional so the test never collides with a previous run.

## 5. Clean up

```sh
# stop the isolated dsh process (Ctrl-C or kill its PID)
rm -rf .tmp/e2e-home
```

The `.tmp/` directory is gitignored. The live Harness profile is never modified by these steps.

## Notes / known automation constraints

- The onboarding overlay ("Continue"/"继续") and the model setup dialog must be dismissed before the sidebar is clickable. The E2E does this defensively; it does not depend on the UI language.
- Excalidraw's floating shape-properties panel covers the left ~250 px of the canvas when a shape tool is active. The E2E draws to the right of it; a drag that starts under that panel is a UI click, not a canvas gesture.
- The `window.__DSH_EXCALIDRAW_API__` global is a read-only verification hook set by the page. It exposes `getSceneElements()`, `getAppState()` and `getFiles()` so the test can assert the live canvas instead of trusting disk state.
- Chrome's headless pointer events are real DOM `PointerEvent`s with `buttons: 1`; the spike and E2E both exercise this path.
