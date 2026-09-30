import { describe, expect, test } from 'bun:test'
import { BRIDGE_EVENT, type AppInfo } from '../src/shared/protocol'
import { BUFFER_LIMIT, buildBadgeScript, buildDispatchScript, buildUserAgentMarker, composeApplicationName, composeInjectedScript, serializeForScript } from '../src/native/scripts'

const INFO: AppInfo = { platform: 'ios', appVersion: '1.0.0', buildNumber: '7' }

class ScriptWindow extends EventTarget {
  [key: string]: unknown
}

function run(script: string, win = new ScriptWindow()) {
  // eslint-disable-next-line no-new-func
  new Function('window', 'CustomEvent', script)(win, CustomEvent)
  return win
}

describe('serializeForScript', () => {
  test('escapes sequences that could break out of a script', () => {
    const tricky = { a: '</script><script>alert(1)</script>', b: 'line\u2028sep\u2029', c: "quote'\"" }
    const out = serializeForScript(tricky)
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('\u2028')
    expect(out).not.toContain('\u2029')
    expect(new Function(`return ${out}`)()).toEqual(tricky)
  })
})

describe('buildBadgeScript', () => {
  test('sets the badge and buffers events until drained', () => {
    const win = run(buildBadgeScript(INFO))
    expect(win.__MOBILE_APP_BRIDGE__).toEqual(INFO)
    win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'x', data: 1 } }))
    win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'res', id: 'a', ok: true } }))
    expect(win.__MOBILE_APP_BRIDGE_BUFFER__).toEqual([{ bridge: 1, kind: 'evt', name: 'x', data: 1 }])

    win.__MOBILE_APP_BRIDGE_BUFFER__ = undefined // what the web client does on attach
    expect(() => win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'y' } }))).not.toThrow()
  })

  test(`caps the buffer at ${BUFFER_LIMIT}`, () => {
    const win = run(buildBadgeScript(INFO))
    for (let i = 0; i < BUFFER_LIMIT + 3; i++) {
      win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'x', data: i } }))
    }
    const buffer = win.__MOBILE_APP_BRIDGE_BUFFER__ as Array<{ data: number }>
    expect(buffer).toHaveLength(BUFFER_LIMIT)
    expect(buffer[0]!.data).toBe(3)
  })
})

describe('badge script idempotence (re-injected after load on Android)', () => {
  test('a second run keeps the existing buffer and does not double-buffer events', () => {
    const win = run(buildBadgeScript(INFO))
    win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'a' } }))
    run(buildBadgeScript(INFO), win)
    win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'b' } }))
    expect((win.__MOBILE_APP_BRIDGE_BUFFER__ as Array<{ name: string }>).map((e) => e.name)).toEqual(['a', 'b'])
  })

  test('does not recreate the buffer after the web client drained it', () => {
    const win = run(buildBadgeScript(INFO))
    win.__MOBILE_APP_BRIDGE_BUFFER__ = undefined
    run(buildBadgeScript(INFO), win)
    expect(win.__MOBILE_APP_BRIDGE_BUFFER__).toBeUndefined()
  })

  test('installs badge and buffer when the first injection was lost', () => {
    const win = run(buildBadgeScript(INFO), new ScriptWindow())
    expect(win.__MOBILE_APP_BRIDGE__).toEqual(INFO)
    expect(win.__MOBILE_APP_BRIDGE_BUFFER__).toEqual([])
  })
})

describe('user-agent marker', () => {
  test('encodes the app info and strips separator characters', () => {
    expect(buildUserAgentMarker(INFO)).toBe('MobileAppBridge/1 (ios; 1.0.0; 7)')
    expect(buildUserAgentMarker({ platform: 'android', appVersion: '2.0 (beta; x)', buildNumber: '3' })).toBe(
      'MobileAppBridge/1 (android; 2.0 beta x; 3)',
    )
  })

  test('appends to the consumer applicationNameForUserAgent', () => {
    expect(composeApplicationName(INFO)).toBe('MobileAppBridge/1 (ios; 1.0.0; 7)')
    expect(composeApplicationName(INFO, 'BrandApp/3')).toBe('BrandApp/3 MobileAppBridge/1 (ios; 1.0.0; 7)')
  })
})

describe('buildDispatchScript', () => {
  test('dispatches the message as a mobile-app-bridge CustomEvent', () => {
    const win = new ScriptWindow()
    const received: unknown[] = []
    win.addEventListener(BRIDGE_EVENT, (e) => received.push((e as CustomEvent).detail))
    const message = { bridge: 1, kind: 'evt', name: 'x', data: { text: '</script>\u2028' } } as const
    run(buildDispatchScript(message), win)
    expect(received).toEqual([message])
  })
})

describe('composeInjectedScript', () => {
  test('runs the badge first, then the consumer script', () => {
    const win = run(composeInjectedScript(INFO, 'window.order = window.__MOBILE_APP_BRIDGE__ ? "after-badge" : "before-badge"'))
    expect(win.order).toBe('after-badge')
  })

  test('stays valid when the consumer script ends in a comment or lacks a semicolon', () => {
    expect(() => run(composeInjectedScript(INFO, 'window.a = 1 // trailing comment'))).not.toThrow()
    expect(run(composeInjectedScript(INFO, 'window.b = 2')).b).toBe(2)
    expect(run(composeInjectedScript(INFO, '(function(){ window.c = 3 })()')).c).toBe(3)
    expect(() => run(composeInjectedScript(INFO))).not.toThrow()
    expect(run(composeInjectedScript(INFO)).__MOBILE_APP_BRIDGE__).toEqual(INFO)
  })
})
