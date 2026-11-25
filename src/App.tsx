import { useCallback, useEffect, useMemo, useState } from 'react'
import { importWeeklyGrid } from '../shared/weeklyGrid'
import { addDays, dayInfo, typeKey, weekdayOf, WEEKDAYS, type ClassChange, type ClassTemplate, type RotationConfig, type SkipRule } from '../shared/rotation'
import { api, type AppState, type LogEntry, type Option, type ImportPlan, type Plan, type PreviewSlot, type PushResult } from './api'

type Tab = 'calendar' | 'settings' | 'mariana' | 'import' | 'activity'
const COLORS = ['#e4572e', '#2e86ab', '#3bb273', '#f2a541', '#8e6c8a', '#4f5d75']
const genreColor = (cfg: RotationConfig, g: string) => COLORS[Math.max(0, cfg.genres.indexOf(g)) % COLORS.length]
const fmtTime = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar')
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => api.state().then(setState).catch((e) => setError(e.message)), [])
  useEffect(() => { reload() }, [reload])
  if (!state) return <div className="loading">{error || 'Loading…'}</div>
  return (
    <div className="app">
      <header>
        <div className="brand"><span className="logo">↻</span><div><h1>Rotation Planner</h1><p>{state.config.genres.join(' → ')} · Levels 1–{state.config.levels}</p></div></div>
        <span className={`conn ${state.connection.mode}`} title={state.connection.label}>{state.connection.mode === 'live' ? `Mariana Tek: ${state.connection.label}` : 'Demo mode, not connected to Mariana Tek'}</span>
      </header>
      <nav>
        {([['calendar', 'Calendar'], ['settings', 'Weekly schedule & rotation'], ['mariana', 'Mariana Tek'], ['import', 'Import schedule'], ['activity', 'Activity']] as const).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <main>
        {tab === 'calendar' && <CalendarView state={state} onChanged={reload} goMapping={() => setTab('mariana')} />}
        {tab === 'settings' && <Settings state={state} onSaved={reload} />}
        {tab === 'mariana' && <Mariana state={state} onChanged={reload} />}
        {tab === 'import' && <ImportCsv state={state} onChanged={reload} goMapping={() => setTab('mariana')} />}
        {tab === 'activity' && <Activity />}
      </main>
    </div>
  )
}

