/**
 * Build the render-spike artifacts with esbuild.
 *
 * Outputs
 *   public/build/standalone.js   self-contained IIFE for the standalone page
 *                                (React 19 inlined, Excalidraw CSS inlined as text,
 *                                all lazy imports inlined -> no runtime fetches)
 *   public/build/module-table.js React 18.3.1 module table emulation
 *   public/build/dsh-client.js   DSH loader-format bundle:
 *                                window.__ModuleLoader__.load({ id, factory(require) })
 *                                with React 18/19-agnostic externals resolved by require
 *   public/assets/fonts/         Excalidraw woff2 assets (copied)
 *   dist/size-report.json        raw/gzip/brotli sizes + asset inventory
 */
import { build } from 'esbuild'
import { cp, rm, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { PUBLIC_DIR, DIST_DIR, SPIKE_ROOT, ensureDirs } from './lib.mjs'

const require = createRequire(import.meta.url)
const PLUGIN_ID = '@local/dsh-excalidraw'
const EXCALIDRAW_DIR = join(process.cwd(), 'node_modules/@excalidraw/excalidraw')
const PROD_DIR = join(EXCALIDRAW_DIR, 'dist/prod')

async function packageVersion(name) {
  const file = join(process.cwd(), 'node_modules', name, 'package.json')
  return JSON.parse(await readFile(file, 'utf8')).version
}

const versions = {
  excalidraw: await packageVersion('@excalidraw/excalidraw'),
  react19: await packageVersion('react'),
  reactDom19: await packageVersion('react-dom'),
  react18: await packageVersion('react18'),
  reactDom18: await packageVersion('react-dom18'),
  esbuild: await packageVersion('esbuild'),
  node: process.version,
}

const CONDITIONS = ['production', 'browser', 'import', 'default']
const DEFINE = {
  'process.env.NODE_ENV': '"production"',
  'process.env.IS_PREACT': '"false"',
}
const LOADERS = { '.css': 'text' }

function sizeOf(buffer) {
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer, { level: 9 }).byteLength,
    brotli: brotliCompressSync(buffer, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  }
}

async function dirSize(dir) {
  let files = 0
  let bytes = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await dirSize(path)
      files += inner.files
      bytes += inner.bytes
    } else {
      files += 1
      bytes += (await stat(path)).size
    }
  }
  return { files, bytes }
}

async function buildStandalone() {
  const result = await build({
    entryPoints: ['src/standalone.js'],
    outfile: join(PUBLIC_DIR, 'build/standalone.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome120'],
    platform: 'browser',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    conditions: CONDITIONS,
    define: DEFINE,
    loader: LOADERS,
    metafile: true,
    logLevel: 'warning',
  })
  const bytes = await readFile(join(PUBLIC_DIR, 'build/standalone.js'))
  return { result, size: sizeOf(bytes) }
}

async function buildModuleTable() {
  await build({
    entryPoints: ['src/module-table.js'],
    outfile: join(PUBLIC_DIR, 'build/module-table.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome120'],
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    // react-dom@18.3.1 must see react@18.3.1: the repo root also has react 19
    // for the standalone build, so alias the internal specifiers explicitly.
    alias: { react: 'react18', 'react-dom': 'react-dom18' },
    logLevel: 'warning',
  })
  return sizeOf(await readFile(join(PUBLIC_DIR, 'build/module-table.js')))
}

async function buildDshBundle() {
  const innerPath = join(DIST_DIR, 'dsh-inner.cjs')
  const result = await build({
    entryPoints: ['src/dsh-entry.js'],
    outfile: innerPath,
    bundle: true,
    format: 'cjs',
    target: ['chrome120'],
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    conditions: CONDITIONS,
    define: DEFINE,
    loader: LOADERS,
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    metafile: true,
    logLevel: 'warning',
  })
  const inner = await readFile(innerPath, 'utf8')
  const wrapped = [
    '/* DSH client bundle (spike): closure factory over the page module table. */',
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
  const outPath = join(SPIKE_ROOT, 'dsh-bundle/client.js')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, wrapped)
  await rm(innerPath, { force: true })
  return {
    result,
    size: sizeOf(Buffer.from(wrapped)),
    outPath,
    requiresReact: inner.includes('require("react")'),
  }
}

