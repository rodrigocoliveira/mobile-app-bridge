import {
  ErrorCode,
  isBridgeMessage,
  type ErrorPayload,
  type RequestMessage,
  type ResponseMessage,
} from '../shared/protocol'
import { isTrustedUrl } from './hosts'

// `any` is intentional: handlers type their own params.
export type Handler = (params: any) => unknown
export type Handlers = Record<string, Handler>

export type RouteResult =
  | { type: 'forward' }
  | { type: 'drop'; reason: 'untrusted-origin' | 'unexpected-kind' }
  | { type: 'response'; response: Promise<ResponseMessage> }

export function routeMessage(
  raw: string,
  sourceUrl: string,
  handlers: Handlers,
  trustedHosts: readonly string[],
): RouteResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { type: 'forward' }
  }

  if (!isBridgeMessage(parsed)) return { type: 'forward' }
  if (parsed.kind !== 'req') return { type: 'drop', reason: 'unexpected-kind' }
  if (!isTrustedUrl(sourceUrl, trustedHosts)) return { type: 'drop', reason: 'untrusted-origin' }

  return { type: 'response', response: runHandler(parsed, handlers) }
}

export async function runHandler(request: RequestMessage, handlers: Handlers): Promise<ResponseMessage> {
  // Own-property check so names like "toString" never reach Object.prototype.
  const handler = Object.prototype.hasOwnProperty.call(handlers, request.method) ? handlers[request.method] : undefined
  if (!handler) {
    return failure(request.id, { code: ErrorCode.UNKNOWN_METHOD, message: `No handler registered for "${request.method}"` })
  }

  let result: unknown
  try {
    result = await handler(request.params)
  } catch (error) {
    return failure(request.id, toErrorPayload(error))
  }

  try {
    JSON.stringify(result)
  } catch {
    return failure(request.id, {
      code: ErrorCode.HANDLER_ERROR,
      message: `Result of "${request.method}" is not JSON-serializable`,
    })
  }

  return { bridge: 1, kind: 'res', id: request.id, ok: true, result }
}

function failure(id: string, error: ErrorPayload): ResponseMessage {
  return { bridge: 1, kind: 'res', id, ok: false, error }
}

function toErrorPayload(error: unknown): ErrorPayload {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    return {
      code: typeof code === 'string' ? code : ErrorCode.HANDLER_ERROR,
      message: typeof message === 'string' ? message : describe(error),
    }
  }
  return { code: ErrorCode.HANDLER_ERROR, message: describe(error) }
}

// String() throws on prototype-less objects; a throw here would leave the page waiting until TIMEOUT.
function describe(value: unknown): string {
  try {
    return String(value)
  } catch {
    return 'Unknown error'
  }
}
