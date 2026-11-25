export interface RotationConfig {
  startDate: string
  genres: string[]
  levels: number
  times: string[]
  durationMin: number
  timeZone: string
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
}

export const DEFAULT_CONFIG: RotationConfig = {
  startDate: '2026-12-01',
  genres: ['Strength', 'Endurance', 'Longevity'],
  levels: 3,
  times: ['06:00', '09:00', '12:00', '17:30'],
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

export function cycleLength(cfg: RotationConfig) {
  return cfg.genres.length * cfg.levels
}

/** Day 1 is the first genre at level 1; each genre goes up one level every time it comes back around. */
export function dayInfo(date: string, cfg: RotationConfig) {
  const offset = mod(daysBetween(cfg.startDate, date), cycleLength(cfg))
  const g = cfg.genres.length
  return { cycleDay: offset + 1, genre: cfg.genres[offset % g], level: Math.floor(offset / g) + 1 }
}

export const slotKey = (date: string, time: string) => `${date}T${time}`

export function generateSlots(from: string, to: string, cfg: RotationConfig, skips: SkipRule[] = []): Slot[] {
  const out: Slot[] = []
  const times = [...cfg.times].sort()
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const info = dayInfo(date, cfg)
    for (const time of times) {
      if (skips.some((s) => s.date === date && (!s.time || s.time === time))) continue
      out.push({ key: slotKey(date, time), date, time, ...info })
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