async function copyFonts() {
  const target = join(PUBLIC_DIR, 'assets/fonts')
  await rm(target, { recursive: true, force: true })
  await cp(join(PROD_DIR, 'fonts'), target, { recursive: true })
  return dirSize(target)
}

async function copyLazyChunks() {
  // Lazy/on-demand modules exactly as shipped in dist/prod (locales, worker
  // chunks, the big export chunk). Served under /lazy for the lean build.
  const target = join(PUBLIC_DIR, 'lazy')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const name of await readdir(PROD_DIR)) {
    if (name === 'fonts' || name === 'index.css' || name === 'index.js') continue
    await cp(join(PROD_DIR, name), join(target, name), { recursive: true })
  }
  return dirSize(target)
}

async function buildLean() {
  // Same DSH-format bundle but with Excalidraw's on-demand imports left as
  // runtime import() calls, rewritten to the absolute /lazy/ route. This is
  // the size-relevant alternative to inlining every locale + the export chunk.
  const innerPath = join(DIST_DIR, 'lean-inner.cjs')
  const result = await build({
    entryPoints: ['src/dsh-entry.js'],
    outfile: innerPath,
    bundle: true,
    format: 'cjs',
    target: ['chrome120'],
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    conditions: CONDITIONS,
    define: DEFINE,
    loader: LOADERS,
    external: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime',
      './locales/*', './data/*',
      './subset-worker.chunk.js', './subset-shared.chunk.js', './chunk-EIO257PC.js',
    ],
    metafile: true,
    logLevel: 'warning',
  })
  let inner = await readFile(innerPath, 'utf8')
  const rewriteCount = (inner.match(/import\(\"\.\//g) || []).length
  inner = inner.replaceAll('import("./', 'import("/lazy/')
  const wrapped = [
    '/* DSH client bundle (spike, lean): lazy Excalidraw chunks served from /lazy/. */',
    'window.__ModuleLoader__.load({',
    `  id: ${JSON.stringify(PLUGIN_ID + '/lean')},`,
    '  factory(require) {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    inner,
    '    return module.exports;',
    '  },',
    '});',
    '',
  ].join('\n')
  const outPath = join(PUBLIC_DIR, 'build/dsh-client-lean.js')
  await writeFile(outPath, wrapped)
  await rm(innerPath, { force: true })
  return { result, size: sizeOf(Buffer.from(wrapped)), outPath, rewriteCount }
}

async function buildSplitProbe() {
  // Size probe only (not a DSH artifact): ESM output with code splitting shows
  // how large the *initial* client bundle is when Excalidraw's dynamic imports
  // (locales, mermaid, export chunk) become separate lazy chunks.
  const outdir = join(PUBLIC_DIR, 'build/esm-split')
  await rm(outdir, { recursive: true, force: true })
  const result = await build({
    entryPoints: ['src/dsh-entry.js'],
    outdir,
    bundle: true,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: 'entry',
    target: ['chrome120'],
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    conditions: CONDITIONS,
    define: DEFINE,
    loader: LOADERS,
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    metafile: true,
    logLevel: 'warning',
  })
  const outputs = Object.entries(result.metafile.outputs).map(([name, info]) => ({
    name,
    label: name.replace('public/build/esm-split/', ''),
    bytes: info.bytes,
    entryPoint: info.entryPoint ?? null,
  })).sort((a, b) => b.bytes - a.bytes)
  const entry = outputs.find(output => output.entryPoint !== null)
  const entryBuffer = await readFile(resolve(process.cwd(), entry.name))
  return {
    entry: { name: entry.label, ...sizeOf(entryBuffer) },
    chunkCount: outputs.filter(output => output.entryPoint === null).length,
    total: outputs.reduce((sum, output) => sum + output.bytes, 0),
    largestChunks: outputs.slice(0, 8).map(({ label, bytes }) => ({ label, bytes })),
  }
}

async function inventory() {
  const prodFiles = await readdir(PROD_DIR)
  const locales = await dirSize(join(PROD_DIR, 'locales'))
  const fonts = await dirSize(join(PROD_DIR, 'fonts'))
  const css = (await stat(join(PROD_DIR, 'index.css'))).size
  const chunks = []
  for (const name of prodFiles) {
    if (name.startsWith('chunk-') || name.startsWith('subset-')) {
      chunks.push({ name, bytes: (await stat(join(PROD_DIR, name))).size })
    }
  }
  return {
    distProdFiles: prodFiles.sort(),
    locales: { ...locales, count: (await readdir(join(PROD_DIR, 'locales'))).length },
    fonts,
    cssBytes: css,
    excalidrawIndexJsBytes: (await stat(join(PROD_DIR, 'index.js'))).size,
    chunks,
  }
}

async function main() {
  ensureDirs()
  await mkdir(join(PUBLIC_DIR, 'build'), { recursive: true })

  console.log('building standalone IIFE (React 19 inlined)...')
  const standalone = await buildStandalone()
  console.log('building module table (React 18.3.1)...')
  const moduleTable = await buildModuleTable()
  console.log('building DSH loader-format bundle (React external)...')
  const dsh = await buildDshBundle()
  console.log('building lean DSH bundle (lazy chunks external)...')
  const lean = await buildLean()
  console.log('copying fonts + lazy chunks...')
  console.log('building split-ESM size probe...')
  const splitProbe = await buildSplitProbe()
  const fontsCopied = await copyFonts()
  const lazyCopied = await copyLazyChunks()

  const report = {
    generatedAt: new Date().toISOString(),
    versions,
    dshBundleId: PLUGIN_ID,
    bundles: {
      standalone: {
        path: 'public/build/standalone.js',
        ...standalone.size,
        includesReact: true,
        note: 'IIFE, all Excalidraw lazy imports inlined; no runtime network beyond local fonts.',
      },
      dshClient: {
        path: 'dsh-bundle/client.js',
        ...dsh.size,
        requiresReact: dsh.requiresReact,
        external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
        note: 'Closure factory for window.__ModuleLoader__.load; CSS injected as tagged <style>.',
      },
      dshClientLean: {
        path: 'public/build/dsh-client-lean.js',
        ...lean.size,
        rewrittenImportSpecifiers: lean.rewriteCount,
        note: 'Lazy Excalidraw chunks left external and rewritten to /lazy/ (host route in DSH).',
      },
      splitEsmProbe: {
        ...splitProbe,
        note: 'Size probe only: initial ESM entry when Excalidraw dynamic imports are split into chunks. Not a DSH loader artifact.',
      },
      moduleTableReact18: {
        path: 'public/build/module-table.js',
        ...moduleTable,
      },
    },
    assets: {
      excalidrawProd: await inventory(),
      copiedFonts: fontsCopied,
      lazyChunks: lazyCopied,
    },
    esbuild: {
      standaloneInputs: Object.keys(standalone.result.metafile.inputs).length,
      standaloneBytesByInput: Object.fromEntries(
        Object.entries(Object.entries(standalone.result.metafile.outputs).find(([name]) => name.endsWith('.js'))[1].inputs)
          .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
          .slice(0, 25)
          .map(([name, info]) => [name, info.bytesInOutput]),
      ),
    },
  }
  await writeFile(join(DIST_DIR, 'size-report.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(DIST_DIR, 'metafile-standalone.json'), JSON.stringify(standalone.result.metafile, null, 2))
  await writeFile(join(DIST_DIR, 'metafile-dsh.json'), JSON.stringify(dsh.result.metafile, null, 2))

  const mb = bytes => (bytes / 1024 / 1024).toFixed(2) + ' MiB'
  console.table({
    standalone: { raw: mb(standalone.size.raw), gzip: mb(standalone.size.gzip), brotli: mb(standalone.size.brotli) },
    dshClient: { raw: mb(dsh.size.raw), gzip: mb(dsh.size.gzip), brotli: mb(dsh.size.brotli) },
    dshClientLean: { raw: mb(lean.size.raw), gzip: mb(lean.size.gzip), brotli: mb(lean.size.brotli) },
    moduleTable: { raw: mb(moduleTable.raw), gzip: mb(moduleTable.gzip), brotli: mb(moduleTable.brotli) },
    fonts: { raw: mb(fontsCopied.bytes), gzip: '', brotli: '' },
  })
  console.log('build report:', join(DIST_DIR, 'size-report.json'))
}

await main()
