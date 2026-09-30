import {
  BRIDGE_EVENT,
  DEFAULT_TIMEOUT,
  ErrorCode,
  isBridgeMessage,
  type AppInfo,
  type RequestMessage,
} from '../shared/protocol'
import { BridgeError } from './errors'

export interface BridgeWindow {
  __MOBILE_APP_BRIDGE__?: AppInfo
  ReactNativeWebView?: { postMessage(message: string): void }
  addEventListener(type: string, listener: (event: Event) => void): void
}

export interface CallOptions {
  /** Milliseconds to wait for the native response. Defaults to 30s; 0 disables the timeout. */
  timeout?: number
}

export interface BridgeClient {
  readonly isApp: boolean
  readonly info: AppInfo | null
  call<T = unknown>(method: string, params?: unknown, options?: CallOptions): Promise<T>
  on<T = unknown>(name: string, listener: (data: T) => void): () => void
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: BridgeError) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

type Listener = (data: unknown) => void

export function createBridgeClient(
  getWindow: () => BridgeWindow | undefined,
): BridgeClient {
  const pending = new Map<string, PendingCall>()
  const listeners = new Map<string, Set<Listener>>()
  let attachedTo: BridgeWindow | undefined
  let counter = 0

  /** Inside the app whenever react-native-webview's bridge object exists (same rule as the Agendart bridge). */
  function appWindow(): BridgeWindow | undefined {
    const win = getWindow()
    return win?.ReactNativeWebView ? win : undefined
  }

  function handle(detail: unknown) {
    if (!isBridgeMessage(detail)) return
    if (detail.kind === 'evt') {
      // Events are fire-and-forget: without a subscriber they are dropped. Anything that must not be
      // lost (e.g. "app opened from a notification") is exposed as a method the page calls when ready.
      const subscribers = listeners.get(detail.name)
      if (subscribers) for (const listener of [...subscribers]) listener(detail.data)
      return
    }
    if (detail.kind !== 'res') return

    const entry = pending.get(detail.id)
    if (!entry) return
    pending.delete(detail.id)
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    if (detail.ok) entry.resolve(detail.result)
    else entry.reject(new BridgeError(detail.error.code, detail.error.message))
  }

  function attach(win: BridgeWindow) {
    if (attachedTo === win) return
    attachedTo = win
    win.addEventListener(BRIDGE_EVENT, (event) => handle((event as CustomEvent).detail))
  }

  function nextId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(counter++).toString(36)}`
  }

  return {
    get isApp() {
      return appWindow() !== undefined
    },

    get info() {
      return appWindow()?.__MOBILE_APP_BRIDGE__ ?? null
    },

    call<T = unknown>(method: string, params?: unknown, callOptions: CallOptions = {}): Promise<T> {
      const win = appWindow()
      if (!win?.ReactNativeWebView) {
        return Promise.reject(new BridgeError(ErrorCode.NOT_IN_APP, `Cannot call "${method}" outside the mobile app`))
      }
      attach(win)

      const id = nextId()
      const request: RequestMessage = { bridge: 1, kind: 'req', id, method }
      if (params !== undefined) request.params = params

      let payload: string
      try {
        payload = JSON.stringify(request)
      } catch {
        return Promise.reject(new BridgeError(ErrorCode.INVALID_PARAMS, `Params for "${method}" are not JSON-serializable`))
      }

      const timeout = callOptions.timeout ?? DEFAULT_TIMEOUT
      const postMessage = win.ReactNativeWebView.postMessage.bind(win.ReactNativeWebView)

      return new Promise<T>((resolve, reject) => {
        const timer =
          timeout > 0
            ? setTimeout(() => {
                if (pending.delete(id)) {
                  reject(new BridgeError(ErrorCode.TIMEOUT, `"${method}" did not respond within ${timeout}ms`))
                }
              }, timeout)
            : undefined
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        postMessage(payload)
      })
    },

    on<T = unknown>(name: string, listener: (data: T) => void): () => void {
      const win = appWindow()
      if (win) attach(win)

      let subscribers = listeners.get(name)
      if (!subscribers) {
        subscribers = new Set()
        listeners.set(name, subscribers)
      }
      const typed = listener as Listener
      subscribers.add(typed)

      return () => {
        subscribers.delete(typed)
      }
    },
  }
}
