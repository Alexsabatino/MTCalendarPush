import express from 'express'
import { z } from 'zod'
import { addDays, endTime, generateSlots, nowTimeIn, todayIn, typeKey, type Slot } from '../shared/rotation'
import { planSync, type SyncPlan } from '../shared/sync'
import { importSchedule } from '../shared/csvImport'
import { DemoMariana, LiveMariana, MarianaError, type MarianaClient } from './mariana'
import { Store } from './store'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const configSchema = z.object({
  startDate: date,
  genres: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  levels: z.number().int().min(1).max(10),
  times: z.array(time).max(24).refine((t) => new Set(t).size === t.length, 'Class times must be unique'),
  durationMin: z.number().int().min(5).max(240),
  timeZone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false } }, 'Unknown time zone'),
})
const rangeSchema = z.object({ from: date, to: date }).refine((r) => r.from <= r.to && r.to <= addDays(r.from, 400), 'Range must be in order and at most 400 days')

export interface AppOptions { store: Store; client?: MarianaClient; now?: () => Date }

export function createApp({ store, client, now = () => new Date() }: AppOptions) {
  const app = express()
  app.use(express.json({ limit: '3mb' }))
  const demo = new DemoMariana(store.data.demo, () => store.save())
  const mt = (): MarianaClient => {
    if (client) return client
    demo.genres = store.data.config.genres
    demo.levels = store.data.config.levels
    return demo
  }
  const nowKey = () => {
    const tz = store.data.config.timeZone
    return `${todayIn(tz, now())}T${nowTimeIn(tz, now())}`
  }
  const slots = (from: string, to: string) => generateSlots(from, to, store.data.config, store.data.skips)
  const plan = (from: string, to: string): SyncPlan =>
    planSync(slots(from, to), store.data.pushed, (g, l) => store.data.typeMap[typeKey(g, l)], from, to, nowKey())
  const note = (s: Slot) => `${s.genre} · Level ${s.level}${s.cycleDay ? ` (rotation day ${s.cycleDay})` : ''}`

  app.get('/api/state', (_req, res) => {
    const c = mt()
    res.json({
      config: store.data.config, skips: store.data.skips, typeMap: store.data.typeMap, layoutId: store.data.layoutId,
      instructorIds: store.data.instructorIds, pushedCount: store.data.pushed.length, today: todayIn(store.data.config.timeZone, now()),
      connection: { mode: c.mode, label: c.label },
    })
  })

  app.put('/api/config', (req, res) => {
    const cfg = configSchema.parse(req.body)
    store.data.config = cfg
    store.log('settings', `Start ${cfg.startDate}, order ${cfg.genres.join(' → ')}, levels 1–${cfg.levels}, times ${cfg.times.join(', ') || 'none'}`)
    res.json(cfg)
  })

  app.put('/api/skips', (req, res) => {
    store.data.skips = z.array(z.object({ date, time: time.optional(), note: z.string().max(120).optional() })).max(1000).parse(req.body)
    store.log('skips', `${store.data.skips.length} skipped date(s)/class(es)`)
    res.json(store.data.skips)
  })

  app.get('/api/preview', (req, res) => {
    const { from, to } = rangeSchema.parse(req.query)
    const pushed = new Map(store.data.pushed.map((p) => [p.key, p]))
    res.json(slots(from, to).map((s) => ({ ...s, end: endTime(s.time, store.data.config.durationMin), mtId: pushed.get(s.key)?.mtId ?? null })))
  })

  app.get('/api/mariana/options', async (_req, res) => {
    const c = mt()
    const [types, layouts] = await Promise.all([c.listClassTypes(), c.listLayouts()])
    res.json({ types, layouts })
  })

  app.put('/api/mariana/mapping', (req, res) => {
    const body = z.object({ typeMap: z.record(z.string(), z.string()), layoutId: z.string(), instructorIds: z.array(z.string()).default([]) }).parse(req.body)
    Object.assign(store.data, body)
    store.log('mapping', `Mapped ${Object.values(body.typeMap).filter(Boolean).length} class types`)
    res.json(body)
  })

  app.post('/api/sync/plan', (req, res) => {
    const { from, to } = rangeSchema.parse(req.body)
    const p = plan(from, to)
    res.json({ create: p.create, update: p.update.map((u) => ({ slot: u.slot, mtId: u.pushed.mtId, from: `${u.pushed.genre} L${u.pushed.level}` })), remove: p.remove, unchanged: p.unchanged, missingTypes: p.missingTypes })
  })

  const applyPlan = async (p: SyncPlan, label: string) => {
    const c = mt()
    const result = { created: 0, updated: 0, removed: 0, flagged: [] as { key: string; mtId: string; reason: string }[], errors: [] as string[] }
    for (const slot of p.create) {
      try {
        const typeId = store.data.typeMap[typeKey(slot.genre, slot.level)]
        const mtId = await c.createClass({ startDate: slot.date, startTime: slot.time, typeId, layoutId: store.data.layoutId, instructorIds: store.data.instructorIds, publicNote: note(slot) })
        store.data.pushed.push({ key: slot.key, mtId, genre: slot.genre, level: slot.level, typeId, createdAt: new Date().toISOString() })
        store.save()
        result.created++
      } catch (e) { result.errors.push(`${slot.key}: ${(e as Error).message}`) }
    }
    for (const u of p.update) {
      try {
        const booked = await c.reservationCount(u.pushed.mtId)
        if (booked > 0) { result.flagged.push({ key: u.slot.key, mtId: u.pushed.mtId, reason: `${booked} booking(s); should change from ${u.pushed.genre} L${u.pushed.level} to ${u.slot.genre} L${u.slot.level}` }); continue }
        await c.changeClassType(u.pushed.mtId, u.typeId, note(u.slot))
        Object.assign(u.pushed, { genre: u.slot.genre, level: u.slot.level, typeId: u.typeId })
        store.save()
        result.updated++
      } catch (e) { result.errors.push(`${u.slot.key}: ${(e as Error).message}`) }
    }
    for (const r of p.remove) {
      try {
        const booked = await c.reservationCount(r.mtId)
        if (booked > 0) { result.flagged.push({ key: r.key, mtId: r.mtId, reason: `${booked} booking(s); not in the new schedule. Cancel it in Mariana Tek if needed.` }); continue }
        await c.deleteClass(r.mtId)
        store.data.pushed = store.data.pushed.filter((x) => x !== r)
        store.save()
        result.removed++
      } catch (e) { result.errors.push(`${r.key}: ${(e as Error).message}`) }
    }
    store.log('push', `${label}: ${result.created} created, ${result.updated} updated, ${result.removed} removed, ${result.flagged.length} flagged, ${result.errors.length} errors`)
    return result
  }
  const readyError = (p: SyncPlan) =>
    !store.data.layoutId ? 'Choose a room layout in the Mariana Tek tab first.'
      : p.missingTypes.length ? `Map a Mariana Tek class type for: ${p.missingTypes.join(', ')}` : null

  app.post('/api/sync/apply', async (req, res) => {
    const { from, to } = rangeSchema.parse(req.body)
    const p = plan(from, to)
    const err = readyError(p)
    if (err) return res.status(400).json({ error: err })
    res.json(await applyPlan(p, `Rotation ${from} to ${to}`))
  })

  const importBody = z.object({ csv: z.string().max(2_000_000), removeMissing: z.boolean().default(false) })
  const importPlan = (csv: string, removeMissing: boolean) => {
    const cfg = store.data.config
    const parsed = importSchedule(csv, cfg.genres, cfg.levels)
    const nk = nowKey()
    const past = parsed.slots.filter((s) => s.key <= nk).length
    const p = parsed.from && parsed.to
      ? planSync(parsed.slots, store.data.pushed, (g, l) => store.data.typeMap[typeKey(g, l)], parsed.from, parsed.to, nk)
      : { create: [], update: [], remove: [], unchanged: 0, missingTypes: [] } as SyncPlan
    if (!removeMissing) p.remove = []
    return { parsed, past, p }
  }

  app.post('/api/import/plan', (req, res) => {
    const { csv, removeMissing } = importBody.parse(req.body)
    const { parsed, past, p } = importPlan(csv, removeMissing)
    res.json({
      rows: parsed.slots.length, errors: parsed.errors, from: parsed.from, to: parsed.to, past,
      create: p.create, update: p.update.map((u) => ({ slot: u.slot, mtId: u.pushed.mtId, from: `${u.pushed.genre} L${u.pushed.level}` })),
      remove: p.remove, unchanged: p.unchanged, missingTypes: p.missingTypes,
    })
  })

  app.post('/api/import/apply', async (req, res) => {
    const { csv, removeMissing } = importBody.parse(req.body)
    const { parsed, p } = importPlan(csv, removeMissing)
    if (parsed.errors.length) return res.status(400).json({ error: `Fix the ${parsed.errors.length} row error(s) in the file first.` })
    if (!parsed.slots.length) return res.status(400).json({ error: 'The file has no classes.' })
    const err = readyError(p)
    if (err) return res.status(400).json({ error: err })
    res.json(await applyPlan(p, `CSV import ${parsed.from} to ${parsed.to}`))
  })

  app.get('/api/export.csv', (req, res) => {
    const { from, to } = rangeSchema.parse(req.query)
    const d = store.data.config.durationMin
    const rows = [['Date', 'Start', 'End', 'Genre', 'Level', 'Class name', 'Rotation day']]
    for (const s of slots(from, to)) rows.push([s.date, s.time, endTime(s.time, d), s.genre, String(s.level), `${s.genre} ${s.level}`, String(s.cycleDay)])
    res.type('text/csv').attachment(`rotation-${from}-to-${to}.csv`).send(rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n')
  })

  app.get('/api/log', (_req, res) => res.json(store.data.log.slice(0, 100)))

  app.post('/api/demo/reset', (_req, res) => {
    if (mt().mode !== 'demo') return res.status(403).json({ error: 'Reset is only available in demo mode.' })
    store.reset()
    Object.assign(demo, new DemoMariana(store.data.demo, () => store.save()))
    res.json({ ok: true })
  })

  app.post('/api/demo/book', (req, res) => {
    if (mt().mode !== 'demo') return res.status(403).json({ error: 'Demo only.' })
    const { mtId } = z.object({ mtId: z.string() }).parse(req.body)
    const c = store.data.demo.classes.find((x) => x.id === mtId)
    if (!c) return res.status(404).json({ error: 'Not found' })
    c.reservations++
    store.save()
    res.json({ reservations: c.reservations })
  })

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map((i) => i.message).join('; ') })
    if (err instanceof MarianaError) return res.status(502).json({ error: err.message })
    console.error(err)
    res.status(500).json({ error: 'Unexpected server error' })
  })
  return app
}

export function clientFromEnv(): MarianaClient | undefined {
  const tenant = process.env.MARIANATEK_TENANT
  const token = process.env.MARIANATEK_API_TOKEN
  return tenant && token ? new LiveMariana(tenant, token) : undefined
}
