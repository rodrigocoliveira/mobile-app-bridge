import { createBridgeClient, type BridgeWindow } from './client'

/** Shared client for the current page. Safe to import during SSR: it only reads `window` when used. */
export const bridge = createBridgeClient(() =>
  typeof window === 'undefined' ? undefined : (window as unknown as BridgeWindow),
)

export { createBridgeClient } from './client'
export type { BridgeClient, BridgeWindow, CallOptions } from './client'
export { BridgeError } from './errors'
export { ErrorCode } from '../shared/protocol'
export type { AppInfo } from '../shared/protocol'