function PushBar({ state, version, goMapping, onPushed }: { state: AppState; version: number; goMapping: () => void; onPushed: () => void }) {
  const lastEdit = [...state.changes.map((c) => c.date), ...state.skips.map((s) => s.date)].sort().at(-1) ?? state.today
  const from = state.today
  const to = [addDays(state.today, 27), lastEdit].sort().at(-1)!
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pushedAt, setPushedAt] = useState(-1)
  useEffect(() => { api.plan(from, to).then(setPlan).catch(() => setPlan(null)); if (version > pushedAt + 1) setMsg('') }, [from, to, version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return null
  const n = plan.create.length + plan.update.length + plan.remove.length
  const notReady = !state.layoutId || plan.missingTypes.length > 0
  const push = async () => {
    if (!confirm(`Push ${n} change(s) for ${fmtDate(from)} – ${fmtDate(to)} to ${state.connection.mode === 'live' ? 'Mariana Tek' : 'the demo studio'}?`)) return
    setBusy(true)
    try { const r = await api.apply(from, to); setPushedAt(version); setMsg(`Pushed: ${r.created} created, ${r.updated} changed, ${r.removed} removed${r.flagged.length ? `, ${r.flagged.length} need staff attention (booked)` : ''}.`); onPushed() } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className={`card pushbar ${n ? 'pending' : ''}`}>
      <div>
        <b>{n ? `${n} change${n === 1 ? '' : 's'} not in Mariana Tek yet` : 'Mariana Tek is up to date'}</b>
        <span className="muted"> · {fmtDate(from)} – {fmtDate(to)}{n ? ` · ${plan.create.length} new, ${plan.update.length} changed, ${plan.remove.length} removed` : ''}</span>
        {msg && <div className="msg">{msg}</div>}
      </div>
      {notReady ? <button className="ghost" onClick={goMapping}>Match class types first</button>
        : <button className="primary" disabled={busy || !n} onClick={push}>Push changes</button>}
    </section>
  )
}

function DayEditor2({ date, state, slots, onSaved }: { date: string; state: AppState; slots: PreviewSlot[]; onSaved: () => void }) {
  const cfg = state.config
  const rotationGenre = dayInfo(date, cfg).genre
  const [time, setTime] = useState('')
  const [level, setLevel] = useState(1)
  const [err, setErr] = useState('')
  const past = date < state.today
  const save = async (changes: ClassChange[], skips: SkipRule[] = state.skips) => {
    setErr('')
    try { await api.saveChanges(changes); if (skips !== state.skips) await api.saveSkips(skips); onSaved() } catch (e) { setErr((e as Error).message) }
  }
  const setClass = (t: string, lvl: number, genre: string) => {
    const template = cfg.weekly[weekdayOf(date)].find((c) => c.time === t)
    const rest = state.changes.filter((c) => !(c.date === date && c.time === t))
    const same = template && template.level === lvl && genre === rotationGenre
    save(same ? rest : [...rest, { date, time: t, level: lvl, ...(genre !== rotationGenre ? { genre } : {}) }])
  }
  const cancel = (t: string) => {
    const isAdded = !cfg.weekly[weekdayOf(date)].some((c) => c.time === t)
    const changes = state.changes.filter((c) => !(c.date === date && c.time === t))
    save(changes, isAdded ? state.skips : [...state.skips, { date, time: t }])
  }
  const restore = (t?: string) => save(state.changes, state.skips.filter((s) => !(s.date === date && s.time === t)))
  const cancelled = state.skips.filter((s) => s.date === date)
  return (
    <>
      <ul className="classes edit">
        {slots.map((s) => (
          <li key={s.key}>
            <span title={`${fmtTime(s.time)} – ${fmtTime(s.end)}`}>{fmtTime(s.time)}</span>
            {past ? <b>{s.genre} {s.level}</b> : <span className="row">
              <select aria-label={`${s.time} genre`} value={s.genre} onChange={(e) => setClass(s.time, s.level, e.target.value)}>{cfg.genres.map((g) => <option key={g}>{g}</option>)}</select>
              <select aria-label={`${s.time} level`} value={s.level} onChange={(e) => setClass(s.time, Number(e.target.value), s.genre)}>{Array.from({ length: cfg.levels }, (_, l) => <option key={l} value={l + 1}>Level {l + 1}</option>)}</select>
              <button className="ghost" onClick={() => cancel(s.time)} aria-label={`Cancel ${s.time}`}>Cancel</button>
            </span>}
            <em className={s.mtId ? 'ok' : ''}>{s.changed ? 'Changed for this date · ' : ''}{s.mtId ? 'In Mariana Tek' : 'Not pushed'}</em>
          </li>
        ))}
        {cancelled.map((c, i) => (
          <li key={`x${i}`} className="cancelled"><span>{c.time ? fmtTime(c.time) : 'Whole day'}</span><b>Cancelled</b>{!past && <button className="ghost" onClick={() => restore(c.time)}>Restore</button>}</li>
        ))}
        {!slots.length && !cancelled.length && <li className="muted">No classes.</li>}
      </ul>
      {!past && <div className="row wrap adder">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Extra class time" />
        <select value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Extra class level">{Array.from({ length: cfg.levels }, (_, l) => <option key={l} value={l + 1}>Level {l + 1}</option>)}</select>
        <button disabled={!time || slots.some((s) => s.time === time)} onClick={() => { setClass(time, level, rotationGenre); setTime('') }}>Add class this date</button>
      </div>}
      <p className="muted">Changes here apply to this date only. To change every {WEEKDAYS[weekdayOf(date)]}, use the Weekly schedule tab.</p>
      {err && <p className="warn">{err}</p>}
    </>
  )
}

function CalendarView({ state, onChanged, goMapping }: { state: AppState; onChanged: () => void; goMapping: () => void }) {
  const cfg = state.config
  const [month, setMonth] = useState(state.today.slice(0, 7))
  const [selected, setSelected] = useState(state.today)
  const [slots, setSlots] = useState<PreviewSlot[]>([])
  const [version, setVersion] = useState(0)
  const first = `${month}-01`
  const gridStart = addDays(first, -new Date(`${first}T12:00:00Z`).getUTCDay())
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  useEffect(() => { api.preview(days[0], days[41]).then(setSlots) }, [month, cfg, state.changes, state.skips, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const byDate = useMemo(() => { const m = new Map<string, PreviewSlot[]>(); for (const s of slots) m.set(s.date, [...(m.get(s.date) ?? []), s]); return m }, [slots])
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)) }
  const upcoming = Array.from({ length: 9 }, (_, i) => addDays(state.today, i))
  const sel = dayInfo(selected, cfg)
  const refresh = () => { setVersion((v) => v + 1); onChanged() }
  return (
    <div className="stack">
      <PushBar state={state} version={version} goMapping={goMapping} onPushed={refresh} />
      <section className="card">
        <h2>Next 9 days</h2>
        <div className="strip">
          {upcoming.map((d) => { const i = dayInfo(d, cfg); return (
            <button key={d} className={`chip ${d === selected ? 'sel' : ''}`} style={{ borderColor: genreColor(cfg, i.genre) }} onClick={() => { setSelected(d); setMonth(d.slice(0, 7)) }}>
              <small>{d === state.today ? 'Today' : fmtDate(d, { weekday: 'short', day: 'numeric' })}</small>
              <b style={{ color: genreColor(cfg, i.genre) }}>{i.genre}</b><span>{cfg.weekly[i.weekday].length} classes</span>
            </button>) })}
        </div>
      </section>
      <div className="split">
        <section className="card">
          <div className="monthbar">
            <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <h2>{fmtDate(first, { month: 'long', year: 'numeric' })}</h2>
            <button onClick={() => shift(1)} aria-label="Next month">›</button>
            <button className="ghost" onClick={() => { setMonth(state.today.slice(0, 7)); setSelected(state.today) }}>Today</button>
          </div>
          <div className="grid">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="dow">{d}</div>)}
            {days.map((d) => { const i = dayInfo(d, cfg); const list = byDate.get(d) ?? []; const n = list.length; const edited = list.some((s) => s.changed) || state.skips.some((s) => s.date === d); return (
              <button key={d} className={`day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === state.today ? 'today' : ''} ${d === selected ? 'sel' : ''}`} onClick={() => setSelected(d)} aria-label={`${fmtDate(d)}: ${i.genre}`}>
                <span className="num">{Number(d.slice(8))}{edited && <i className="dot" title="Changed for this date" />}</span>
                <span className="tag" style={{ background: genreColor(cfg, i.genre) }}>{i.genre}</span>
                <span className="count">{n} {n === 1 ? 'class' : 'classes'}</span>
              </button>) })}
          </div>
          <div className="legend">{cfg.genres.map((g) => <span key={g}><i style={{ background: genreColor(cfg, g) }} />{g}</span>)}<span><i className="dot" /> changed for that date</span></div>
        </section>
        <section className="card">
          <h2>{fmtDate(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <p className="big" style={{ color: genreColor(cfg, sel.genre) }}>{sel.genre}</p>
          <p className="muted">Rotation day {sel.cycleDay} of {cfg.genres.length} · times and levels from the {WEEKDAYS[sel.weekday]} schedule</p>
          <DayEditor2 key={selected} date={selected} state={state} slots={byDate.get(selected) ?? []} onSaved={refresh} />
        </section>
      </div>
    </div>
  )
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const COPY_TARGETS: Record<string, number[]> = { all: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekend: [0, 6] }

function DayEditor({ day, classes, levels, onChange, onCopy }: { day: number; classes: ClassTemplate[]; levels: number; onChange: (c: ClassTemplate[]) => void; onCopy: (target: string) => void }) {
  const [time, setTime] = useState('')
  const [level, setLevel] = useState(1)
  const sorted = [...classes].sort((a, b) => a.time.localeCompare(b.time))
  return (
    <div className="dayrow">
      <b className="dayname">{WEEKDAYS[day]}</b>
      <div className="times">
        {sorted.map((c) => (
          <span key={c.time} className="pill">{fmtTime(c.time)}
            <select aria-label={`${WEEKDAYS[day]} ${c.time} level`} value={c.level} onChange={(e) => onChange(classes.map((x) => (x.time === c.time ? { ...x, level: Number(e.target.value) } : x)))}>
              {Array.from({ length: levels }, (_, l) => <option key={l} value={l + 1}>L{l + 1}</option>)}
            </select>
            <button onClick={() => onChange(classes.filter((x) => x.time !== c.time))} aria-label={`Remove ${WEEKDAYS[day]} ${c.time}`}>×</button>
          </span>
        ))}
        {!classes.length && <span className="muted">No classes</span>}
      </div>
      <div className="row wrap adder">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={`New ${WEEKDAYS[day]} class time`} />
        <select value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label={`New ${WEEKDAYS[day]} class level`}>
          {Array.from({ length: levels }, (_, l) => <option key={l} value={l + 1}>Level {l + 1}</option>)}
        </select>
        <button disabled={!time || classes.some((c) => c.time === time)} onClick={() => { onChange([...classes, { time, level }]); setTime('') }}>Add</button>
        <select value="" onChange={(e) => e.target.value && onCopy(e.target.value)} aria-label={`Copy ${WEEKDAYS[day]}`}>
          <option value="">Copy to…</option><option value="weekdays">Mon–Fri</option><option value="weekend">Sat & Sun</option><option value="all">Every day</option>
        </select>
      </div>
    </div>
  )
}

function GridImport({ levels, onApply }: { levels: number; onApply: (weekly: (ClassTemplate[] | null)[]) => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ReturnType<typeof importWeeklyGrid> | null>(null)
  const read = (t: string) => {
    const r = importWeeklyGrid(t, levels)
    setResult(r)
    if (!r.errors.length && r.classes) onApply(r.weekly)
  }
  return (
    <details className="gridimport">
      <summary>Import from a spreadsheet</summary>
      <p className="muted">Use a sheet with times down the first column and days across the top, with "Level 1/2/3" in each cell. Emoji, percentages and other text are ignored; a blank or "-" cell means no class. In Google Sheets, use File → Download → CSV, or select the cells (including the header row) and copy them.</p>
      <label>CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) read(await f.text()); e.target.value = '' }} /></label>
      <label>Or paste the cells here<textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Time\tMonday\tTuesday …\n6:15 AM\tLevel 1\tLevel 2 …'} /></label>
      <button disabled={!text.trim()} onClick={() => read(text)}>Read pasted cells</button>
      {result && (result.errors.length ? (
        <div className="warn"><b>Nothing changed. Fix these and try again:</b><ul>{result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul></div>
      ) : result.classes ? (
        <p className="ok">Filled in {result.classes} classes for {result.days.join(', ')}.{result.days.length < 7 ? ' Days not in the sheet kept their current schedule.' : ''} Check below, then click Save settings.</p>
      ) : <p className="warn">No classes found. Make sure cells say "Level 1", "Level 2" or "Level 3".</p>)}
    </details>
  )
}

