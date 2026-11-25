import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../server/app'
import { Store } from '../server/store'

let server: Server, base = ''
const store = new Store(null)
const now = () => new Date('2026-11-30T12:00:00-05:00')
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json() }
}
const weekly = (...c: [string, number][]) => Array.from({ length: 7 }, () => c.map(([time, level]) => ({ time, level })))
const types = () => Object.fromEntries(store.data.demo.classes.map((c) => [`${c.startDate}T${c.startTime}`, c.typeId]))

beforeAll(async () => {
  server = createApp({ store, now }).listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await call('PUT', '/api/config', { ...store.data.config, startDate: '2026-12-01', weekly: weekly(['06:00', 1], ['17:30', 3]) })
  const { body: opts } = await call('GET', '/api/mariana/options')
  const id = (name: string) => opts.types.find((t: { name: string }) => t.name === name).id
  const typeMap: Record<string, string> = { '|1': id('Level 1'), '|2': id('Level 2'), '|3': id('Level 3') }
  for (const g of ['Strength', 'Endurance', 'Longevity']) for (const l of [1, 2, 3]) typeMap[`${g}|${l}`] = id(`${g} ${l}`)
  await call('PUT', '/api/mariana/mapping', { typeMap, layoutId: opts.layouts[0].id })
})
afterAll(() => server.close())

describe('weekly push, then genre push', () => {
  const weeks = { from: '2026-12-01', to: '2026-12-14' }
  it('genre push waits for the weekly classes', async () => {
    const p = (await call('POST', '/api/sync/plan', { ...weeks, mode: 'genre' })).body
    expect(p).toMatchObject({ waiting: 28, create: [], update: [], remove: [] })
  })
  it('weekly push creates level-only classes, idempotently', async () => {
    expect((await call('POST', '/api/sync/apply', { ...weeks, mode: 'weekly' })).body).toMatchObject({ created: 28, updated: 0 })
    expect(types()['2026-12-01T06:00']).toBe('demo-type-01')
    expect(types()['2026-12-01T17:30']).toBe('demo-type-03')
    expect(store.data.pushed.every((p) => p.genre === '')).toBe(true)
    expect((await call('POST', '/api/sync/plan', { ...weeks, mode: 'weekly' })).body).toMatchObject({ create: [], update: [], remove: [], unchanged: 28 })
  })
  it('genre push only sets genres, for the chosen weeks', async () => {
    const r = await call('POST', '/api/sync/apply', { from: '2026-12-01', to: '2026-12-07', mode: 'genre' })
    expect(r.body).toMatchObject({ created: 0, updated: 14, removed: 0 })
    expect(types()['2026-12-01T06:00']).toBe('demo-type-11') // Strength 1
    expect(types()['2026-12-02T17:30']).toBe('demo-type-23') // Endurance 3
    expect(types()['2026-12-08T06:00']).toBe('demo-type-01') // week 2 still level only
    expect(store.data.demo.classes).toHaveLength(28)
  })
  it('a later weekly change keeps genres and moves only what changed', async () => {
    await call('PUT', '/api/config', { ...store.data.config, weekly: weekly(['06:00', 2], ['18:30', 3]) })
    const r = (await call('POST', '/api/sync/apply', { ...weeks, mode: 'weekly' })).body
    expect(r).toMatchObject({ created: 14, updated: 14, removed: 14 })
    expect(types()['2026-12-01T06:00']).toBe('demo-type-12') // Strength 2 kept its genre
    expect(types()['2026-12-08T06:00']).toBe('demo-type-02')
    expect(types()['2026-12-01T18:30']).toBe('demo-type-03') // new class, genre not pushed yet
    expect((await call('POST', '/api/sync/plan', { ...weeks, mode: 'genre' })).body).toMatchObject({ waiting: 0 })
  })
})
