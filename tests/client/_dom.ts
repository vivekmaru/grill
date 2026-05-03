import { GlobalRegistrator } from '@happy-dom/global-registrator'

let registered = false

export function ensureDom(): void {
  if (registered) return
  GlobalRegistrator.register()
  registered = true
}
