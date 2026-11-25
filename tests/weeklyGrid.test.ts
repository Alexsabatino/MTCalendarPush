import { describe, expect, it } from 'vitest'
import { importWeeklyGrid } from '../shared/weeklyGrid'

describe('weekly grid import', () => {
  it('reads a Google Sheets CSV with emoji, percentages and dashes', () => {
    const csv = [
      'Time,Monday,Tuesday,Wednesday,Thursday,Friday',
      '6:15 AM,"🟢 Level 1\n37.5% ⚠️","🟡 Level 2\n42.2% ⚠️","🟢 Level 1\n28.1%","🔴 Level 3\n43.8%","🟡 Level 2\n45.8%"',
      '7:15 AM,"🟡 Level 2\n68.8%","🟢 Level 1","🟡 Level 2","🟢 Level 1","🔴 Level 3"',
      '2:15 PM,🟡 Level 2,-,🟢 Level 1,-,🟢 Level 1',
      '3:15 PM,-,-,,-,🟡 Level 2',
    ].join('\n')
    const r = importWeeklyGrid(csv, 3)
    expect(r.errors).toEqual([])
    expect(r.days).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    expect(r.classes).toBe(14)
    expect(r.weekly[1]).toEqual([{ time: '06:15', level: 1 }, { time: '07:15', level: 2 }, { time: '14:15', level: 2 }])
    expect(r.weekly[5]).toHaveLength(4)
    expect(r.weekly[0]).toBeNull()
    expect(r.weekly[6]).toBeNull()
  })
  it('reads tab-separated text pasted from a spreadsheet', () => {
    const r = importWeeklyGrid('Time\tSat\tSun\n8:15 AM\tLevel 2\tL1\n9:15 AM\t"Level 3\n80%"\t-\n', 3)
    expect(r.weekly[6]).toEqual([{ time: '08:15', level: 2 }, { time: '09:15', level: 3 }])
    expect(r.weekly[0]).toEqual([{ time: '08:15', level: 1 }])
  })
  it('reports unreadable times and out-of-range levels', () => {
    const r = importWeeklyGrid('Time,Monday\nmorning,Level 1\n6:15 AM,Level 4\n', 3)
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toContain('Row 2')
    expect(r.errors[1]).toContain('level 4')
    expect(importWeeklyGrid('a,b\n1,2', 3).errors[0]).toContain('header')
  })
})
