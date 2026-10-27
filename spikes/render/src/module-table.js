/**
 * Emulation of the DSH page module table (packages/client/web/src/seed.ts).
 * The live shell seeds React 18.3.1; this harness deliberately supplies the
 * same version through the same `import * as` shape so the spike measures the
 * real runtime, not a React 19 convenience build.
 */
import * as React from 'react18'
import * as ReactDOM from 'react-dom18'
import * as ReactDOMClient from 'react-dom18/client'
import * as JsxRuntime from 'react18/jsx-runtime'

window.__MODULE_TABLE__ = {
  'react': React,
  'react/jsx-runtime': JsxRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
}
window.__MODULE_TABLE_REACT_VERSION__ = React.version