function Settings({ state, onSaved }: { state: AppState; onSaved: () => void }) {
  const [cfg, setCfg] = useState<RotationConfig>(state.config)
  const [skips, setSkips] = useState<SkipRule[]>(state.skips)
  const [skip, setSkip] = useState<SkipRule>({ date: '', time: '', note: '' })
  const [msg, setMsg] = useState('')
  const set = (p: Partial<RotationConfig>) => { setCfg({ ...cfg, ...p }); setMsg('') }
  const move = (i: number, d: number) => { const g = [...cfg.genres]; [g[i], g[i + d]] = [g[i + d], g[i]]; set({ genres: g }) }
  const setDay = (day: number, classes: ClassTemplate[]) => set({ weekly: cfg.weekly.map((c, i) => (i === day ? classes : c)) })
  const copyDay = (day: number, target: string) => set({ weekly: cfg.weekly.map((c, i) => (COPY_TARGETS[target].includes(i) ? cfg.weekly[day].map((x) => ({ ...x })) : c)) })
  const save = async () => {
    try { await api.saveConfig(cfg); await api.saveSkips(skips); setMsg('Saved. Use the Mariana Tek tab to push the changes.'); onSaved() } catch (e) { setMsg((e as Error).message) }
  }
  const allTimes = [...new Set(cfg.weekly.flat().map((c) => c.time))].sort()
  const perWeek = cfg.weekly.reduce((n, d) => n + d.length, 0)
  const preview = Array.from({ length: 14 }, (_, i) => addDays(state.today, i))
  return (
    <div className="stack">
      <section className="card form">
        <h2>1. Weekly schedule</h2>
        <p className="muted">Set each day's class times and levels. Every Monday gets Monday's schedule, and so on. {perWeek} classes a week.</p>
        <GridImport levels={cfg.levels} onApply={(w) => set({ weekly: cfg.weekly.map((c, i) => w[i] ?? c) })} />
        {DAY_ORDER.map((d) => <DayEditor key={d} day={d} classes={cfg.weekly[d]} levels={cfg.levels} onChange={(c) => setDay(d, c)} onCopy={(t) => copyDay(d, t)} />)}
        <div className="two">
          <label>Number of levels<input type="number" min={1} max={10} value={cfg.levels} onChange={(e) => set({ levels: Number(e.target.value) })} /></label>
          <label>Class length (minutes)<input type="number" min={5} max={240} value={cfg.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })} /></label>
        </div>
      </section>
      <section className="card form">
        <h2>2. Genre rotation</h2>
        <p className="muted">The genre moves to the next one every day, including weekends and holidays. It applies to every class that day.</p>
        <label>Day 1 date<input type="date" value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value })} /></label>
        <p className="muted">This date is {cfg.genres[0]}.</p>
        <div className="field"><span>Genre order</span>
          {cfg.genres.map((g, i) => (
            <div className="row" key={i}>
              <b>{i + 1}.</b><input value={g} onChange={(e) => set({ genres: cfg.genres.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Genre ${i + 1}`} />
              <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button disabled={i === cfg.genres.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            </div>
          ))}
        </div>
        <label>Studio time zone<input value={cfg.timeZone} onChange={(e) => set({ timeZone: e.target.value })} /></label>
      </section>
      <section className="card">
        <h2>Preview: next 2 weeks</h2>
        <div className="tablewrap"><table className="preview">
          <thead><tr><th>Date</th><th>Genre</th>{allTimes.map((t) => <th key={t}>{fmtTime(t)}</th>)}</tr></thead>
          <tbody>{preview.map((d) => { const i = dayInfo(d, cfg); const day = cfg.weekly[weekdayOf(d)]; return (
            <tr key={d}><td>{fmtDate(d)}</td><td><span className="tag" style={{ background: genreColor(cfg, i.genre) }}>{i.genre}</span></td>
              {allTimes.map((t) => { const c = day.find((x) => x.time === t); return <td key={t}>{c ? `L${c.level}` : ''}</td> })}</tr>) })}</tbody>
        </table></div>
      </section>
      <section className="card form">
        <h2>Skipped classes</h2>
        <p className="muted">Optional. Skipping a class removes it but does not shift the rotation.</p>
        <div className="row wrap">
          <input type="date" value={skip.date} onChange={(e) => setSkip({ ...skip, date: e.target.value })} aria-label="Skip date" />
          <select value={skip.time} onChange={(e) => setSkip({ ...skip, time: e.target.value })} aria-label="Skip time"><option value="">All classes that day</option>{(skip.date ? cfg.weekly[weekdayOf(skip.date)].map((c) => c.time).sort() : allTimes).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</select>
          <input placeholder="Note (optional)" value={skip.note} onChange={(e) => setSkip({ ...skip, note: e.target.value })} />
          <button disabled={!skip.date} onClick={() => { setSkips([...skips, { date: skip.date, ...(skip.time ? { time: skip.time } : {}), ...(skip.note ? { note: skip.note } : {}) }]); setSkip({ date: '', time: '', note: '' }) }}>Add</button>
        </div>
        <ul className="list">{skips.map((s, i) => <li key={i}>{fmtDate(s.date)} · {s.time ? fmtTime(s.time) : 'all classes'}{s.note ? ` · ${s.note}` : ''}<button onClick={() => setSkips(skips.filter((_, j) => j !== i))}>Remove</button></li>)}</ul>
      </section>
      <div className="actions"><button className="primary" onClick={save}>Save settings</button>{msg && <span className="msg">{msg}</span>}</div>
    </div>
  )
}

function Mariana({ state, onChanged }: { state: AppState; onChanged: () => void }) {
  const cfg = state.config
  const [opts, setOpts] = useState<{ types: Option[]; layouts: Option[] } | null>(null)
  const [typeMap, setTypeMap] = useState(state.typeMap)
  const [layoutId, setLayoutId] = useState(state.layoutId)
  const [weeks, setWeeks] = useState(4)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [result, setResult] = useState<PushResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const from = state.today, to = addDays(state.today, weeks * 7 - 1)
  useEffect(() => { api.options().then(setOpts).catch((e) => setErr(e.message)) }, [])
  const autoMatch = () => {
    if (!opts) return
    const m: Record<string, string> = { ...typeMap }
    for (const g of cfg.genres) for (let l = 1; l <= cfg.levels; l++) {
      const hit = opts.types.find((t) => { const n = t.name.toLowerCase(); return n.includes(g.toLowerCase()) && new RegExp(`(^|\\D)${l}(\\D|$)`).test(n) })
      if (hit) m[typeKey(g, l)] = hit.id
    }
    setTypeMap(m)
  }
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const saveMapping = () => run(async () => { await api.saveMapping(typeMap, layoutId); onChanged(); setPlan(await api.plan(from, to)) })
  const push = () => run(async () => {
    if (!plan) return
    const n = plan.create.length + plan.update.length + plan.remove.length
    if (!confirm(`Apply ${n} change(s) to ${state.connection.mode === 'live' ? state.connection.label : 'the demo studio'}?`)) return
    setResult(await api.apply(from, to)); setPlan(await api.plan(from, to)); onChanged()
  })
  return (
    <div className="stack">
      {state.connection.mode === 'demo' && (
        <section className="card notice">
          <b>Demo mode.</b> Pushes go to a pretend studio stored on this computer, not to Mariana Tek. To connect for real, the studio must request API access from <a href="mailto:integrations@marianatek.com">integrations@marianatek.com</a>; then set <code>MARIANATEK_TENANT</code> and <code>MARIANATEK_API_TOKEN</code> (see README).
          <button className="ghost" onClick={() => run(async () => { if (confirm('Erase all settings and demo classes?')) { await api.resetDemo(); location.reload() } })}>Reset demo</button>
        </section>
      )}
      <section className="card form">
        <h2>1. Match class types</h2>
        <p className="muted">Pick the Mariana Tek class type for each genre and level. Create them in Mariana Tek first (each set to {cfg.durationMin} minutes); class length comes from the class type.</p>
        <button className="ghost" onClick={autoMatch} disabled={!opts}>Auto-match by name</button>
        <table className="map"><thead><tr><th>Genre</th>{Array.from({ length: cfg.levels }, (_, l) => <th key={l}>Level {l + 1}</th>)}</tr></thead>
          <tbody>{cfg.genres.map((g) => <tr key={g}><th>{g}</th>{Array.from({ length: cfg.levels }, (_, l) => (
            <td key={l}><select aria-label={`${g} level ${l + 1}`} value={typeMap[typeKey(g, l + 1)] ?? ''} onChange={(e) => setTypeMap({ ...typeMap, [typeKey(g, l + 1)]: e.target.value })}>
              <option value="">Choose…</option>{opts?.types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.detail ? ` (${t.detail})` : ''}</option>)}</select></td>))}</tr>)}</tbody></table>
        <label>Room layout<select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}><option value="">Choose…</option>{opts?.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      </section>
      <section className="card form">
        <h2>2. Preview and push</h2>
        <div className="row wrap">
          <label className="inline">Schedule ahead<select value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setPlan(null) }}>{[1, 2, 4, 8, 12].map((w) => <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>)}</select></label>
          <span className="muted">{fmtDate(from)} – {fmtDate(to)}</span>
          <button onClick={saveMapping} disabled={busy}>Save & preview changes</button>
          <a className="btn ghost" href={api.csvUrl(from, to)}>Download CSV</a>
        </div>
        {plan && (
          <div className="plan">
            {plan.missingTypes.length > 0 && <p className="warn">Not matched yet: {plan.missingTypes.join(', ')}</p>}
            <div className="stats"><span><b>{plan.create.length}</b> to create</span><span><b>{plan.update.length}</b> to change</span><span><b>{plan.remove.length}</b> to remove</span><span><b>{plan.unchanged}</b> already correct</span></div>
            <details><summary>See the changes</summary><ul className="list">
              {plan.create.map((s) => <li key={s.key}>+ {fmtDate(s.date)} {fmtTime(s.time)} · {s.genre} {s.level}</li>)}
              {plan.update.map((u) => <li key={u.slot.key}>~ {fmtDate(u.slot.date)} {fmtTime(u.slot.time)} · {u.from} → {u.slot.genre} L{u.slot.level}</li>)}
              {plan.remove.map((r) => <li key={r.key}>− {fmtDate(r.key.slice(0, 10))} {fmtTime(r.key.slice(11))} · {r.genre} L{r.level}</li>)}
            </ul></details>
            <p className="muted">Classes that already have bookings are never changed or removed automatically; they are listed for staff instead. Past classes are never touched.</p>
            <button className="primary" disabled={busy || plan.missingTypes.length > 0 || !layoutId || plan.create.length + plan.update.length + plan.remove.length === 0} onClick={push}>
              {state.connection.mode === 'live' ? 'Push to Mariana Tek' : 'Push to demo studio'}</button>
          </div>
        )}
        {result && (
          <div className="result">
            <p><b>Done:</b> {result.created} created, {result.updated} changed, {result.removed} removed.</p>
            {result.flagged.length > 0 && <><p className="warn">Needs staff attention ({result.flagged.length}):</p><ul className="list">{result.flagged.map((f) => <li key={f.key}>{fmtDate(f.key.slice(0, 10))} {fmtTime(f.key.slice(11))}: {f.reason}</li>)}</ul></>}
            {result.errors.length > 0 && <><p className="warn">Errors ({result.errors.length}):</p><ul className="list">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
          </div>
        )}
        {err && <p className="warn">{err}</p>}
      </section>
    </div>
  )
}

function Activity() {
  const [log, setLog] = useState<LogEntry[]>([])
  useEffect(() => { api.log().then(setLog) }, [])
  return (
    <section className="card"><h2>Activity</h2>
      <ul className="list">{log.map((l, i) => <li key={i}><span className="muted">{new Date(l.at).toLocaleString()}</span> · <b>{l.action}</b> · {l.detail}</li>)}{!log.length && <li className="muted">Nothing yet.</li>}</ul>
    </section>
  )
}

function PushResultView({ result }: { result: PushResult }) {
  return (
    <div className="result">
      <p><b>Done:</b> {result.created} created, {result.updated} changed, {result.removed} removed.</p>
      {result.flagged.length > 0 && <><p className="warn">Needs staff attention ({result.flagged.length}):</p><ul className="list">{result.flagged.map((f) => <li key={f.key}>{fmtDate(f.key.slice(0, 10))} {fmtTime(f.key.slice(11))}: {f.reason}</li>)}</ul></>}
      {result.errors.length > 0 && <><p className="warn">Errors ({result.errors.length}):</p><ul className="list">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
    </div>
  )
}

function ImportCsv({ state, onChanged, goMapping }: { state: AppState; onChanged: () => void; goMapping: () => void }) {
  const cfg = state.config
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [removeMissing, setRemoveMissing] = useState(true)
  const [weekStart, setWeekStart] = useState('')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [result, setResult] = useState<PushResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const check = (text: string, remove = removeMissing, ws = weekStart) => run(async () => { setResult(null); setPlan(await api.importPlan(text, remove, ws)) })
  const onFile = async (f: File | undefined) => {
    if (!f) return
    const text = await f.text()
    setCsv(text); setFileName(f.name); check(text)
  }
  const changes = plan ? plan.create.length + plan.update.length + plan.remove.length : 0
  const notReady = !state.layoutId || (plan?.missingTypes.length ?? 0) > 0
  const push = () => run(async () => {
    if (!confirm(`Push ${changes} change(s) from ${fileName || 'the file'} to ${state.connection.mode === 'live' ? state.connection.label : 'the demo studio'}?`)) return
    setResult(await api.importApply(csv, removeMissing, weekStart)); setPlan(await api.importPlan(csv, removeMissing, weekStart)); onChanged()
  })
  const sample = `Date,Start,Genre,Level\n${cfg.startDate},06:00,${cfg.genres[0]},1\n${cfg.startDate},9:00 AM,${cfg.genres[0]},1\n`
  return (
    <div className="stack">
      <section className="card form">
        <h2>Import a schedule</h2>
        <p className="muted">Upload the schedule spreadsheet (for example, the one Gemini makes) and push it to Mariana Tek. If something changes, edit the same sheet and upload it again: only the differences are pushed.</p>
        <div className="field"><span>Accepted layouts</span>
          <ul className="muted bullets">
            <li><b>Grid:</b> class times down the first column, days across the top, "Level 1/2/3" in each cell. Headers can be dates ("Mon 12/1", "Dec 1") or day names plus the week 1 start date below. Several weeks can be stacked, each with its own header row. Emoji, percentages and "-" are ignored.</li>
            <li><b>One row per class:</b> <b>Date</b>, <b>Start</b>, and <b>Level</b>, plus <b>Genre</b> or a <b>Class name</b> like "{cfg.genres[0]} 2".</li>
            <li><b>Genre:</b> taken from the file when a cell, header or column names one ({cfg.genres.join(', ')}); otherwise from your genre rotation.</li>
          </ul>
          <div className="row wrap">
            <a className="btn ghost" href={`data:text/csv;charset=utf-8,${encodeURIComponent(sample)}`} download="schedule-template.csv">Download row template</a>
          </div>
        </div>
        <label>Schedule file (CSV)<input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} /></label>
        {(plan?.needsWeekStart || weekStart) && (
          <label>Week 1 starts on<input type="date" value={weekStart} onChange={(e) => { setWeekStart(e.target.value); if (csv) check(csv, removeMissing, e.target.value) }} /></label>
        )}
        <label className="inline"><input type="checkbox" checked={removeMissing} onChange={(e) => { setRemoveMissing(e.target.checked); if (csv) check(csv, e.target.checked) }} />
          Remove classes that were taken out of the file (only between its first and last date)</label>
        {plan && (
          <div className="plan">
            <p><b>{fileName}</b>: {plan.rows} class{plan.rows === 1 ? '' : 'es'}{plan.from ? `, ${fmtDate(plan.from)} – ${fmtDate(plan.to!)}` : ''}{plan.past ? `. ${plan.past} already in the past will be skipped` : ''}.
              {plan.genreFromRotation > 0 && <> Genre for {plan.genreFromRotation === plan.rows ? 'all' : plan.genreFromRotation} of them comes from your rotation (Day 1 = {fmtDate(cfg.startDate)}).</>}</p>
            {plan.errors.length > 0 && <>
              <p className="warn">{plan.needsWeekStart ? 'One more step:' : `${plan.errors.length} row${plan.errors.length === 1 ? '' : 's'} need fixing before you can push:`}</p>
              <ul className="list errors">{plan.errors.slice(0, 50).map((e, i) => <li key={i}>{e.row ? `Row ${e.row}: ` : ''}{e.message}</li>)}{plan.errors.length > 50 && <li className="muted">…and {plan.errors.length - 50} more</li>}</ul>
            </>}
            {plan.missingTypes.length > 0 && <p className="warn">Not matched to a Mariana Tek class type yet: {plan.missingTypes.join(', ')}. <button className="ghost" onClick={goMapping}>Match class types</button></p>}
            {!state.layoutId && <p className="warn">No room layout chosen yet. <button className="ghost" onClick={goMapping}>Choose one</button></p>}
            <div className="stats"><span><b>{plan.create.length}</b> to create</span><span><b>{plan.update.length}</b> to change</span><span><b>{plan.remove.length}</b> to remove</span><span><b>{plan.unchanged}</b> already correct</span></div>
            <details open={changes > 0 && changes <= 30}><summary>See the changes</summary><ul className="list">
              {plan.create.map((s) => <li key={s.key}>+ {fmtDate(s.date)} {fmtTime(s.time)} · {s.genre} {s.level}</li>)}
              {plan.update.map((u) => <li key={u.slot.key}>~ {fmtDate(u.slot.date)} {fmtTime(u.slot.time)} · {u.from} → {u.slot.genre} L{u.slot.level}</li>)}
              {plan.remove.map((r) => <li key={r.key}>− {fmtDate(r.key.slice(0, 10))} {fmtTime(r.key.slice(11))} · {r.genre} L{r.level}</li>)}
            </ul></details>
            <p className="muted">Compared with the classes this tool has already put in Mariana Tek. Classes with bookings are never changed or removed automatically, and past classes are never touched. Uploading the same file again changes nothing.</p>
            <button className="primary" disabled={busy || plan.errors.length > 0 || notReady || changes === 0} onClick={push}>
              {changes === 0 && plan.rows > 0 && !plan.errors.length ? 'Mariana Tek already matches this file' : `Push ${changes} change${changes === 1 ? '' : 's'} to ${state.connection.mode === 'live' ? 'Mariana Tek' : 'demo studio'}`}</button>
          </div>
        )}
        {result && <PushResultView result={result} />}
        {err && <p className="warn">{err}</p>}
      </section>
    </div>
  )
}
