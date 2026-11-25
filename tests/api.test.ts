import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../server/app'
import { LiveMariana } from '../server/mariana'
import { Store } from '../server/store'

let server: Server, base = ''
const weekly = (...c: [string, number][]) => Array.from({ length: 7 }, () => c.map(([time, level]) => ({ time, level })))
const store = new Store(null)
const now = () => new Date('2026-11-30T12:00:00-05:00')
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }
}

beforeAll(async () => {
  server = createApp({ store, now }).listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => server.close())

describe('API (demo Mariana Tek)', () => {
  const range = { from: '2026-12-01', to: '2026-12-09' }
  it('saves settings and previews the rotation', async () => {
    const r = await call('PUT', '/api/config', { startDate: '2026-12-01', genres: ['Strength', 'Endurance', 'Longevity'], levels: 3, weekly: weekly(['06:00', 1], ['17:30', 3]), durationMin: 50, timeZone: 'America/New_York' })
    expect(r.status).toBe(200)
    const p = await call('GET', '/api/preview?from=2026-12-01&to=2026-12-09')
    expect(p.body).toHaveLength(18)
    expect(p.body[17]).toMatchObject({ genre: 'Longevity', level: 3, end: '18:20' })
  })
  it('rejects bad settings', async () => {
    const r = await call('PUT', '/api/config', { startDate: 'x', genres: [], levels: 0, weekly: weekly(['25:00', 1]), durationMin: 50, timeZone: 'Nowhere' })
    expect(r.status).toBe(400)
  })
  it('requires mapping before pushing, then pushes without duplicates', async () => {
    expect((await call('POST', '/api/sync/apply', range)).status).toBe(400)
    const { body: opts } = await call('GET', '/api/mariana/options')
    const typeMap: Record<string, string> = {}
    for (const g of ['Strength', 'Endurance', 'Longevity']) for (const l of [1, 2, 3]) typeMap[`${g}|${l}`] = opts.types.find((t: { name: string }) => t.name === `${g} ${l}`).id
    await call('PUT', '/api/mariana/mapping', { typeMap, layoutId: opts.layouts[0].id })
    const first = await call('POST', '/api/sync/apply', range)
    expect(first.body).toMatchObject({ created: 18, updated: 0, removed: 0 })
    const again = await call('POST', '/api/sync/apply', range)
    expect(again.body).toMatchObject({ created: 0, updated: 0, removed: 0 })
    expect(store.data.demo.classes).toHaveLength(18)
  })
  it('updates unbooked classes and flags booked ones when the rotation shifts', async () => {
    const booked = store.data.pushed.find((p) => p.key === '2026-12-02T06:00')!
    await call('POST', '/api/demo/book', { mtId: booked.mtId })
    await call('PUT', '/api/config', { ...store.data.config, startDate: '2026-12-02' })
    const plan = await call('POST', '/api/sync/plan', range)
    expect(plan.body.update.length).toBe(18)
    const r = await call('POST', '/api/sync/apply', range)
    expect(r.body.updated).toBe(17)
    expect(r.body.flagged).toHaveLength(1)
    expect(r.body.flagged[0].key).toBe('2026-12-02T06:00')
  })
  it('removes unbooked future classes when a time is dropped', async () => {
    await call('PUT', '/api/config', { ...store.data.config, weekly: weekly(['06:00', 1]) })
    const r = await call('POST', '/api/sync/apply', range)
    expect(r.body.removed).toBe(9)
  })
  it('exports CSV', async () => {
    const r = await call('GET', '/api/export.csv?from=2026-12-02&to=2026-12-02')
    expect(r.body).toContain('"2026-12-02","06:00","06:50","Strength","1","Strength 1","1"')
  })
})

describe('LiveMariana', () => {
  it('sends JSON:API requests with a bearer token', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ data: { id: '555', type: 'class_sessions' } }), { status: 201 })
    }) as unknown as typeof fetch
    const c = new LiveMariana('mystudio', 'tok', fake)
    const id = await c.createClass({ startDate: '2026-12-01', startTime: '06:00', typeId: '7', layoutId: '3', instructorIds: [] })
    expect(id).toBe('555')
    expect(calls[0].url).toBe('https://mystudio.marianatek.com/api/class_sessions/')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.data.attributes).toMatchObject({ start_date: '2026-12-01', start_time: '06:00:00' })
    expect(sent.data.relationships.class_session_type.data).toEqual({ type: 'class_session_types', id: '7' })
  })
})

describe('CSV import API', () => {
  const csv = 'Date,Start,Genre,Level\n2026-12-20,07:00,Strength,3\n2026-12-20,08:00,Endurance,1\n2026-11-29,07:00,Strength,1\n'
  it('previews and pushes a whole file, skipping past rows and without duplicates', async () => {
    const plan = await call('POST', '/api/import/plan', { csv })
    expect(plan.body).toMatchObject({ rows: 3, past: 1, errors: [] })
    expect(plan.body.create).toHaveLength(2)
    const r = await call('POST', '/api/import/apply', { csv })
    expect(r.body).toMatchObject({ created: 2, updated: 0, removed: 0 })
    expect((await call('POST', '/api/import/apply', { csv })).body.created).toBe(0)
  })
  it('changes types and only removes missing classes when asked', async () => {
    const next = 'Date,Start,Genre,Level\n2026-12-20,07:00,Longevity,2\n'
    expect((await call('POST', '/api/import/plan', { csv: next })).body).toMatchObject({ update: [expect.anything()], remove: [] })
    const r = await call('POST', '/api/import/apply', { csv: next, removeMissing: true })
    expect(r.body).toMatchObject({ updated: 1, removed: 1 })
  })
  it('re-uploading an edited grid pushes only the differences', async () => {
    const grid = (wed: string, thu: string) => `Time,Wed 12/23/2026,Thu 12/24/2026\n6:15 AM,"🟢 Level 1\n40%",${wed}\n7:15 AM,Level 2,${thu}\n`
    expect((await call('POST', '/api/import/apply', { csv: grid('Level 3', 'Level 1'), removeMissing: true })).body).toMatchObject({ created: 4 })
    const plan = (await call('POST', '/api/import/plan', { csv: grid('Level 2', '-'), removeMissing: true })).body
    expect(plan).toMatchObject({ format: 'grid', unchanged: 2, create: [] })
    expect(plan.update.map((u: { slot: { key: string } }) => u.slot.key)).toEqual(['2026-12-24T06:15'])
    expect(plan.remove.map((r: { key: string }) => r.key)).toEqual(['2026-12-24T07:15'])
    expect((await call('POST', '/api/import/apply', { csv: grid('Level 2', '-'), removeMissing: true })).body).toMatchObject({ created: 0, updated: 1, removed: 1 })
  })
  it('refuses to push a file with row errors', async () => {
    const r = await call('POST', '/api/import/apply', { csv: 'Date,Start,Genre,Level\nnope,07:00,Strength,1\n' })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('row error')
  })
})
