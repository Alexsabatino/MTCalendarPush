import { addDays, dayInfo, daysBetween, slotKey, type RotationConfig, type Slot } from './rotation'

export interface ImportRowError { row: number; message: string }
export interface ImportOptions {
  /** Used for the genre when the file only gives a level. */
  rotation?: RotationConfig
  /** First day of week 1, for grids that have day names but no dates. */
  weekStart?: string
  /** Studio's today, used to pick the year for dates written without one. */
  today?: string
}

export interface ImportResult {
  format?: 'rows' | 'grid'
  needsWeekStart?: boolean
  /** How many classes got their genre from the rotation because the file had none. */
  genreFromRotation?: number
  slots: Slot[]; errors: ImportRowError[]; from: string | null; to: string | null }

export function parseCsv(text: string, delimiter?: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  const src = text.replace(/^\uFEFF/, '')
  const delim = delimiter ?? ((src.split(/\r?\n/)[0] ?? '').includes('\t') ? '\t' : ',')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((v) => v.trim()))
}

const pad = (n: number) => String(n).padStart(2, '0')

export function parseDate(v: string): string | null {
  const s = v.trim()
  let y: number, m: number, d: number
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3].length === 2 ? `20${match[3]}` : match[3])]
  else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export function parseTime(v: string): string | null {
  const s = v.trim().toLowerCase().replace(/\s+/g, '')
  const match = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(am|pm|a|p)?$/)
  if (!match) return null
  let h = Number(match[1])
  const m = Number(match[2] ?? 0)
  const ap = match[3]
  if (!ap && match[2] === undefined) return null
  if (ap) { if (h < 1 || h > 12) return null; h = (h % 12) + (ap.startsWith('p') ? 12 : 0) }
  if (h > 23 || m > 59) return null
  return `${pad(h)}:${pad(m)}`
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
const HEADERS: Record<string, string[]> = {
  date: ['date', 'classdate', 'day'],
  time: ['start', 'starttime', 'time', 'classtime'],
  genre: ['genre', 'type', 'classtype', 'format'],
  level: ['level', 'lvl'],
  name: ['classname', 'class', 'name', 'title'],
}

/**
 * Reads a schedule CSV. Needs Date and Start columns, plus either Genre + Level or a Class name like "Strength 2".
 */
