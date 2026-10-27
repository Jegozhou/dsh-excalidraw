/** Shared paths and helpers for the render spike scripts. */
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'

export const SPIKE_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const PUBLIC_DIR = join(SPIKE_ROOT, 'public')
export const ARTIFACTS_DIR = join(SPIKE_ROOT, 'artifacts')
export const SHOTS_DIR = join(ARTIFACTS_DIR, 'screenshots')
export const EXPORTS_DIR = join(ARTIFACTS_DIR, 'exports')
export const DIST_DIR = join(SPIKE_ROOT, 'dist')

export const CHROME = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export function ensureDirs() {
  for (const dir of [ARTIFACTS_DIR, SHOTS_DIR, EXPORTS_DIR, DIST_DIR]) mkdirSync(dir, { recursive: true })
}

export function saveJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
  return path
}

export function saveText(path, text) {
  writeFileSync(path, text)
  return path
}

export function hostInfo() {
  return { platform: process.platform, release: release(), node: process.version }
}
