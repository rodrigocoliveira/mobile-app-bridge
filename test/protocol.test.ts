import { describe, expect, test } from 'bun:test'
import { BADGE_KEY, BRIDGE_EVENT, ErrorCode, isBridgeMessage } from '../src/shared/protocol'

describe('constants', () => {
  test('wire names are stable', () => {
    expect(BRIDGE_EVENT).toBe('mobile-app-bridge')
    expect(BADGE_KEY).toBe('__MOBILE_APP_BRIDGE__')
    expect(Object.values(ErrorCode).sort()).toEqual(
      ['HANDLER_ERROR', 'INVALID_PARAMS', 'NOT_IN_APP', 'TIMEOUT', 'UNKNOWN_METHOD'],
    )
  })
})

describe('isBridgeMessage', () => {
  test('accepts valid requests, responses and events', () => {
    expect(isBridgeMessage({ bridge: 1, kind: 'req', id: 'a', method: 'x.y' })).toBe(true)
    expect(isBridgeMessage({ bridge: 1, kind: 'res', id: 'a', ok: true, result: 1 })).toBe(true)
    expect(isBridgeMessage({ bridge: 1, kind: 'res', id: 'a', ok: false, error: { code: 'X', message: 'm' } })).toBe(true)
    expect(isBridgeMessage({ bridge: 1, kind: 'evt', name: 'app.stateChange', data: {} })).toBe(true)
  })

  test('rejects anything else', () => {
    expect(isBridgeMessage(null)).toBe(false)
    expect(isBridgeMessage('string')).toBe(false)
    expect(isBridgeMessage({ event_name: 'agendartLogin' })).toBe(false)
    expect(isBridgeMessage({ bridge: 2, kind: 'req', id: 'a', method: 'x' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'req', id: 1, method: 'x' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'req', id: 'a' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'res', id: 'a', ok: false })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'evt' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'other', id: 'a' })).toBe(false)
  })
})
