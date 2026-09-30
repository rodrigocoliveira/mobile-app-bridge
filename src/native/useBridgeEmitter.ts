import { useRef } from 'react'
import { createEmitterCore, type BridgeEmitter } from './emitter'

/** Stable emitter for sending events to the page. Pass it to <BridgeWebView emitter={...} />. */
export function useBridgeEmitter(): BridgeEmitter {
  const ref = useRef<BridgeEmitter | null>(null)
  if (ref.current === null) ref.current = createEmitterCore()
  return ref.current
}