export function importSchedule(text: string, genres: string[], levels: number, opts: ImportOptions = {}): ImportResult {
  const rows = parseCsv(text)
  const errors: ImportRowError[] = []
  if (!rows.length) return { slots: [], errors: [{ row: 0, message: 'The file is empty.' }], from: null, to: null }
  const head = rows[0].map(norm)
  const col = (k: string) => head.findIndex((h) => HEADERS[k].includes(h))
  const ci = { date: col('date'), time: col('time'), genre: col('genre'), level: col('level'), name: col('name') }
  if (ci.date < 0 || ci.time < 0) return importGrid(rows, genres, levels, opts)
  let genreFromRotation = 0
  if ((ci.genre < 0 || ci.level < 0) && ci.name < 0 && !(ci.level >= 0 && opts.rotation)) return { slots: [], errors: [{ row: 1, message: 'The header row needs "Genre" and "Level" columns, or a "Class name" column like "Strength 2".' }], from: null, to: null }
  const genreBy = new Map(genres.map((g) => [norm(g), g]))
  const seen = new Map<string, number>()
  const slots: Slot[] = []
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2
    const get = (idx: number) => (idx >= 0 ? (r[idx] ?? '').trim() : '')
    const date = parseDate(get(ci.date))
    const time = parseTime(get(ci.time))
    let genre: string | undefined, level = NaN
    if (ci.genre >= 0 && ci.level >= 0 && get(ci.genre)) {
      genre = genreBy.get(norm(get(ci.genre)))
      level = Number(get(ci.level).replace(/^l(evel)?\s*/i, ''))
    } else if (ci.name >= 0) {
      const m = get(ci.name).match(/^(.*?)[\s\-_·]*(?:l|level)?\s*(\d+)$/i)
      if (m) { genre = genreBy.get(norm(m[1])); level = Number(m[2]) }
    } else if (ci.level >= 0 && opts.rotation && date) {
      genre = dayInfo(date, opts.rotation).genre
      level = Number(get(ci.level).replace(/^l(evel)?\s*/i, ''))
      genreFromRotation++
    }
    const problems: string[] = []
    if (!date) problems.push(`date "${get(ci.date)}" isn't a valid date (use 2026-12-01 or 12/1/2026)`)
    if (!time) problems.push(`start "${get(ci.time)}" isn't a valid time (use 06:00 or 6:00 AM)`)
    if (!genre) problems.push(`genre isn't one of ${genres.join(', ')}`)
    if (!Number.isInteger(level) || level < 1 || level > levels) problems.push(`level must be 1–${levels}`)
    if (problems.length) { errors.push({ row: rowNo, message: problems.join('; ') }); return }
    const key = slotKey(date!, time!)
    if (seen.has(key)) { errors.push({ row: rowNo, message: `duplicates row ${seen.get(key)} (same date and start time)` }); return }
    seen.set(key, rowNo)
    slots.push({ key, date: date!, time: time!, genre: genre!, level, cycleDay: 0 })
  })
  slots.sort((a, b) => a.key.localeCompare(b.key))
  return { format: 'rows', genreFromRotation, slots, errors, from: slots[0]?.date ?? null, to: slots.at(-1)?.date ?? null }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAY_WORDS = [['sun', 'sunday'], ['mon', 'monday'], ['tue', 'tues', 'tuesday'], ['wed', 'wednesday'], ['thu', 'thur', 'thurs', 'thursday'], ['fri', 'friday'], ['sat', 'saturday']]

function ymd(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

/** Finds a date anywhere in a header cell ("Mon 12/1", "Monday, Dec 1", "2026-12-01"). Picks the year nearest `today` when none is given. */
export function findDate(text: string, today: string): string | null {
  const s = text.toLowerCase()
  let y: number | undefined, m: number | undefined, d: number | undefined
  let r = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]]
  else if ((r = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) [m, d, y] = [+r[1], +r[2], r[3] ? +(r[3].length === 2 ? `20${r[3]}` : r[3]) : undefined]
  else if ((r = s.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/)) && MONTHS.includes(r[1])) [m, d, y] = [MONTHS.indexOf(r[1]) + 1, +r[2], r[3] ? +r[3] : undefined]
  else if ((r = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b(?:,?\s*(\d{4}))?/)) && MONTHS.includes(r[2])) [d, m, y] = [+r[1], MONTHS.indexOf(r[2]) + 1, r[3] ? +r[3] : undefined]
  else return null
  if (y) return ymd(y, m!, d!)
  const ty = Number(today.slice(0, 4))
  const options = [ty - 1, ty, ty + 1].map((yy) => ymd(yy, m!, d!)).filter((x): x is string => !!x)
  options.sort((a, b) => Math.abs(daysBetween(today, a)) - Math.abs(daysBetween(today, b)))
  return options[0] ?? null
}

