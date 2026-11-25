import { parseCsv, parseTime } from './csvImport'
import type { ClassTemplate } from './rotation'

export interface GridImport {
  weekly: (ClassTemplate[] | null)[]
  days: string[]
  classes: number
  errors: string[]
}

const DAY_NAMES = [['sun', 'sunday'], ['mon', 'monday'], ['tue', 'tues', 'tuesday'], ['wed', 'wednesday'], ['thu', 'thur', 'thurs', 'thursday'], ['fri', 'friday'], ['sat', 'saturday']]
const dayIndex = (h: string) => {
  const n = h.trim().toLowerCase().replace(/[^a-z]/g, '')
  return DAY_NAMES.findIndex((names) => names.includes(n))
}

/**
 * Reads a weekly grid: a header row of day names, then one row per class time with the time in the
 * first column and "Level N" (or "L N") in each day's cell. Blank, "-" or cells without a level mean
 * no class. Anything else in a cell (emoji, percentages) is ignored.
 * Days missing from the header come back as null so the caller can keep their current schedule.
 */
export function importWeeklyGrid(text: string, levels: number): GridImport {
  const rows = parseCsv(text)
  const errors: string[] = []
  const weekly: (ClassTemplate[] | null)[] = Array.from({ length: 7 }, () => null)
  const headerAt = rows.findIndex((r) => r.filter((c) => dayIndex(c) >= 0).length >= 1)
  if (headerAt < 0) return { weekly, days: [], classes: 0, errors: ['Couldn\'t find a header row with day names (Monday, Tuesday, …).'] }
  const header = rows[headerAt]
  const cols = header.map((c, i) => ({ col: i, day: dayIndex(c) })).filter((c) => c.day >= 0)
  const timeCol = header.findIndex((c, i) => dayIndex(c) < 0 && i < cols[0].col)
  const tc = timeCol >= 0 ? timeCol : 0
  for (const { day } of cols) weekly[day] = []
  let classes = 0
  rows.slice(headerAt + 1).forEach((r, i) => {
    const rowNo = headerAt + i + 2
    const raw = (r[tc] ?? '').trim()
    const timeText = raw.match(/\d{1,2}(:\d{2})?\s*([ap]\.?m\.?|[ap])?/i)?.[0] ?? ''
    const time = parseTime(timeText.replace(/\./g, ''))
    const cells = cols.map(({ col, day }) => ({ day, text: (r[col] ?? '').trim() }))
    const withLevel = cells.filter((c) => /\b(level|lvl|l)\s*\d+/i.test(c.text))
    if (!time) {
      if (withLevel.length) errors.push(`Row ${rowNo}: "${raw}" isn't a time I can read (use 6:15 AM or 06:15).`)
      return
    }
    for (const c of withLevel) {
      const level = Number(c.text.match(/\b(?:level|lvl|l)\s*(\d+)/i)![1])
      if (level < 1 || level > levels) { errors.push(`Row ${rowNo}: level ${level} is outside 1–${levels}.`); continue }
      const list = weekly[c.day]!
      if (list.some((x) => x.time === time)) { errors.push(`Row ${rowNo}: ${time} appears twice.`); continue }
      list.push({ time, level })
      classes++
    }
  })
  const order = [1, 2, 3, 4, 5, 6, 0]
  const days = order.filter((d) => weekly[d]).map((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d])
  return { weekly, days, classes, errors }
}
