/** Minimal Host half used by the isolated install experiment (docs/02-dsh-platform.md). */
import { appendFileSync } from 'node:fs'

export const name = 'expt-fixture'
export const inject = []

function record(event, extra = '') {
  const file = process.env.FIXTURE_EVENT_LOG
  if (!file) return
  appendFileSync(file, `${new Date().toISOString()} ${event}${extra ? ' ' + extra : ''}\n`)
}

process.on('exit', code => record('process-exit', `code=${code}`))

export function apply(ctx, config) {
  record('apply', JSON.stringify(config ?? {}))
  ctx.effect(() => () => record('sync-probe-disposed'), 'expt-fixture: sync probe')
  ctx.effect(async () => async () => {
    record('async-probe-dispose-start')
    await new Promise(resolve => setTimeout(resolve, 50))
    record('async-probe-dispose-end')
  }, 'expt-fixture: async probe')
}
