import { describe, expect, test } from 'bun:test'
import { createEmitterCore } from '../src/native/emitter'

import type { EventMessage } from '../src/shared/protocol'

function names(messages: EventMessage[]) {
  return messages.map((message) => message.name)
}

describe('createEmitterCore', () => {
  test('sends immediately to the connected WebView, like the Agendart bridge', () => {
    const emitter = createEmitterCore()
    const sent: EventMessage[] = []
    emitter.connect((m) => sent.push(m))
    emitter.emit('a')
    emitter.emit('b', { x: 1 })
    expect(sent).toEqual([
      { bridge: 1, kind: 'evt', name: 'a' },
      { bridge: 1, kind: 'evt', name: 'b', data: { x: 1 } },
    ])
  })

  test('drops events while no WebView is connected instead of queuing them', () => {
    const emitter = createEmitterCore()
    expect(emitter.emit('early')).toBe(false)
    const sent: EventMessage[] = []
    emitter.connect((m) => sent.push(m))
    expect(sent).toEqual([])
    expect(emitter.emit('now')).toBe(true)
    expect(names(sent)).toEqual(['now'])
  })

  test('disconnect stops sending', () => {
    const emitter = createEmitterCore()
    const sent: EventMessage[] = []
    const disconnect = emitter.connect((m) => sent.push(m))
    disconnect()
    expect(emitter.emit('x')).toBe(false)
    expect(sent).toEqual([])
  })

  test('a stale disconnect does not detach a newer connection', () => {
    const emitter = createEmitterCore()
    const first: EventMessage[] = []
    const second: EventMessage[] = []
    const disconnectFirst = emitter.connect((m) => first.push(m))
    emitter.connect((m) => second.push(m))
    disconnectFirst()
    emitter.emit('x')
    expect(first).toHaveLength(0)
    expect(names(second)).toEqual(['x'])
  })
})
