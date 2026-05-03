import { Window } from 'happy-dom'

let registered = false

export function ensureDom(): void {
  if (registered) return
  const window = new Window()
  // Bun's test environment already provides globalThis.fetch natively,
  // so we only need to expose DOM-specific globals if tests require them.
  // The api.test.ts tests mock fetch directly on globalThis, so this is a no-op shim.
  if (typeof globalThis.document === 'undefined') {
    Object.assign(globalThis, {
      document: window.document,
      navigator: window.navigator,
    })
  }
  registered = true
}
