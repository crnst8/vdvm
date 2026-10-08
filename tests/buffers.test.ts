import { describe, it, expect } from 'vitest'
import { BufferStore } from '../src/audio/buffers'
import { FakeContext, fakeBuffer } from './fake-audio'

const deferred = () => {
  let resolve!: (v: ArrayBuffer) => void
  const p = new Promise<ArrayBuffer>((r) => (resolve = r))
  return { p, resolve }
}

describe('buffer store', () => {
  it('deduplicates in-flight loads by hash', async () => {
    const ctx = new FakeContext()
    let fetches = 0
    const store = new BufferStore(ctx, async () => (fetches++, new ArrayBuffer(10)))
    const [a, b] = await Promise.all([store.load({ sha256: 'h', url: 'u' }), store.load({ sha256: 'h', url: 'u' })])
    expect(a).toBe(b)
    expect(fetches).toBe(1)
    expect(ctx.decodes).toBe(1)
    await store.load({ sha256: 'h', url: 'u' })
    expect(fetches).toBe(1)
  })
  it('limits concurrent fetches to 4', async () => {
    const ctx = new FakeContext()
    let active = 0
    let peak = 0
    const pending: ReturnType<typeof deferred>[] = []
    const store = new BufferStore(ctx, () => {
      active++
      peak = Math.max(peak, active)
      const d = deferred()
      pending.push(d)
      return d.p.finally(() => active--)
    })
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => store.load({ sha256: `h${i}`, url: 'u' })))
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0))
      pending.shift()?.resolve(new ArrayBuffer(1))
    }
    while (pending.length) {
      await new Promise((r) => setTimeout(r, 0))
      pending.shift()?.resolve(new ArrayBuffer(1))
    }
    await all
    expect(peak).toBeLessThanOrEqual(4)
  })
  it('evicts unpinned least-recently-used buffers past the budget and keeps pinned ones', async () => {
    const ctx = { decodeAudioData: async () => fakeBuffer(100) } // 400 bytes each
    const store = new BufferStore(ctx, async () => new ArrayBuffer(1), 1000)
    await store.loadSet('active', [{ sha256: 'p1', url: '' }, { sha256: 'p2', url: '' }], 800)
    await store.load({ sha256: 'x1', url: '' })
    await store.load({ sha256: 'x2', url: '' })
    expect(store.has('p1') && store.has('p2')).toBe(true)
    expect(store.has('x1')).toBe(false)
    expect(store.usedBytes).toBeLessThanOrEqual(1000)
  })
  it('rejects an oversized staging set before loading', async () => {
    let fetches = 0
    const store = new BufferStore({ decodeAudioData: async () => fakeBuffer(100) }, async () => (fetches++, new ArrayBuffer(1)), 1000)
    await expect(store.loadSet('staging', [{ sha256: 'a', url: '' }], 5000)).rejects.toThrow(/memory budget/)
    expect(fetches).toBe(0)
  })
})
