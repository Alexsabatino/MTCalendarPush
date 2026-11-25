import { describe, expect, it } from 'vitest'
import { findDate, importSchedule } from '../shared/csvImport'
import { DEFAULT_CONFIG } from '../shared/rotation'

const G = ['Strength', 'Endurance', 'Longevity']
const rotation = { ...DEFAULT_CONFIG, startDate: '2026-12-01' }
const opts = { rotation, today: '2026-11-25' }

describe('grid schedule import', () => {
  it('finds dates in header cells and picks the nearest year', () => {
    expect(findDate('Mon 12/7', '2026-11-25')).toBe('2026-12-07')
    expect(findDate('Monday, Dec 7', '2026-11-25')).toBe('2026-12-07')
    expect(findDate('Fri Jan 8', '2026-11-25')).toBe('2027-01-08')
    expect(findDate('7 December 2026', '2026-11-25')).toBe('2026-12-07')
    expect(findDate('2026-12-07 (Mon)', '2026-11-25')).toBe('2026-12-07')
    expect(findDate('Monday', '2026-11-25')).toBeNull()
  })

  it('reads stacked weekly grids with dated headers, genre from the rotation', () => {
    const csv = [
      'Time,Mon 12/7,Tue 12/8,Wed 12/9',
      '6:15 AM,"🟢 Level 1\n37.5% ⚠️","🟡 Level 2",-',
      '7:15 AM,🔴 Level 3,,🟢 Level 1',
      '',
      'Time,Mon 12/14,Tue 12/15,Wed 12/16',
      '6:15 AM,Level 2,Level 2,Level 3',
    ].join('\n')
    const r = importSchedule(csv, G, 3, opts)
    expect(r.errors).toEqual([])
    expect(r.format).toBe('grid')
    expect(r.slots.map((s) => `${s.key} ${s.genre} ${s.level}`)).toEqual([
      '2026-12-07T06:15 Strength 1', '2026-12-07T07:15 Strength 3', '2026-12-08T06:15 Endurance 2',
      '2026-12-09T07:15 Longevity 1', '2026-12-14T06:15 Endurance 2', '2026-12-15T06:15 Longevity 2', '2026-12-16T06:15 Strength 3',
    ])
    expect(r.genreFromRotation).toBe(7)
    expect([r.from, r.to]).toEqual(['2026-12-07', '2026-12-16'])
  })

  it('uses genres named in the header, a genre row, or the cell', () => {
    const csv = [
      'Time,Monday 12/7 - Endurance,Tuesday 12/8,Wednesday 12/9',
      ',,Strength,Longevity',
      '6:15 AM,Level 1,Level 2,Strength Level 3',
    ].join('\n')
    const r = importSchedule(csv, G, 3, opts)
    expect(r.slots.map((s) => `${s.genre} ${s.level}`)).toEqual(['Endurance 1', 'Strength 2', 'Strength 3'])
    expect(r.genreFromRotation).toBe(0)
  })

  it('asks for the week 1 date when headers only have day names, then counts weeks', () => {
    const csv = 'Time,Monday,Tuesday,Sunday\n6:15 AM,Level 1,Level 2,Level 3\nTime,Monday,Tuesday,Sunday\n6:15 AM,Level 2,-,-\n'
    const first = importSchedule(csv, G, 3, opts)
    expect(first.needsWeekStart).toBe(true)
    expect(first.slots).toHaveLength(0)
    const r = importSchedule(csv, G, 3, { ...opts, weekStart: '2026-12-07' })
    expect(r.errors).toEqual([])
    expect(r.slots.map((s) => s.key)).toEqual(['2026-12-07T06:15', '2026-12-08T06:15', '2026-12-13T06:15', '2026-12-14T06:15'])
  })

  it('reports bad times, levels and duplicates with row numbers', () => {
    const csv = 'Time,Mon 12/7,Tue 12/8\nmorning,Level 1,Level 1\n6:15 AM,Level 4,Level 1\n6:15 AM,Level 1,Level 2\n'
    const r = importSchedule(csv, G, 3, opts)
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4])
    expect(r.errors[2].message).toContain('row 3')
    expect(importSchedule('hello,world\n1,2', G, 3, opts).errors[0].message).toContain('grid')
  })

  it('still reads one-row-per-class files with only a level column', () => {
    const r = importSchedule('Date,Start,Level\n12/7/2026,6:15 AM,2\n', G, 3, opts)
    expect(r.slots[0]).toMatchObject({ genre: 'Strength', level: 2 })
    expect(r.genreFromRotation).toBe(1)
  })
})
