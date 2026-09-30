import type { EventMessage } from '../shared/protocol'

export interface BridgeEmitter {
  /**
   * Sends an event to the page right away, like the Agendart bridge. Returns false when no WebView is
   * connected; the event is then dropped. Anything that must not be lost (e.g. the notification that
   * opened the app) belongs in a handler the page calls when it is ready.
   */
  emit(name: string, data?: unknown): boolean
  /** @internal Called by BridgeWebView. */
  connect(send: (message: EventMessage) => void): () => void
}

export function createEmitterCore(): BridgeEmitter {
  let send: ((message: EventMessage) => void) | null = null

  return {
    emit(name, data) {
      if (!send) return false
      const message: EventMessage = { bridge: 1, kind: 'evt', name }
      if (data !== undefined) message.data = data
      send(message)
      return true
    },

    connect(nextSend) {
      send = nextSend
      return () => {
        if (send === nextSend) send = null
      }
    },
  }
}
