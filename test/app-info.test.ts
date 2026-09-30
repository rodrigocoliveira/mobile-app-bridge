import { expect, test } from 'bun:test'
import { resolveAppInfo } from '../src/native/app-info'

test('reads version and platform-specific build number', () => {
  const config = { version: '2.1.0', ios: { buildNumber: '15' }, android: { versionCode: 33 } }
  expect(resolveAppInfo('ios', config)).toEqual({ platform: 'ios', appVersion: '2.1.0', buildNumber: '15' })
  expect(resolveAppInfo('android', config)).toEqual({ platform: 'android', appVersion: '2.1.0', buildNumber: '33' })
})

test('falls back when config is missing and applies overrides', () => {
  expect(resolveAppInfo('ios', null)).toEqual({ platform: 'ios', appVersion: '0.0.0', buildNumber: '0' })
  expect(resolveAppInfo('android', undefined, { appVersion: '9.9.9' })).toMatchObject({ platform: 'android', appVersion: '9.9.9' })
})
