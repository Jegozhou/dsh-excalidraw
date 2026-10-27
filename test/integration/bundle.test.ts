/**
 * Packaging-contract tests. They run without a Harness instance and catch the
 * mistakes that make an otherwise working plugin uninstallable: wrong loader
 * id, missing exports, embedded React, non-object tool schemas, missing locale
 * metadata, or an icon that is not an icon.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { TOOL_SCHEMAS } from '../../src/host/schema.ts'

const ROOT = process.cwd()

async function manifest(): Promise<any> {
  return JSON.parse(await fs.readFile(join(ROOT, 'package.json'), 'utf8'))
}

test('package manifest declares a bundle, a browser half and the expected exports', async () => {
  const pkg = await manifest()
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  for (const packageId of [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ]) {
    assert.ok(pkg.dsh.client.inject.includes(packageId), `missing client inject edge ${packageId}`)
  }
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.ok(pkg.files.includes('lib/client.js'))
  assert.ok(pkg.files.includes('lib/index.js'))
  assert.ok(pkg.files.includes('assets/**'))
  assert.equal(pkg.engines.dsh ?? undefined, undefined, 'engines.dsh is optional; do not claim a range we did not test')
})

test('the patch row uses the package name and a config the plugin normalizes', async () => {
  const pkg = await manifest()
  const patch = await fs.readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, new RegExp(`name: '${pkg.name.replace('.', '\\.')}'`, 'u'))
  for (const key of ['drawingsDir', 'maxSceneBytes', 'maxElements', 'maxFiles', 'maxTextLength']) {
    assert.match(patch, new RegExp(`${key}:`, 'u'), `patch does not expose ${key}`)
  }
})

test('the built client registers exactly the package id and keeps React external', async () => {
  const pkg = await manifest()
  const code = await fs.readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(code.startsWith('window.__ModuleLoader__.load({'), 'client bundle does not use the loader facade')
  assert.ok(code.includes(`id: ${JSON.stringify(pkg.name)}`), 'loader id is not the package name')
  assert.ok(code.includes('factory(require)'), 'loader registration has no factory(require)')
  assert.ok(code.includes('return __dshExcalidraw'), 'factory does not return the plugin namespace')
  assert.match(code, /\(\s*"react"\s*\)/u, 'React is not resolved through the page module table')
  assert.match(code, /\(\s*"react\/jsx-runtime"\s*\)/u, 'the JSX runtime is not external')
  assert.ok(code.length < 12 * 1024 * 1024, `client bundle is unexpectedly large: ${code.length}`)
  // React must not be bundled: a bundled React would define a second hook dispatcher.
  assert.equal(code.includes('ReactCurrentDispatcher'), false, 'the client bundle appears to embed React')
})

test('the built host keeps the plugin contract exports', async () => {
  const code = await fs.readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
  assert.match(code, /export\s*\{[^}]*apply/u)
  assert.match(code, /export\s*\{[^}]*inject/u)
  assert.match(code, /export\s*\{[^}]*PLUGIN_ID/u)
  assert.match(code, /inject\s*=\s*\["tools"\]/u)
})

test('version strings agree across the manifest and both halves', async () => {
  const pkg = await manifest()
  const host = await fs.readFile(join(ROOT, 'src', 'host', 'index.ts'), 'utf8')
  const client = await fs.readFile(join(ROOT, 'src', 'client', 'page.tsx'), 'utf8')
  const hostVersion = /export const VERSION = '([^']+)'/u.exec(host)?.[1]
  const clientVersion = /const CLIENT_BUILD = '([^']+)'/u.exec(client)?.[1]
  assert.equal(hostVersion, pkg.version)
  assert.equal(clientVersion, pkg.version)
})

test('tool schemas are object-rooted and closed', () => {
  for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
    assert.equal(schema.type, 'object', `${name} is not object-rooted`)
    assert.equal(schema.additionalProperties, false, `${name} accepts unknown keys`)
    assert.ok(schema.properties && typeof schema.properties === 'object', `${name} has no properties`)
  }
  assert.ok(Object.keys(TOOL_SCHEMAS).length === 5)
})

test('locale resources carry real display metadata in both languages', async () => {
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(await fs.readFile(join(ROOT, 'locale', `${language}.json`), 'utf8'))
    assert.ok(locale.meta.title.length > 3)
    assert.ok(locale.meta.description.length > 30)
    assert.ok(locale.panel.length > 0)
    assert.equal(Object.keys(locale).length > 10, true)
  }
})

test('the icon is an original, small, well-formed SVG', async () => {
  const icon = await fs.readFile(join(ROOT, 'icon.svg'), 'utf8')
  assert.ok(icon.trimStart().startsWith('<svg'))
  assert.ok(icon.includes('</svg>'))
  assert.ok(Buffer.byteLength(icon, 'utf8') < 256 * 1024)
  assert.equal(/<script|javascript:/iu.test(icon), false, 'the icon must not reference scripts')
  assert.equal(/href\s*=\s*["']https?:/iu.test(icon), false, 'the icon must not load a remote resource')
})

test('the asset route inputs shipped with the package are present', async () => {
  const css = await fs.readFile(join(ROOT, 'assets', 'excalidraw.css'), 'utf8')
  assert.match(css, /\/dsh-excalidraw\/assets\/fonts\//u, 'CSS font URLs were not rewritten to the Host route')
  const fonts = await fs.readdir(join(ROOT, 'assets', 'fonts'), { recursive: true })
  assert.ok(fonts.filter(name => name.endsWith('.woff2')).length >= 9)
  const locales = await fs.readdir(join(ROOT, 'assets', 'locales'))
  assert.ok(locales.length >= 10)
  const fontEntry = fonts.find(name => name.includes('Excalifont') && name.endsWith('.woff2')) as string
  const font = await fs.readFile(join(ROOT, 'assets', 'fonts', fontEntry))
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2')
})
