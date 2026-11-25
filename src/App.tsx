import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, dayInfo, typeKey, type RotationConfig, type SkipRule } from '../shared/rotation'
import { api, type AppState, type LogEntry, type Option, type Plan, type PreviewSlot, type PushResult } from './api'

type Tab = 'calendar' | 'settings' | 'mariana' | 'activity'
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
        {([['calendar', 'Calendar'], ['settings', 'Rotation settings'], ['mariana', 'Mariana Tek'], ['activity', 'Activity']] as const).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <main>
        {tab === 'calendar' && <CalendarView state={state} />}
        {tab === 'settings' && <Settings state={state} onSaved={reload} />}
        {tab === 'mariana' && <Mariana state={state} onChanged={reload} />}
        {tab === 'activity' && <Activity />}
      </main>
    </div>
  )
}

function CalendarView({ state }: { state: AppState }) {
  const cfg = state.config
  const [month, setMonth] = useState(state.today.slice(0, 7))
  const [selected, setSelected] = useState(state.today)
  const [slots, setSlots] = useState<PreviewSlot[]>([])
  const first = `${month}-01`
  const gridStart = addDays(first, -new Date(`${first}T12:00:00Z`).getUTCDay())
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  useEffect(() => { api.preview(days[0], days[41]).then(setSlots) }, [month, cfg]) // eslint-disable-line react-hooks/exhaustive-deps
  const byDate = useMemo(() => { const m = new Map<string, PreviewSlot[]>(); for (const s of slots) m.set(s.date, [...(m.get(s.date) ?? []), s]); return m }, [slots])
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)) }
  const upcoming = Array.from({ length: 9 }, (_, i) => addDays(state.today, i))
  const sel = dayInfo(selected, cfg)
  return (
    <div className="stack">
      <section className="card">
        <h2>Next 9 days</h2>
        <div className="strip">
          {upcoming.map((d) => { const i = dayInfo(d, cfg); return (
            <button key={d} className={`chip ${d === selected ? 'sel' : ''}`} style={{ borderColor: genreColor(cfg, i.genre) }} onClick={() => { setSelected(d); setMonth(d.slice(0, 7)) }}>
              <small>{d === state.today ? 'Today' : fmtDate(d, { weekday: 'short', day: 'numeric' })}</small>
              <b style={{ color: genreColor(cfg, i.genre) }}>{i.genre}</b><span>Level {i.level}</span>
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
            {days.map((d) => { const i = dayInfo(d, cfg); const n = byDate.get(d)?.length ?? 0; return (
              <button key={d} className={`day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === state.today ? 'today' : ''} ${d === selected ? 'sel' : ''}`} onClick={() => setSelected(d)} aria-label={`${fmtDate(d)}: ${i.genre} level ${i.level}`}>
                <span className="num">{Number(d.slice(8))}</span>
                <span className="tag" style={{ background: genreColor(cfg, i.genre) }}>{i.genre.slice(0, 3)} {i.level}</span>
                <span className="count">{n} {n === 1 ? 'class' : 'classes'}</span>
              </button>) })}
          </div>
          <div className="legend">{cfg.genres.map((g) => <span key={g}><i style={{ background: genreColor(cfg, g) }} />{g}</span>)}</div>
        </section>
        <section className="card">
          <h2>{fmtDate(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <p className="big" style={{ color: genreColor(cfg, sel.genre) }}>{sel.genre} · Level {sel.level}</p>
          <p className="muted">Rotation day {sel.cycleDay} of {cfg.genres.length * cfg.levels}</p>
          <ul className="classes">
            {(byDate.get(selected) ?? []).map((s) => (
              <li key={s.key}><span>{fmtTime(s.time)} – {fmtTime(s.end)}</span><b>{s.genre} {s.level}</b><em className={s.mtId ? 'ok' : ''}>{s.mtId ? 'In Mariana Tek' : 'Not pushed'}</em></li>
            ))}
            {!byDate.get(selected)?.length && <li className="muted">No classes (skipped or no class times set).</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Settings({ state, onSaved }: { state: AppState; onSaved: () => void }) {
  const [cfg, setCfg] = useState<RotationConfig>(state.config)
  const [skips, setSkips] = useState<SkipRule[]>(state.skips)
  const [newTime, setNewTime] = useState('')
  const [skip, setSkip] = useState<SkipRule>({ date: '', time: '', note: '' })
  const [msg, setMsg] = useState('')
  const set = (p: Partial<RotationConfig>) => setCfg({ ...cfg, ...p })
  const move = (i: number, d: number) => { const g = [...cfg.genres]; [g[i], g[i + d]] = [g[i + d], g[i]]; set({ genres: g }) }
  const save = async () => {
    try { await api.saveConfig(cfg); await api.saveSkips(skips); setMsg('Saved. Use the Mariana Tek tab to push the changes.'); onSaved() } catch (e) { setMsg((e as Error).message) }
  }
  const preview = Array.from({ length: cfg.genres.length * cfg.levels }, (_, i) => dayInfo(addDays(cfg.startDate, i), cfg))
  return (
    <div className="stack">
      <section className="card form">
        <h2>Rotation</h2>
        <label>Day 1 date<input type="date" value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value })} /></label>
        <p className="muted">This date is {cfg.genres[0]} Level 1. The studio is open every day, so the rotation counts every calendar day.</p>
        <div className="field"><span>Genre order</span>
          {cfg.genres.map((g, i) => (
            <div className="row" key={i}>
              <b>{i + 1}.</b><input value={g} onChange={(e) => set({ genres: cfg.genres.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Genre ${i + 1}`} />
              <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button disabled={i === cfg.genres.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            </div>
          ))}
        </div>
        <div className="two">
          <label>Number of levels<input type="number" min={1} max={10} value={cfg.levels} onChange={(e) => set({ levels: Number(e.target.value) })} /></label>
          <label>Class length (minutes)<input type="number" min={5} max={240} value={cfg.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })} /></label>
        </div>
        <label>Studio time zone<input value={cfg.timeZone} onChange={(e) => set({ timeZone: e.target.value })} /></label>
        <div className="field"><span>Daily class times (every day of the week)</span>
          <div className="times">
            {[...cfg.times].sort().map((t) => <span key={t} className="pill">{fmtTime(t)}<button onClick={() => set({ times: cfg.times.filter((x) => x !== t) })} aria-label={`Remove ${t}`}>×</button></span>)}
          </div>
          <div className="row"><input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="New class time" />
            <button disabled={!newTime || cfg.times.includes(newTime)} onClick={() => { set({ times: [...cfg.times, newTime] }); setNewTime('') }}>Add time</button></div>
        </div>
        <div className="field"><span>One full cycle ({preview.length} days)</span>
          <div className="cycle">{preview.map((p) => <span key={p.cycleDay} style={{ background: genreColor(cfg, p.genre) }}>Day {p.cycleDay}<br /><b>{p.genre} {p.level}</b></span>)}</div>
        </div>
      </section>
      <section className="card form">
        <h2>Skipped classes</h2>
        <p className="muted">Optional. Skipping a class removes it but does not shift the rotation.</p>
        <div className="row wrap">
          <input type="date" value={skip.date} onChange={(e) => setSkip({ ...skip, date: e.target.value })} aria-label="Skip date" />
          <select value={skip.time} onChange={(e) => setSkip({ ...skip, time: e.target.value })} aria-label="Skip time"><option value="">All classes that day</option>{[...cfg.times].sort().map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</select>
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
