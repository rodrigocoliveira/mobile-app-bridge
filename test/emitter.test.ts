import { describe, expect, test } from 'bun:test'
import { createEmitterCore, isNewDocumentLoad } from '../src/native/emitter'

import type { EventMessage } from '../src/shared/protocol'

function names(messages: EventMessage[]) {
  return messages.map((message) => message.name)
}

describe('createEmitterCore', () => {
  test('queues events until connected and ready, then flushes in order', () => {
    const emitter = createEmitterCore()
    const sent: EventMessage[] = []
    emitter.emit('a')
    emitter.connect((m) => sent.push(m))
    emitter.emit('b', { x: 1 })
    expect(sent).toHaveLength(0)
    emitter.setReady(true)
    expect(names(sent)).toEqual(['a', 'b'])
    emitter.emit('c')
    expect(names(sent)).toEqual(['a', 'b', 'c'])
  })

  test('queues again while the page reloads and never duplicates', () => {
    const emitter = createEmitterCore()
    const sent: EventMessage[] = []
    emitter.connect((m) => sent.push(m))
    emitter.setReady(true)
    emitter.emit('before')
    emitter.setReady(false) // onLoadStart of a reload
    emitter.emit('during')
    expect(names(sent)).toEqual(['before'])
    emitter.setReady(true) // onLoadEnd
    expect(names(sent)).toEqual(['before', 'during'])
    emitter.setReady(true)
    expect(names(sent)).toEqual(['before', 'during'])
  })

  test('disconnect stops sending and keeps queuing without throwing', () => {
    const emitter = createEmitterCore()
    const sent: EventMessage[] = []
    const disconnect = emitter.connect((m) => sent.push(m))
    emitter.setReady(true)
    disconnect()
    expect(() => emitter.emit('queued')).not.toThrow()
    expect(sent).toHaveLength(0)
    const later: EventMessage[] = []
    emitter.connect((m) => later.push(m))
    emitter.setReady(true)
    expect(names(later)).toEqual(['queued'])
  })

  test('a stale disconnect does not detach a newer connection', () => {
    const emitter = createEmitterCore()
    const first: EventMessage[] = []
    const second: EventMessage[] = []
    const disconnectFirst = emitter.connect((m) => first.push(m))
    emitter.connect((m) => second.push(m))
    disconnectFirst()
    emitter.setReady(true)
    emitter.emit('x')
    expect(first).toHaveLength(0)
    expect(names(second)).toEqual(['x'])
  })
})

describe('isNewDocumentLoad', () => {
  test('a load start reported while the page is still loading pauses the queue', () => {
    expect(isNewDocumentLoad({ loading: true })).toBe(true)
    expect(isNewDocumentLoad({})).toBe(true)
  })

  test('a load start on an already loaded page does not pause it (Android pushState/replaceState, iOS downloads)', () => {
    expect(isNewDocumentLoad({ loading: false })).toBe(false)
  })
})
