/** Playwright-core launch + page instrumentation shared by the spike evidence scripts. */
import { chromium } from 'playwright-core'
import { CHROME } from './lib.mjs'

export async function launchChrome() {
  return chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio'],
  })
}

/** Attach console/network/CSP listeners; returns live arrays the caller can dump as artifacts. */
export async function instrument(page, origin) {
  const evidence = {
    origin,
    consoleMessages: [],
    pageErrors: [],
    requests: [],
    requestFailures: [],
    responses: [],
    crash: null,
  }
  page.on('console', message => evidence.consoleMessages.push({
    type: message.type(),
    text: message.text(),
    location: message.location(),
  }))
  page.on('pageerror', error => evidence.pageErrors.push({ message: error.message, stack: error.stack }))
  page.on('request', request => evidence.requests.push({
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
  }))
  page.on('response', response => {
    const headers = response.headers()
    evidence.responses.push({
      url: response.url(),
      status: response.status(),
      contentType: headers['content-type'] ?? '',
      contentLength: headers['content-length'] ?? '',
      cacheControl: headers['cache-control'] ?? '',
    })
  })
  page.on('requestfailed', request => evidence.requestFailures.push({
    url: request.url(),
    failure: request.failure(),
  }))
  page.on('crash', () => { evidence.crash = 'page crashed' })

  await page.addInitScript(() => {
    window.__CSP_VIOLATIONS__ = []
    document.addEventListener('securitypolicyviolation', event => {
      window.__CSP_VIOLATIONS__.push({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        sourceFile: event.sourceFile,
      })
    })
  })
  return evidence
}

/** Network summary: external hosts, font fetches, non-2xx responses. */
export function summarizeNetwork(evidence) {
  const sameOrigin = url => String(url).startsWith(evidence.origin)
  const external = [...new Set(evidence.requests.filter(r => !sameOrigin(r.url)).map(r => r.url))]
  const fontResponses = evidence.responses.filter(r => /\.woff2?(\?|$)/u.test(r.url))
  return {
    externalHosts: external,
    fontRequests: fontResponses.map(r => ({ url: r.url, status: r.status, contentType: r.contentType })),
    failedResponses: evidence.responses.filter(r => r.status >= 400),
    requestFailures: evidence.requestFailures,
  }
}

export function summarizeConsole(evidence) {
  const errors = evidence.consoleMessages.filter(m => m.type === 'error')
  const warnings = evidence.consoleMessages.filter(m => m.type === 'warning')
  return {
    errors,
    warnings,
    cspViolations: [], // filled by caller from page state
  }
}
