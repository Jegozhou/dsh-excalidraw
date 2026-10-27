/**
 * Rebuild dsh-bundle/client.js from the spike entry.
 *
 * Usage (from spikes/render):
 *   node dsh-bundle/build.mjs
 *
 * Keeps react/react-dom/react/jsx-runtime external (page module table) and
 * wraps the esbuild CJS output in the DSH loader registration closure.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPIKE_ROOT = dirname(HERE)
const PLUGIN_ID = '@local/dsh-excalidraw'

const result = await build({
  entryPoints: [join(SPIKE_ROOT, 'src/dsh-entry.js')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  minify: true,
  legalComments: 'none',
  conditions: ['production', 'browser', 'import', 'default'],
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.IS_PREACT': '"false"',
  },
  loader: { '.css': 'text' },
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  write: false,
})

const inner = result.outputFiles[0].text
const wrapped = [
  '/* DSH client bundle: closure factory over the page module table. */',
  'window.__ModuleLoader__.load({',
  `  id: ${JSON.stringify(PLUGIN_ID)},`,
  '  factory(require) {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  inner,
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n')

const outPath = join(HERE, 'client.js')
await mkdir(dirname(outPath), { recursive: true })
await writeFile(outPath, wrapped)
const bytes = (await readFile(outPath)).byteLength
console.log(`wrote ${outPath} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`)
