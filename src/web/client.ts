import {
  BRIDGE_EVENT,
  DEFAULT_TIMEOUT,
  ErrorCode,
  isBridgeMessage,
  USER_AGENT_PRODUCT,
  type AppInfo,
  type EventMessage,
  type RequestMessage,
} from '../shared/protocol'
import { BridgeError } from './errors'

export const UNDELIVERED_TTL_MS = 10_000
export const MAX_UNDELIVERED = 50

export interface BridgeWindow {
  navigator?: { userAgent?: string }
  __MOBILE_APP_BRIDGE__?: AppInfo
  __MOBILE_APP_BRIDGE_BUFFER__?: unknown[]
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
  options: { now?: () => number } = {},
): BridgeClient {
  const now = options.now ?? Date.now
  const pending = new Map<string, PendingCall>()
  const listeners = new Map<string, Set<Listener>>()
  let undelivered: Array<{ message: EventMessage; receivedAt: number }> = []
  let attachedTo: BridgeWindow | undefined
  let counter = 0

  function appWindow(): BridgeWindow | undefined {
    const win = getWindow()
    return win?.ReactNativeWebView && readInfo(win) ? win : undefined
  }

  function pruneUndelivered() {
    const cutoff = now() - UNDELIVERED_TTL_MS
    undelivered = undelivered.filter((entry) => entry.receivedAt >= cutoff)
  }

  function deliverEvent(message: EventMessage, receivedAt: number) {
    const subscribers = listeners.get(message.name)
    if (subscribers && subscribers.size > 0) {
      for (const listener of [...subscribers]) listener(message.data)
      return
    }
    // Nobody is listening yet (e.g. cold start): keep it briefly for the first subscriber.
    undelivered.push({ message, receivedAt })
    pruneUndelivered()
    if (undelivered.length > MAX_UNDELIVERED) undelivered.shift()
  }

  function handle(detail: unknown, receivedAt = now()) {
    if (!isBridgeMessage(detail)) return
    if (detail.kind === 'evt') {
      deliverEvent(detail, receivedAt)
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

    // Events the badge script buffered before this client existed.
    const buffered = win.__MOBILE_APP_BRIDGE_BUFFER__
    win.__MOBILE_APP_BRIDGE_BUFFER__ = undefined
    if (!Array.isArray(buffered)) return
    for (const entry of buffered) {
      const { at, detail } = (entry ?? {}) as { at?: unknown; detail?: unknown }
      handle(detail, typeof at === 'number' ? at : now())
    }
  }

  function nextId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${now().toString(36)}-${(counter++).toString(36)}`
  }

  return {
    get isApp() {
      return appWindow() !== undefined
    },

    get info() {
      const win = appWindow()
      return win ? readInfo(win) : null
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

      pruneUndelivered()
      const replay = undelivered.filter((entry) => entry.message.name === name)
      if (replay.length > 0) {
        undelivered = undelivered.filter((entry) => entry.message.name !== name)
        for (const entry of replay) typed(entry.message.data)
      }

      return () => {
        subscribers.delete(typed)
      }
    },
  }
}

const USER_AGENT_PATTERN = new RegExp(
  `${USER_AGENT_PRODUCT.replace('/', '\\/')} \\((ios|android); ([^;()]*); ([^;()]*)\\)`,
)

/** The injected badge, or the same values from the user-agent when the injection lost its race. */
function readInfo(win: BridgeWindow): AppInfo | null {
  if (win.__MOBILE_APP_BRIDGE__) return win.__MOBILE_APP_BRIDGE__
  const match = USER_AGENT_PATTERN.exec(win.navigator?.userAgent ?? '')
  if (!match) return null
  return { platform: match[1] as AppInfo['platform'], appVersion: match[2]!, buildNumber: match[3]! }
}
