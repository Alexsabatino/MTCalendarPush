import { describe, expect, it } from 'vitest'
import { importSchedule, parseCsv, parseDate, parseTime } from '../shared/csvImport'

const G = ['Strength', 'Endurance', 'Longevity']

describe('CSV import', () => {
  it('parses quoted fields, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,"b,""c"""\r\n1,2\r\n\r\n')).toEqual([['a', 'b,"c"'], ['1', '2']])
  })
  it('accepts common date and time formats', () => {
    expect(parseDate('2026-12-01')).toBe('2026-12-01')
    expect(parseDate('12/1/2026')).toBe('2026-12-01')
    expect(parseDate('2/30/2026')).toBeNull()
    expect(parseTime('6:00 AM')).toBe('06:00')
    expect(parseTime('5:30pm')).toBe('17:30')
    expect(parseTime('12:00 AM')).toBe('00:00')
    expect(parseTime('17:30:00')).toBe('17:30')
    expect(parseTime('6')).toBeNull()
  })
  it('reads Genre + Level columns', () => {
    const r = importSchedule('Date,Start,Genre,Level\n12/2/2026,6:00 AM,endurance,2\n2026-12-01,17:30,Strength,1\n', G, 3)
    expect(r.errors).toEqual([])
    expect(r.slots.map((s) => `${s.key} ${s.genre} ${s.level}`)).toEqual(['2026-12-01T17:30 Strength 1', '2026-12-02T06:00 Endurance 2'])
    expect([r.from, r.to]).toEqual(['2026-12-01', '2026-12-02'])
  })
  it('reads a Class name column and the app\'s own export', () => {
    expect(importSchedule('Date,Time,Class\n2026-12-01,06:00,Longevity L3\n', G, 3).slots[0]).toMatchObject({ genre: 'Longevity', level: 3 })
    const exported = '"Date","Start","End","Genre","Level","Class name","Rotation day"\r\n"2026-12-01","06:00","06:50","Strength","1","Strength 1","1"\r\n'
    expect(importSchedule(exported, G, 3).slots).toHaveLength(1)
  })
  it('reports bad rows, duplicates and missing columns with row numbers', () => {
    const r = importSchedule('Date,Start,Genre,Level\n2026-13-01,06:00,Strength,1\n2026-12-01,06:00,Yoga,4\n2026-12-02,06:00,Strength,1\n2026-12-02,6:00 AM,Endurance,1\n', G, 3)
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 5])
    expect(r.errors[1].message).toContain('genre')
    expect(r.errors[1].message).toContain('level')
    expect(r.errors[2].message).toContain('duplicates row 4')
    expect(importSchedule('Day,Genre\n', G, 3).errors[0].message).toContain('Start')
  })
})