const findWeekday = (text: string) => {
  const words = text.toLowerCase().split(/[^a-z]+/)
  return WEEKDAY_WORDS.findIndex((names) => words.some((w) => names.includes(w)))
}
const findGenre = (text: string, genres: string[]) => genres.find((g) => new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
const LEVEL_RE = /\b(?:level|lvl|l)\s*(\d+)/i

/**
 * Reads a grid: rows of class times, columns of days, "Level N" in each cell (emoji/percentages ignored,
 * blank or "-" = no class). Column headers give the date ("Mon 12/1"), or just the day name together with
 * opts.weekStart. Several weekly grids can be stacked, each with its own header row. A cell or header may
 * name the genre; otherwise the rotation decides it.
 */
function importGrid(rows: string[][], genres: string[], levels: number, opts: ImportOptions): ImportResult {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const errors: ImportRowError[] = []
  const slots: Slot[] = []
  const seen = new Map<string, number>()
  let cols: { col: number; date: string | null; weekday: number; genre?: string }[] = []
  let block = -1, needsWeekStart = false, genreFromRotation = 0, timeCol = 0
  const fail = (message: string): ImportResult => ({ format: 'grid', slots: [], errors: [{ row: 1, message }], from: null, to: null })
  rows.forEach((r, i) => {
    const rowNo = i + 1
    const dayCells = r.map((c, col) => ({ col, date: findDate(c, today), weekday: findWeekday(c), genre: findGenre(c, genres) }))
      .filter((c) => (c.date || c.weekday >= 0) && !parseTime((r[c.col] ?? '').trim()) && !LEVEL_RE.test(r[c.col] ?? ''))
    if (dayCells.length >= 2 || (dayCells.length === 1 && !r.some((c) => LEVEL_RE.test(c)))) {
      block++
      timeCol = dayCells[0].col > 0 ? 0 : -1
      cols = dayCells.map((c) => {
        let date = c.date
        if (!date && opts.weekStart) {
          const ws = opts.weekStart
          date = addDays(ws, block * 7 + ((c.weekday - new Date(`${ws}T12:00:00Z`).getUTCDay() + 7) % 7))
        }
        if (!date) needsWeekStart = true
        return { col: c.col, date, weekday: c.weekday, genre: c.genre }
      })
      return
    }
    if (!cols.length) return
    const raw = timeCol >= 0 ? (r[timeCol] ?? '').trim() : ''
    const timeText = raw.match(/\d{1,2}(:\d{2})?\s*([ap]\.?m\.?|[ap])?/i)?.[0] ?? ''
    const time = parseTime(timeText.replace(/\./g, ''))
    if (!time) {
      // A row of genre names under the dates sets each column's genre.
      const named = cols.filter((c) => findGenre(r[c.col] ?? '', genres) && !LEVEL_RE.test(r[c.col] ?? ''))
      if (named.length) named.forEach((c) => { c.genre = findGenre(r[c.col], genres) })
      else if (cols.some((c) => LEVEL_RE.test(r[c.col] ?? ''))) errors.push({ row: rowNo, message: `"${raw}" isn't a time I can read (use 6:15 AM or 06:15)` })
      return
    }
    for (const c of cols) {
      const cell = (r[c.col] ?? '').trim()
      const lm = cell.match(LEVEL_RE)
      if (!lm || !c.date) continue
      const level = Number(lm[1])
      if (level < 1 || level > levels) { errors.push({ row: rowNo, message: `level ${level} on ${c.date} is outside 1–${levels}` }); continue }
      let genre = findGenre(cell, genres) ?? c.genre
      if (!genre) {
        if (!opts.rotation) { errors.push({ row: rowNo, message: `no genre for ${c.date} ${time}` }); continue }
        genre = dayInfo(c.date, opts.rotation).genre
        genreFromRotation++
      }
      const key = slotKey(c.date, time)
      if (seen.has(key)) { errors.push({ row: rowNo, message: `${c.date} ${time} also appears in row ${seen.get(key)}` }); continue }
      seen.set(key, rowNo)
      slots.push({ key, date: c.date, time, genre, level, cycleDay: 0 })
    }
  })
  if (block < 0) return fail('Couldn\'t read this file. Use one row per class with Date, Start, Genre and Level columns, or a grid with days (or dates) across the top and times down the side.')
  if (needsWeekStart) return { format: 'grid', needsWeekStart, slots: [], errors: [{ row: 0, message: 'This sheet has day names but no dates. Pick the date week 1 starts.' }], from: null, to: null }
  slots.sort((a, b) => a.key.localeCompare(b.key))
  return { format: 'grid', genreFromRotation, slots, errors, from: slots[0]?.date ?? null, to: slots.at(-1)?.date ?? null }
}
