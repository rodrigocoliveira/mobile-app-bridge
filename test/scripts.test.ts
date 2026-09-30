import { describe, expect, test } from 'bun:test'
import { BRIDGE_EVENT, type AppInfo } from '../src/shared/protocol'
import { buildBadgeScript, buildDispatchScript, composeInjectedScript, serializeForScript } from '../src/native/scripts'

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
  test('sets the badge and nothing else (no in-page buffer, no listeners)', () => {
    const win = run(buildBadgeScript(INFO))
    expect(win.__MOBILE_APP_BRIDGE__).toEqual(INFO)
    expect('__MOBILE_APP_BRIDGE_BUFFER__' in win).toBe(false)
  })

  test('is safe to run twice (re-injected after load for the Android race)', () => {
    const win = run(buildBadgeScript(INFO))
    run(buildBadgeScript(INFO), win)
    expect(win.__MOBILE_APP_BRIDGE__).toEqual(INFO)
  })
})

describe('buildDispatchScript', () => {
  function dispatchOn(hostname: string, trustedHosts: string[], message: object) {
    const win = new ScriptWindow()
    const received: unknown[] = []
    win.addEventListener(BRIDGE_EVENT, (e) => received.push((e as CustomEvent).detail))
    new Function('window', 'CustomEvent', 'location', buildDispatchScript(message as never, trustedHosts))(win, CustomEvent, { hostname })
    return received
  }

  test('dispatches the message as a mobile-app-bridge CustomEvent on a trusted page', () => {
    const message = { bridge: 1, kind: 'evt', name: 'x', data: { text: '</script>\u2028' } }
    expect(dispatchOn('localhost', ['localhost'], message)).toEqual([message])
  })

  test('never dispatches into a page whose host is not trusted (inAppHosts, third parties)', () => {
    const message = { bridge: 1, kind: 'evt', name: 'push.opened', data: { token: 'secret' } }
    expect(dispatchOn('127.0.0.1', ['localhost'], message)).toEqual([])
    expect(dispatchOn('files.s3.amazonaws.com', ['app.brand.com'], message)).toEqual([])
    expect(dispatchOn('evilbrand.com', ['*.brand.com'], message)).toEqual([])
    expect(dispatchOn('brand.com', ['*.brand.com'], message)).toEqual([])
  })

  test('matches hosts like the native side: case-insensitive, trailing dot, wildcard subdomains', () => {
    const message = { bridge: 1, kind: 'evt', name: 'x' }
    expect(dispatchOn('APP.BRAND.COM', ['app.brand.com'], message)).toHaveLength(1)
    expect(dispatchOn('app.brand.com.', ['app.brand.com'], message)).toHaveLength(1)
    expect(dispatchOn('a.b.brand.com', ['*.brand.com'], message)).toHaveLength(1)
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
