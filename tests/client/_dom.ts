import { GlobalRegistrator } from '@happy-dom/global-registrator'

let registered = false
const nativeStreams = {
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
}

export function ensureDom(): void {
  if (registered) return
  GlobalRegistrator.register()
  if (nativeStreams.ReadableStream) {
    globalThis.ReadableStream = nativeStreams.ReadableStream
  }
  if (nativeStreams.WritableStream) {
    globalThis.WritableStream = nativeStreams.WritableStream
  }
  if (nativeStreams.TransformStream) {
    globalThis.TransformStream = nativeStreams.TransformStream
  }
  registered = true
}
