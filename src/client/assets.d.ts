/**
 * Ambient declarations for the browser half: esbuild's `text` loader turns the
 * Excalidraw stylesheet into a string, and the Excalidraw runtime reads its
 * font base from a window global.
 */

declare module '*.css' {
  const css: string
  export default css
}

interface Window {
  EXCALIDRAW_ASSET_PATH?: string
}
