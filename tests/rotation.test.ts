import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, dayInfo, endTime, generateSlots, type RotationConfig } from '../shared/rotation'
import { planSync, type PushedClass } from '../shared/sync'

const t = (...c: [string, number][]) => c.map(([time, level]) => ({ time, level }))
// 2026-12-01 is a Tuesday.
const weekly = [t(['08:00', 2]), t(['06:00', 1], ['09:00', 3]), t(['06:00', 1], ['09:00', 2]), t(['06:00', 2]), t(['06:00', 1]), t(['06:00', 1]), t()]
const cfg: RotationConfig = { ...DEFAULT_CONFIG, startDate: '2026-12-01', weekly }

describe('rotation', () => {
  it('moves to the next genre every day', () => {
    const seq = Array.from({ length: 7 }, (_, i) => dayInfo(`2026-12-0${i + 1}`, cfg).genre)
    expect(seq).toEqual(['Strength', 'Endurance', 'Longevity', 'Strength', 'Endurance', 'Longevity', 'Strength'])
  })
  it('works across months, years and before the start date', () => {
    expect(dayInfo('2026-12-31', cfg)).toMatchObject({ cycleDay: 1, genre: 'Strength', weekday: 4 })
    expect(dayInfo('2027-01-01', cfg)).toMatchObject({ cycleDay: 2, genre: 'Endurance' })
    expect(dayInfo('2026-11-30', cfg)).toMatchObject({ cycleDay: 3, genre: 'Longevity', weekday: 1 })
  })
  it('counts every calendar day, including DST changes', () => {
    expect(dayInfo('2027-03-15', { ...cfg, startDate: '2027-03-13' }).cycleDay).toBe(3)
    expect(dayInfo('2027-11-08', { ...cfg, startDate: '2027-11-06' }).cycleDay).toBe(3)
  })
  it('uses each weekday\'s times and levels with the rotating genre', () => {
    const s = generateSlots('2026-12-01', '2026-12-08', cfg)
    const tuesdays = s.filter((x) => x.date === '2026-12-01' || x.date === '2026-12-08').map((x) => `${x.key} ${x.genre} ${x.level}`)
    expect(tuesdays).toEqual(['2026-12-01T06:00 Strength 1', '2026-12-01T09:00 Strength 2', '2026-12-08T06:00 Endurance 1', '2026-12-08T09:00 Endurance 2'])
    expect(s.filter((x) => x.date === '2026-12-05')).toHaveLength(0)
    expect(s.find((x) => x.date === '2026-12-06')).toMatchObject({ time: '08:00', level: 2, genre: 'Longevity' })
  })
  it('skips only skipped classes', () => {
    const s = generateSlots('2026-12-01', '2026-12-02', cfg, [{ date: '2026-12-01', time: '09:00' }, { date: '2026-12-02' }])
    expect(s.map((x) => x.key)).toEqual(['2026-12-01T06:00'])
  })
  it('computes 50-minute end times', () => {
    expect(endTime('06:00', 50)).toBe('06:50')
    expect(endTime('17:30', 50)).toBe('18:20')
  })
})

describe('planSync', () => {
  const types = (g: string, l: number) => `${g}-${l}`
  const slots = generateSlots('2026-12-01', '2026-12-02', cfg)
  const p = (key: string, genre: string, level: number): PushedClass => ({ key, mtId: `m-${key}`, genre, level, typeId: `${genre}-${level}`, createdAt: '' })
  it('creates only future classes not yet pushed', () => {
    const plan = planSync(slots, [p('2026-12-01T09:00', 'Strength', 2)], types, '2026-12-01', '2026-12-02', '2026-12-01T07:00')
    expect(plan.create.map((s) => s.key)).toEqual(['2026-12-02T06:00'])
    expect(plan.unchanged).toBe(1)
  })
  it('updates classes whose genre/level changed and removes unwanted future classes', () => {
    const plan = planSync(slots, [p('2026-12-02T06:00', 'Strength', 2), p('2026-12-02T12:00', 'Endurance', 1), p('2026-11-30T06:00', 'X', 1)], types, '2026-11-01', '2026-12-02', '2026-12-01T00:00')
    expect(plan.update.map((u) => u.slot.key)).toEqual(['2026-12-02T06:00'])
    expect(plan.remove.map((r) => r.key)).toEqual(['2026-12-02T12:00'])
  })
  it('reports unmapped class types', () => {
    const plan = planSync(slots, [], (g, l) => (g === 'Strength' ? `${g}-${l}` : undefined), '2026-12-01', '2026-12-02', '2026-11-01T00:00')
    expect(plan.missingTypes).toEqual(['Endurance L2'])
    expect(plan.create).toHaveLength(2)
  })
})
