/**
 * Minimal emulation of the DSH HTML-installed module-loader facade
 * (packages/client/modules/src/client/system.ts + manifest.ts).
 *
 * Real contract:
 *   window.__ModuleLoader__.load({ id, chunk?, factory(require) {...} })
 *   - queue mode before module-system boot, live registration after
 *   - the factory receives require(specifier) resolving ONLY module-table words
 *   - <style> tags injected while the factory runs are claimed for the plugin
 *
 * This harness keeps the same observable contract: parser-preloaded classic
 * scripts queue registrations, materialize() flips to live mode, resolves
 * `require` against window.__MODULE_TABLE__, and claims untagged styles.
 */
(() => {
  const table = window.__MODULE_TABLE__ || {}
  const registrations = new Map()
  const pendingQueue = []
  const required = []
  let mode = 'queue'
  let moduleExports = null

  const untaggedStyles = () => new Set(document.querySelectorAll('style:not([data-plugin])'))

  window.__ModuleLoader__ = {
    get mode() {
      return mode
    },
    pendingQueue,
    load(registration) {
      if (registrations.has(registration.id)) {
        throw new Error('client-modules: duplicate registration ' + registration.id)
      }
      registrations.set(registration.id, registration)
      if (mode === 'queue') pendingQueue.push(registration)
    },
    create() {
      throw new Error('client-modules: harness has no boot manifest')
    },
  }

  window.__HARNESS__ = {
    required,
    registrations,
    pendingQueue,
    getModule: () => moduleExports,
    /**
     * Materialize one registered bundle exactly once, like ClientModuleSystem.import.
     * @param {string} id
     */
    materialize(id) {
      mode = 'live'
      const registration = registrations.get(id)
      if (registration === undefined) throw new Error('client-modules: no bundle registration for ' + id)
      const before = untaggedStyles()
      const req = (specifier) => {
        required.push(specifier)
        if (!(specifier in table)) throw new Error('client-modules: module-table miss: ' + specifier)
        return table[specifier]
      }
      req.async = async (specifier) => {
        throw new Error('client-modules: chunk loading not exercised in this spike: ' + specifier)
      }
      req.asset = (reference) => reference
      moduleExports = registration.factory(req)
      // Loader bookkeeping: claim styles the factory injected.
      const owned = []
      for (const element of untaggedStyles()) {
        if (!before.has(element)) element.setAttribute('data-plugin', id)
      }
      for (const element of document.querySelectorAll('style[data-plugin]')) {
        owned.push(element.getAttribute('data-plugin-css') || id)
      }
      window.__HARNESS__.ownedStyles = owned
      return moduleExports
    },
  }
})()
