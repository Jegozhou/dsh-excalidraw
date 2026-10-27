/**
 * Build the two halves of the plugin bundle.
 *
 *  - Host half: one ESM file, bundled so the installed package has no runtime
 *    dependencies beyond Node built-ins.
 *  - Browser half: one factory-registration file in the format the Harness
 *    Client module loader expects. React resolves from the page's module table,
 *    never from a duplicate copy.
 *  - Assets: Excalidraw's fonts/locales and a locally rewritten stylesheet, so
 *    the editor never touches a CDN at runtime.
 *
 * Run from the repository root: `node build.mjs`.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
const lib = join(pkg, 'lib')
const assets = join(pkg, 'assets')
const excalidrawDist = join(pkg, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod')

rmSync(lib, { recursive: true, force: true })
mkdirSync(lib, { recursive: true })
mkdirSync(join(pkg, '.build'), { recursive: true })

// 1. Host half.
execFileSync(join(pkg, 'node_modules', '.bin', 'esbuild'), [
  join(pkg, 'src', 'host', 'index.ts'),
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node22',
  '--outfile=' + join(lib, 'index.js'),
  '--minify=false',
  '--sourcemap',
  '--legal-comments=eof',
  '--log-level=warning',
], { stdio: 'inherit' })
console.log('host half: lib/index.js', size(join(lib, 'index.js')))

// 2. Assets: fonts and locale chunks, copied verbatim.
rmSync(assets, { recursive: true, force: true })
mkdirSync(join(assets, 'fonts'), { recursive: true })
mkdirSync(join(assets, 'locales'), { recursive: true })
if (!existsSync(join(excalidrawDist, 'fonts'))) {
  throw new Error('build: @excalidraw/excalidraw is not installed; run pnpm install first')
}
cpSync(join(excalidrawDist, 'fonts'), join(assets, 'fonts'), { recursive: true })
cpSync(join(excalidrawDist, 'locales'), join(assets, 'locales'), { recursive: true })

// Rewrite relative font URLs to the plugin's asset route. The browser resolves
// a linked stylesheet's URLs against the document, not against the plugin, so
// the paths must already be absolute.
const css = readFileSync(join(excalidrawDist, 'index.css'), 'utf8')
  .replaceAll('url("./fonts/', 'url("/dsh-excalidraw/assets/fonts/')
  .replaceAll("url('./fonts/", "url('/dsh-excalidraw/assets/fonts/")
writeFileSync(join(assets, 'excalidraw.css'), css)
console.log('assets:', count(join(assets, 'fonts')), 'font files,', count(join(assets, 'locales')), 'locale files,', size(join(assets, 'excalidraw.css')), 'css')

// 3. Browser half.
const clientEntry = join(pkg, 'src', 'client', 'index.tsx')
if (existsSync(clientEntry)) {
  const raw = join(lib, 'client.raw.js')
  execFileSync(join(pkg, 'node_modules', '.bin', 'esbuild'), [
    clientEntry,
    '--bundle',
    '--format=iife',
    '--global-name=__dshExcalidraw',
    '--platform=browser',
    '--target=es2022',
    '--jsx=automatic',
    '--loader:.css=text',
    '--conditions=production',
    '--metafile=' + join(pkg, '.build', 'client-metafile.json'),
    '--outfile=' + raw,
    '--minify',
    '--legal-comments=none',
    '--log-level=warning',
    '--external:react',
    '--external:react/jsx-runtime',
    '--external:react-dom',
    '--external:react-dom/client',
    '--define:process.env.NODE_ENV="production"',
  ], { stdio: 'inherit' })
  const bundle = readFileSync(raw, 'utf8')
  rmSync(raw, { force: true })
  const wrapped = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory(require) {\n${bundle}\n    return __dshExcalidraw;\n  },\n});\n`
  writeFileSync(join(lib, 'client.js'), wrapped)
  console.log('browser half: lib/client.js', size(join(lib, 'client.js')))
} else {
  console.log('browser half: skipped (no src/client/index.tsx)')
}

for (const required of ['cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg']) {
  readFileSync(join(pkg, required))
}
console.log('resources: ok')

function size(file) {
  const bytes = statSync(file).size
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`
}

function count(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { recursive: true })) {
    if (statSync(join(dir, entry)).isFile()) total += 1
  }
  return total
}
