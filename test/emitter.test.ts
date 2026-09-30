import { describe, expect, test } from 'bun:test'
import { createEmitterCore } from '../src/native/emitter'

function names(scripts: string[]) {
  return scripts.map((s) => /"name":"([^"]+)"/.exec(s)?.[1])
}

describe('createEmitterCore', () => {
  test('queues events until connected and ready, then flushes in order', () => {
    const emitter = createEmitterCore()
    const sent: string[] = []
    emitter.emit('a')
    emitter.connect((s) => sent.push(s))
    emitter.emit('b', { x: 1 })
    expect(sent).toHaveLength(0)
    emitter.setReady(true)
    expect(names(sent)).toEqual(['a', 'b'])
    emitter.emit('c')
    expect(names(sent)).toEqual(['a', 'b', 'c'])
  })

  test('queues again while the page reloads and never duplicates', () => {
    const emitter = createEmitterCore()
    const sent: string[] = []
    emitter.connect((s) => sent.push(s))
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
    const sent: string[] = []
    const disconnect = emitter.connect((s) => sent.push(s))
    emitter.setReady(true)
    disconnect()
    expect(() => emitter.emit('queued')).not.toThrow()
    expect(sent).toHaveLength(0)
    const later: string[] = []
    emitter.connect((s) => later.push(s))
    emitter.setReady(true)
    expect(names(later)).toEqual(['queued'])
  })

  test('a stale disconnect does not detach a newer connection', () => {
    const emitter = createEmitterCore()
    const first: string[] = []
    const second: string[] = []
    const disconnectFirst = emitter.connect((s) => first.push(s))
    emitter.connect((s) => second.push(s))
    disconnectFirst()
    emitter.setReady(true)
    emitter.emit('x')
    expect(first).toHaveLength(0)
    expect(names(second)).toEqual(['x'])
  })
})
