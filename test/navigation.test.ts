import { describe, expect, mock, test } from 'bun:test'
import { composeNavigationHandler, decideNavigation, type HostLists } from '../src/native/navigation'

const hosts: HostLists = { trustedHosts: ['app.brand.com'], inAppHosts: ['*.amazonaws.com'] }

describe('decideNavigation', () => {
  test('loads trusted http(s) in the WebView', () => {
    expect(decideNavigation({ url: 'https://app.brand.com/x', isTopFrame: true }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'https://app.brand.com/x' }, hosts)).toBe('load')
  })

  test('loads inAppHosts in the WebView too', () => {
    expect(decideNavigation({ url: 'https://files.s3.amazonaws.com/a.pdf', isTopFrame: true }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'https://amazonaws.com.evil.io/', isTopFrame: true }, hosts)).toBe('open-external')
  })

  test('loads any http(s) subframe so third-party iframes keep working', () => {
    expect(decideNavigation({ url: 'https://www.google.com/recaptcha/api2/anchor', isTopFrame: false }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'https://www.googletagmanager.com/ns.html?id=GTM-X', isTopFrame: false }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'about:blank', isTopFrame: false }, hosts)).toBe('load')
  })

  test('blocks dangerous schemes in the top frame', () => {
    for (const url of ['about:blank', 'blob:https://app.brand.com/1', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi']) {
      expect(decideNavigation({ url, isTopFrame: true }, hosts)).toBe('block')
    }
    expect(decideNavigation({ url: 'not a url' }, hosts)).toBe('block')
  })

  test('opens everything else externally', () => {
    for (const url of ['https://example.com', 'https://app.brand.com@evil.io/', 'tel:+551199', 'mailto:a@b.com', 'whatsapp://send?text=hi']) {
      expect(decideNavigation({ url, isTopFrame: true }, hosts)).toBe('open-external')
    }
  })
})

describe('composeNavigationHandler', () => {
  test('consumer true/false wins and skips the default policy', () => {
    const openExternal = mock(() => {})
    const allow = composeNavigationHandler(() => true, () => hosts, openExternal)
    const deny = composeNavigationHandler(() => false, () => hosts, openExternal)
    expect(allow({ url: 'https://example.com' })).toBe(true)
    expect(deny({ url: 'https://app.brand.com' })).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  test('consumer undefined falls back to the default policy', () => {
    const openExternal = mock((_url: string) => {})
    const handler = composeNavigationHandler(() => undefined, () => hosts, openExternal)
    expect(handler({ url: 'https://app.brand.com/x' })).toBe(true)
    expect(handler({ url: 'https://example.com' })).toBe(false)
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(handler({ url: 'about:blank', isTopFrame: true })).toBe(false)
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  test('works without a consumer and reads host lists lazily', () => {
    let current: HostLists = { trustedHosts: [], inAppHosts: [] }
    const handler = composeNavigationHandler(undefined, () => current, () => {})
    expect(handler({ url: 'https://app.brand.com' })).toBe(false)
    current = hosts
    expect(handler({ url: 'https://app.brand.com' })).toBe(true)
  })
})
