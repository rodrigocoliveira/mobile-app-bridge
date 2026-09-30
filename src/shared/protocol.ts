export const PROTOCOL_MARKER = 1 as const
export const BRIDGE_EVENT = 'mobile-app-bridge'
export const BADGE_KEY = '__MOBILE_APP_BRIDGE__'
export const BUFFER_KEY = '__MOBILE_APP_BRIDGE_BUFFER__'
export const DEFAULT_TIMEOUT = 30_000

export const ErrorCode = {
  NOT_IN_APP: 'NOT_IN_APP',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  HANDLER_ERROR: 'HANDLER_ERROR',
  INVALID_PARAMS: 'INVALID_PARAMS',
} as const

export type Platform = 'ios' | 'android'

export interface AppInfo {
  platform: Platform
  appVersion: string
  buildNumber: string
}

export interface RequestMessage {
  bridge: typeof PROTOCOL_MARKER
  kind: 'req'
  id: string
  method: string
  params?: unknown
}

export interface ErrorPayload {
  code: string
  message: string
}

export type ResponseMessage =
  | { bridge: typeof PROTOCOL_MARKER; kind: 'res'; id: string; ok: true; result?: unknown }
  | { bridge: typeof PROTOCOL_MARKER; kind: 'res'; id: string; ok: false; error: ErrorPayload }

export interface EventMessage {
  bridge: typeof PROTOCOL_MARKER
  kind: 'evt'
  name: string
  data?: unknown
}

export type BridgeMessage = RequestMessage | ResponseMessage | EventMessage

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (message.bridge !== PROTOCOL_MARKER) return false

  switch (message.kind) {
    case 'req':
      return typeof message.id === 'string' && typeof message.method === 'string'
    case 'res':
      if (typeof message.id !== 'string' || typeof message.ok !== 'boolean') return false
      return message.ok || (typeof message.error === 'object' && message.error !== null)
    case 'evt':
      return typeof message.name === 'string'
    default:
      return false
  }
}
