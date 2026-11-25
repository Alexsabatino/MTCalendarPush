export interface ClassTemplate {
  time: string
  level: number
}

export interface RotationConfig {
  startDate: string
  genres: string[]
  levels: number
  /** Class times and levels for each weekday, index 0 = Sunday. Same every week. */
  weekly: ClassTemplate[][]
  durationMin: number
  timeZone: string
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekday = (times: [string, number][]) => times.map(([time, level]) => ({ time, level }))

/** A one-date change: sets the level (and optionally genre) of the class at that time, or adds a class there. */
export interface ClassChange {
  date: string
  time: string
  level: number
  genre?: string
}

export interface SkipRule {
  date: string
  time?: string
  note?: string
}

export interface Slot {
  key: string
  date: string
  time: string
  genre: string
  level: number
  cycleDay: number
  /** Set when a one-date change applies. */
  changed?: boolean
}

export const DEFAULT_CONFIG: RotationConfig = {
  startDate: '2026-12-01',
  genres: ['Strength', 'Endurance', 'Longevity'],
  levels: 3,
  weekly: [
    weekday([['08:00', 1], ['10:00', 2]]),
    ...Array.from({ length: 5 }, () => weekday([['06:00', 1], ['09:00', 2], ['12:00', 1], ['17:30', 3]])),
    weekday([['08:00', 2], ['10:00', 1]]),
  ],
  durationMin: 50,
  timeZone: 'America/New_York',
}

const DAY_MS = 86_400_000
const toUtc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
export const addDays = (date: string, n: number) => new Date(toUtc(date) + n * DAY_MS).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS)
const mod = (n: number, m: number) => ((n % m) + m) % m

export const weekdayOf = (date: string) => new Date(toUtc(date)).getUTCDay()

/** The genre moves to the next one every calendar day; Day 1 is the first genre. */
export function dayInfo(date: string, cfg: RotationConfig) {
  const offset = mod(daysBetween(cfg.startDate, date), cfg.genres.length)
  return { cycleDay: offset + 1, genre: cfg.genres[offset], weekday: weekdayOf(date) }
}

export const slotKey = (date: string, time: string) => `${date}T${time}`

export function generateSlots(from: string, to: string, cfg: RotationConfig, skips: SkipRule[] = [], changes: ClassChange[] = []): Slot[] {
  const out: Slot[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const { cycleDay, genre, weekday } = dayInfo(date, cfg)
    const day = new Map((cfg.weekly[weekday] ?? []).map((c) => [c.time, { genre, level: c.level, changed: false }]))
    for (const ch of changes) if (ch.date === date) day.set(ch.time, { genre: ch.genre ?? genre, level: ch.level, changed: true })
    for (const [time, c] of [...day].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (skips.some((s) => s.date === date && (!s.time || s.time === time))) continue
      out.push({ key: slotKey(date, time), date, time, genre: c.genre, level: c.level, cycleDay, ...(c.changed ? { changed: true } : {}) })
    }
  }
  return out
}

export function endTime(time: string, durationMin: number) {
  const [h, m] = time.split(':').map(Number)
  const t = h * 60 + m + durationMin
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function nowTimeIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

export const typeKey = (genre: string, level: number) => `${genre}|${level}`
