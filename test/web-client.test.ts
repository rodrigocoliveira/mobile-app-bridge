import { describe, expect, test } from 'bun:test'
import { BRIDGE_EVENT, type AppInfo, type RequestMessage } from '../src/shared/protocol'
import { BridgeError } from '../src/web/errors'
import { createBridgeClient, MAX_UNDELIVERED, type BridgeWindow } from '../src/web/client'

const INFO: AppInfo = { platform: 'ios', appVersion: '1.2.3', buildNumber: '42' }

class FakeWindow extends EventTarget implements BridgeWindow {
  __MOBILE_APP_BRIDGE__?: AppInfo
  __MOBILE_APP_BRIDGE_BUFFER__?: unknown[]
  ReactNativeWebView?: { postMessage(message: string): void }
  posted: RequestMessage[] = []
}

function appWindow(): FakeWindow {
  const win = new FakeWindow()
  win.__MOBILE_APP_BRIDGE__ = INFO
  win.ReactNativeWebView = { postMessage: (message) => win.posted.push(JSON.parse(message)) }
  return win
}

async function rejection(promise: Promise<unknown>): Promise<BridgeError> {
  try {
    await promise
  } catch (error) {
    return error as BridgeError
  }
  throw new Error('expected the promise to reject')
}

function deliver(win: FakeWindow, detail: unknown) {
  win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail }))
}

describe('detection', () => {
  test('isApp is false without a window, without the badge, or without ReactNativeWebView', () => {
    expect(createBridgeClient(() => undefined).isApp).toBe(false)
    expect(createBridgeClient(() => new FakeWindow()).isApp).toBe(false)
    const badgeOnly = new FakeWindow()
    badgeOnly.__MOBILE_APP_BRIDGE__ = INFO
    expect(createBridgeClient(() => badgeOnly).isApp).toBe(false)
  })

  test('isApp and info reflect the badge inside the app', () => {
    const client = createBridgeClient(() => appWindow())
    expect(client.isApp).toBe(true)
    expect(client.info).toEqual(INFO)
    expect(createBridgeClient(() => new FakeWindow()).info).toBeNull()
  })

  test('importing the web entry without a window does not throw (SSR)', async () => {
    const mod = await import('../src/web/index')
    expect(mod.bridge.isApp).toBe(false)
  })
})

describe('call', () => {
  test('rejects with NOT_IN_APP outside the app and posts nothing', async () => {
    const win = new FakeWindow()
    const client = createBridgeClient(() => win)
    const error = await rejection(client.call('x'))
    expect(error).toBeInstanceOf(BridgeError)
    expect(error.code).toBe('NOT_IN_APP')
    expect(win.posted).toHaveLength(0)
  })

  test('posts a request and resolves with the matching response', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const promise = client.call<{ echoed: number }>('test.echo', { n: 1 })
    const request = win.posted[0]!
    expect(request).toMatchObject({ bridge: 1, kind: 'req', method: 'test.echo', params: { n: 1 } })
    deliver(win, { bridge: 1, kind: 'res', id: 'other-id', ok: true, result: 'wrong' })
    deliver(win, { bridge: 1, kind: 'res', id: request.id, ok: true, result: { echoed: 1 } })
    expect(await promise).toEqual({ echoed: 1 })
  })

  test('omits params when undefined', () => {
    const win = appWindow()
    void createBridgeClient(() => win).call('x', undefined, { timeout: 0 }).catch(() => {})
    expect('params' in win.posted[0]!).toBe(false)
  })

  test('concurrent calls resolve independently', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const a = client.call('a')
    const b = client.call('b')
    const [reqA, reqB] = win.posted
    deliver(win, { bridge: 1, kind: 'res', id: reqB!.id, ok: true, result: 'B' })
    deliver(win, { bridge: 1, kind: 'res', id: reqA!.id, ok: true, result: 'A' })
    expect(await Promise.all([a, b])).toEqual(['A', 'B'])
  })

  test('rejects with the error code and message from the native side', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const promise = client.call('test.throw')
    deliver(win, { bridge: 1, kind: 'res', id: win.posted[0]!.id, ok: false, error: { code: 'CUSTOM', message: 'boom' } })
    const error = await rejection(promise)
    expect(error).toBeInstanceOf(BridgeError)
    expect(error.code).toBe('CUSTOM')
    expect(error.message).toBe('boom')
  })

  test('rejects with TIMEOUT and ignores a late response', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const error = await rejection(client.call('test.sleep', undefined, { timeout: 10 }))
    expect(error.code).toBe('TIMEOUT')
    expect(() => deliver(win, { bridge: 1, kind: 'res', id: win.posted[0]!.id, ok: true })).not.toThrow()
  })

  test('rejects with INVALID_PARAMS when params cannot be serialized, and posts nothing', async () => {
    const win = appWindow()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const error = await rejection(createBridgeClient(() => win).call('x', circular))
    expect(error.code).toBe('INVALID_PARAMS')
    expect(win.posted).toHaveLength(0)
  })

  test('ignores non-bridge and malformed events', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const promise = client.call('x', undefined, { timeout: 20 })
    deliver(win, { event_name: 'legacy' })
    deliver(win, 'garbage')
    deliver(win, null)
    expect((await rejection(promise)).code).toBe('TIMEOUT')
  })
})

describe('on', () => {
  test('delivers events to subscribers and stops after unsubscribe', () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const received: unknown[] = []
    const off = client.on('app.stateChange', (data) => received.push(data))
    deliver(win, { bridge: 1, kind: 'evt', name: 'app.stateChange', data: { state: 'active' } })
    off()
    deliver(win, { bridge: 1, kind: 'evt', name: 'app.stateChange', data: { state: 'background' } })
    expect(received).toEqual([{ state: 'active' }])
  })

  test('drains the in-page buffer filled before the client attached, exactly once', () => {
    const win = appWindow()
    win.__MOBILE_APP_BRIDGE_BUFFER__ = [{ bridge: 1, kind: 'evt', name: 'push.opened', data: { url: '/a' } }]
    const client = createBridgeClient(() => win)
    const received: unknown[] = []
    client.on('push.opened', (data) => received.push(data))
    client.on('push.opened', (data) => received.push(data))
    expect(received).toEqual([{ url: '/a' }])
    expect(win.__MOBILE_APP_BRIDGE_BUFFER__).toBeUndefined()
  })

  test('replays an unsubscribed event to the first subscriber within 10s only', () => {
    let clock = 0
    const win = appWindow()
    const client = createBridgeClient(() => win, { now: () => clock })
    client.on('unrelated', () => {})
    deliver(win, { bridge: 1, kind: 'evt', name: 'fresh', data: 1 })
    deliver(win, { bridge: 1, kind: 'evt', name: 'stale', data: 2 })

    clock = 9_000
    const fresh: unknown[] = []
    client.on('fresh', (data) => fresh.push(data))
    expect(fresh).toEqual([1])

    clock = 10_001
    const stale: unknown[] = []
    client.on('stale', (data) => stale.push(data))
    expect(stale).toEqual([])
  })

  test(`keeps at most ${MAX_UNDELIVERED} undelivered events`, () => {
    const win = appWindow()
    const client = createBridgeClient(() => win, { now: () => 0 })
    client.on('unrelated', () => {})
    for (let i = 0; i < MAX_UNDELIVERED + 5; i++) deliver(win, { bridge: 1, kind: 'evt', name: 'burst', data: i })
    const received: unknown[] = []
    client.on('burst', (data) => received.push(data))
    expect(received).toHaveLength(MAX_UNDELIVERED)
    expect(received[0]).toBe(5)
  })
})
