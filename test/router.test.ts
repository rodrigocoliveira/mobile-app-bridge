import { describe, expect, test } from 'bun:test'
import { routeMessage, type Handlers } from '../src/native/router'

const trusted = ['localhost']
const origin = 'http://localhost:5055/'
const req = (method: string, params?: unknown) => JSON.stringify({ bridge: 1, kind: 'req', id: 'r1', method, params })

async function respond(raw: string, handlers: Handlers, url = origin) {
  const route = routeMessage(raw, url, handlers, trusted)
  if (route.type !== 'response') throw new Error(`expected response, got ${route.type}`)
  return route.response
}

describe('routeMessage', () => {
  test('calls the handler with params and answers ok', async () => {
    const response = await respond(req('test.echo', { n: 1 }), { 'test.echo': (p) => p })
    expect(response).toEqual({ bridge: 1, kind: 'res', id: 'r1', ok: true, result: { n: 1 } })
  })

  test('awaits async handlers', async () => {
    const response = await respond(req('slow'), { slow: async () => 'done' })
    expect(response).toMatchObject({ ok: true, result: 'done' })
  })

  test('answers UNKNOWN_METHOD for missing handlers, including Object.prototype names', async () => {
    for (const method of ['nope.nothing', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const response = await respond(req(method), {})
      expect(response).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } })
    }
  })

  test('uses the thrown code, or HANDLER_ERROR', async () => {
    const custom = await respond(req('t'), { t: () => { throw Object.assign(new Error('boom'), { code: 'CUSTOM' }) } })
    expect(custom).toMatchObject({ ok: false, error: { code: 'CUSTOM', message: 'boom' } })
    const plain = await respond(req('t'), { t: async () => { throw new Error('plain') } })
    expect(plain).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR', message: 'plain' } })
    const weird = await respond(req('t'), { t: () => { throw 'a string' } })
    expect(weird).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR', message: 'a string' } })
  })

  test('answers HANDLER_ERROR when the result is not JSON-serializable', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const response = await respond(req('t'), { t: () => circular })
    expect(response).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR' } })
    const bigint = await respond(req('t'), { t: () => 10n })
    expect(bigint).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR' } })
  })

  test('drops requests from untrusted origins without calling the handler', () => {
    let called = false
    const route = routeMessage(req('t'), 'http://127.0.0.1:5055/iframe.html', { t: () => { called = true } }, trusted)
    expect(route).toEqual({ type: 'drop', reason: 'untrusted-origin' })
    expect(called).toBe(false)
  })

  test('drops requests from inAppHosts pages: they load in the app but are not trusted', () => {
    // routeMessage only ever receives trustedHosts; inAppHosts must never be passed to it.
    const route = routeMessage(req('t'), 'http://127.0.0.1:5055/second.html', { t: () => 'x' }, trusted)
    expect(route).toEqual({ type: 'drop', reason: 'untrusted-origin' })
  })

  test('drops bridge messages that are not requests', () => {
    const raw = JSON.stringify({ bridge: 1, kind: 'evt', name: 'x' })
    expect(routeMessage(raw, origin, {}, trusted)).toEqual({ type: 'drop', reason: 'unexpected-kind' })
  })

  test('forwards non-bridge messages and invalid JSON to the consumer', () => {
    expect(routeMessage(JSON.stringify({ event_name: 'agendartLogin' }), origin, {}, trusted)).toEqual({ type: 'forward' })
    expect(routeMessage('not json', origin, {}, trusted)).toEqual({ type: 'forward' })
    expect(routeMessage('"a string"', origin, {}, trusted)).toEqual({ type: 'forward' })
  })
})
