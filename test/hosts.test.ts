import { describe, expect, test } from 'bun:test'
import { hostnameOf, isTrustedHostname, isTrustedUrl, schemeOf } from '../src/native/hosts'

describe('schemeOf / hostnameOf', () => {
  test('parses common URLs', () => {
    expect(schemeOf('HTTPS://App.Brand.com/x')).toBe('https')
    expect(hostnameOf('HTTPS://App.Brand.com/x')).toBe('app.brand.com')
    expect(hostnameOf('http://localhost:5055/')).toBe('localhost')
    expect(hostnameOf('https://app.brand.com.')).toBe('app.brand.com')
    expect(hostnameOf('https://user:pass@app.brand.com/')).toBe('app.brand.com')
    expect(schemeOf('tel:+5511999999999')).toBe('tel')
    expect(hostnameOf('tel:+5511999999999')).toBeNull()
    expect(schemeOf('about:blank')).toBe('about')
    expect(schemeOf('not a url')).toBeNull()
    expect(hostnameOf('')).toBeNull()
  })

  test('does not let userinfo or backslashes spoof the host', () => {
    expect(hostnameOf('https://app.brand.com@evil.io/')).toBe('evil.io')
    expect(hostnameOf('https://evil.io\\@app.brand.com/')).toBe('evil.io')
    expect(hostnameOf('https://evil.io\\app.brand.com')).toBe('evil.io')
  })
})

describe('isTrustedHostname', () => {
  const trusted = ['app.brand.com', '*.cdn.brand.com', 'localhost']

  test('exact match, case-insensitive', () => {
    expect(isTrustedHostname('app.brand.com', trusted)).toBe(true)
    expect(isTrustedHostname('APP.BRAND.COM', trusted)).toBe(true)
    expect(isTrustedHostname('localhost', trusted)).toBe(true)
  })

  test('wildcard matches subdomains only', () => {
    expect(isTrustedHostname('img.cdn.brand.com', trusted)).toBe(true)
    expect(isTrustedHostname('a.b.cdn.brand.com', trusted)).toBe(true)
    expect(isTrustedHostname('cdn.brand.com', trusted)).toBe(false)
  })

  test('rejects look-alikes', () => {
    expect(isTrustedHostname('evilapp.brand.com', trusted)).toBe(false)
    expect(isTrustedHostname('app.brand.com.evil.io', trusted)).toBe(false)
    expect(isTrustedHostname('brand.com', trusted)).toBe(false)
    expect(isTrustedHostname('evilcdn.brand.com', trusted)).toBe(false)
  })
})

describe('isTrustedUrl', () => {
  test('uses the real host', () => {
    expect(isTrustedUrl('https://app.brand.com/dashboard', ['app.brand.com'])).toBe(true)
    expect(isTrustedUrl('https://app.brand.com@evil.io/', ['app.brand.com'])).toBe(false)
    expect(isTrustedUrl('https://evil.io\\@app.brand.com/', ['app.brand.com'])).toBe(false)
    expect(isTrustedUrl('https://app.brand.com.evil.io/', ['app.brand.com'])).toBe(false)
    expect(isTrustedUrl('garbage', ['app.brand.com'])).toBe(false)
  })
})
