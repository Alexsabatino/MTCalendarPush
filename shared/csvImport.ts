import { slotKey, type Slot } from './rotation'

export interface ImportRowError { row: number; message: string }
export interface ImportResult { slots: Slot[]; errors: ImportRowError[]; from: string | null; to: string | null }

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
export function importSchedule(text: string, genres: string[], levels: number): ImportResult {
  const rows = parseCsv(text)
  const errors: ImportRowError[] = []
  if (!rows.length) return { slots: [], errors: [{ row: 0, message: 'The file is empty.' }], from: null, to: null }
  const head = rows[0].map(norm)
  const col = (k: string) => head.findIndex((h) => HEADERS[k].includes(h))
  const ci = { date: col('date'), time: col('time'), genre: col('genre'), level: col('level'), name: col('name') }
  if (ci.date < 0 || ci.time < 0) return { slots: [], errors: [{ row: 1, message: 'The header row needs a "Date" column and a "Start" column.' }], from: null, to: null }
  if ((ci.genre < 0 || ci.level < 0) && ci.name < 0) return { slots: [], errors: [{ row: 1, message: 'The header row needs "Genre" and "Level" columns, or a "Class name" column like "Strength 2".' }], from: null, to: null }
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
  return { slots, errors, from: slots[0]?.date ?? null, to: slots.at(-1)?.date ?? null }
}
