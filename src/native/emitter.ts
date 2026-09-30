import type { EventMessage } from '../shared/protocol'
import { buildDispatchScript } from './scripts'

export interface BridgeEmitter {
  /** Sends an event to the page. Queued until the page has finished loading. */
  emit(name: string, data?: unknown): void
  /** @internal Called by BridgeWebView. */
  connect(send: (script: string) => void): () => void
  /** @internal Called by BridgeWebView on load start (false) and load end (true). */
  setReady(ready: boolean): void
}

export function createEmitterCore(): BridgeEmitter {
  const queue: EventMessage[] = []
  let send: ((script: string) => void) | null = null
  let ready = false

  function flush() {
    if (!send || !ready) return
    while (queue.length > 0) send(buildDispatchScript(queue.shift()!))
  }

  return {
    emit(name, data) {
      const message: EventMessage = { bridge: 1, kind: 'evt', name }
      if (data !== undefined) message.data = data
      queue.push(message)
      flush()
    },

    connect(nextSend) {
      send = nextSend
      flush()
      return () => {
        if (send !== nextSend) return
        send = null
        ready = false
      }
    },

    setReady(value) {
      ready = value
      flush()
    },
  }
}
