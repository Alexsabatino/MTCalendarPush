import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, dayInfo, endTime, generateSlots } from '../shared/rotation'
import { planSync, type PushedClass } from '../shared/sync'

const cfg = { ...DEFAULT_CONFIG, startDate: '2026-12-01', times: ['06:00', '09:00'] }

describe('rotation', () => {
  it('follows the 9-day Strength/Endurance/Longevity cycle with rising levels', () => {
    const seq = Array.from({ length: 10 }, (_, i) => {
      const d = dayInfo(`2026-12-${String(i + 1).padStart(2, '0')}`, cfg)
      return `${d.genre} ${d.level}`
    })
    expect(seq).toEqual(['Strength 1', 'Endurance 1', 'Longevity 1', 'Strength 2', 'Endurance 2', 'Longevity 2', 'Strength 3', 'Endurance 3', 'Longevity 3', 'Strength 1'])
  })
  it('works across months, years and before the start date', () => {
    expect(dayInfo('2026-12-31', cfg)).toMatchObject({ cycleDay: 4, genre: 'Strength', level: 2 })
    expect(dayInfo('2027-01-01', cfg)).toMatchObject({ cycleDay: 5 })
    expect(dayInfo('2026-11-30', cfg)).toMatchObject({ cycleDay: 9, genre: 'Longevity', level: 3 })
  })
  it('counts every calendar day, including DST changes', () => {
    const c = { ...cfg, startDate: '2027-03-13' }
    expect(dayInfo('2027-03-15', c).cycleDay).toBe(3)
    expect(dayInfo('2027-11-08', { ...cfg, startDate: '2027-11-06' }).cycleDay).toBe(3)
  })
  it('generates every class time each day, skipping only skipped ones', () => {
    const s = generateSlots('2026-12-01', '2026-12-03', cfg, [{ date: '2026-12-02', time: '09:00' }, { date: '2026-12-03' }])
    expect(s.map((x) => x.key)).toEqual(['2026-12-01T06:00', '2026-12-01T09:00', '2026-12-02T06:00'])
    expect(s[2]).toMatchObject({ genre: 'Endurance', level: 1 })
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
    const plan = planSync(slots, [p('2026-12-01T09:00', 'Strength', 1)], types, '2026-12-01', '2026-12-02', '2026-12-01T07:00')
    expect(plan.create.map((s) => s.key)).toEqual(['2026-12-02T06:00', '2026-12-02T09:00'])
    expect(plan.unchanged).toBe(1)
  })
  it('updates classes whose genre/level changed and removes unwanted future classes', () => {
    const plan = planSync(slots, [p('2026-12-02T06:00', 'Strength', 2), p('2026-12-02T12:00', 'Endurance', 1), p('2026-11-30T06:00', 'X', 1)], types, '2026-11-01', '2026-12-02', '2026-12-01T00:00')
    expect(plan.update.map((u) => u.slot.key)).toEqual(['2026-12-02T06:00'])
    expect(plan.remove.map((r) => r.key)).toEqual(['2026-12-02T12:00'])
  })
  it('reports unmapped class types', () => {
    const plan = planSync(slots, [], (g, l) => (g === 'Strength' ? `${g}-${l}` : undefined), '2026-12-01', '2026-12-02', '2026-11-01T00:00')
    expect(plan.missingTypes).toEqual(['Endurance L1'])
    expect(plan.create).toHaveLength(2)
  })
})
