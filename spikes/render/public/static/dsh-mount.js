/**
 * DSH harness boot: materialize the spike bundle through the emulated loader,
 * assert React came from the page module table, then let a minimal slot
 * renderer mount the plugin's registered component (what the DSH renderer does).
 */
(() => {
  const harness = window.__HARNESS__
  const React = window.__MODULE_TABLE__['react']
  const ReactDOMClient = window.__MODULE_TABLE__['react-dom/client']

  const results = {
    reactVersionFromTable: React.version,
    requiredSpecifiers: [],
    registeredSlots: [],
    styles: [],
    errors: [],
    mounted: false,
  }

  try {
    const bundleId = document.body.dataset.bundleId || '@local/dsh-excalidraw'
    const plugin = harness.materialize(bundleId)
    results.bundleId = bundleId
    results.requiredSpecifiers = harness.required.slice()

    if (typeof plugin.apply !== 'function') throw new Error('plugin module has no apply(ctx)')
    if (!Array.isArray(plugin.inject) || !plugin.inject.includes('slots')) {
      throw new Error('plugin module does not inject the slots service')
    }

    const host = document.getElementById('slot-host')
    const slotContext = {
      inject(name, callback) {
        results.registeredSlots.push({ injected: name })
        return callback()
      },
      register(definition, Component) {
        results.registeredSlots.push({ definition })
        const root = ReactDOMClient.createRoot(host)
        root.render(React.createElement(Component))
        results.mounted = true
        return () => root.unmount()
      },
    }

    plugin.apply({ slots: slotContext })
    results.styles = (window.__HARNESS__.ownedStyles || []).slice()
    results.pluginExports = Object.keys(plugin)
    window.__DSH_SPIKE__ = results
  } catch (error) {
    results.errors.push(String(error && error.stack ? error.stack : error))
    window.__DSH_SPIKE__ = results
  }
})()
