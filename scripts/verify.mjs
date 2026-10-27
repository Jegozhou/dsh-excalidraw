/**
 * One-command verification: typecheck, build, unit/integration tests and
 * packaging assertions. The E2E suite is separate because it needs a running
 * isolated Harness (see test/e2e/README.md).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const artifacts = join(root, 'test', 'artifacts')
mkdirSync(artifacts, { recursive: true })
const transcript = []
let failed = false

function run(label, command, args) {
  const started = Date.now()
  transcript.push(`\n=== ${label} ===\n$ ${command} ${args.join(' ')}`)
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  process.stdout.write(output)
  transcript.push(output)
  const milliseconds = Date.now() - started
  const status = result.status === 0 ? 'PASS' : 'FAIL'
  transcript.push(`${label}: ${status} (${milliseconds} ms)`)
  console.log(`${label}: ${status} (${milliseconds} ms)`)
  if (result.status !== 0) failed = true
  return result.status === 0
}

run('typecheck', join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json', '--noEmit'])
run('build', process.execPath, ['build.mjs'])
run('unit tests', process.execPath, ['--test', 'test/unit/lifecycle.test.ts', 'test/unit/elements.test.ts', 'test/unit/store.test.ts', 'test/unit/retry.test.ts'])
run('integration tests', process.execPath, ['--test', 'test/integration/api.test.ts', 'test/integration/fixtures.test.ts', 'test/integration/bundle.test.ts'])

for (const required of ['lib/index.js', 'lib/client.js', 'assets/excalidraw.css', 'assets/fonts/Excalifont', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg']) {
  const present = existsSync(join(root, required))
  transcript.push(`artifact ${required}: ${present ? 'present' : 'MISSING'}`)
  if (!present) failed = true
}

const summary = failed ? 'VERIFY FAILED' : 'VERIFY OK'
transcript.push(`\n${summary}`)
writeFileSync(join(artifacts, 'verify-transcript.txt'), `${transcript.join('\n')}\n`)
console.log(`\n${summary} — transcript: test/artifacts/verify-transcript.txt`)
process.exit(failed ? 1 : 0)
