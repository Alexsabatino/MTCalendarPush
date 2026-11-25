import type { RotationConfig, SkipRule, Slot } from '../shared/rotation'

export interface AppState {
  config: RotationConfig; skips: SkipRule[]; typeMap: Record<string, string>; layoutId: string; instructorIds: string[]
  pushedCount: number; today: string; connection: { mode: 'demo' | 'live'; label: string }
}
export type PreviewSlot = Slot & { end: string; mtId: string | null }
export interface Option { id: string; name: string; detail?: string }
export interface Plan { create: Slot[]; update: { slot: Slot; mtId: string; from: string }[]; remove: { key: string; mtId: string; genre: string; level: number }[]; unchanged: number; missingTypes: string[] }
export interface PushResult { created: number; updated: number; removed: number; flagged: { key: string; mtId: string; reason: string }[]; errors: string[] }
export interface LogEntry { at: string; action: string; detail: string }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`)
  return data as T
}

export const api = {
  state: () => req<AppState>('GET', '/api/state'),
  saveConfig: (c: RotationConfig) => req<RotationConfig>('PUT', '/api/config', c),
  saveSkips: (s: SkipRule[]) => req<SkipRule[]>('PUT', '/api/skips', s),
  preview: (from: string, to: string) => req<PreviewSlot[]>('GET', `/api/preview?from=${from}&to=${to}`),
  options: () => req<{ types: Option[]; layouts: Option[] }>('GET', '/api/mariana/options'),
  saveMapping: (typeMap: Record<string, string>, layoutId: string) => req('PUT', '/api/mariana/mapping', { typeMap, layoutId, instructorIds: [] }),
  plan: (from: string, to: string) => req<Plan>('POST', '/api/sync/plan', { from, to }),
  apply: (from: string, to: string) => req<PushResult>('POST', '/api/sync/apply', { from, to }),
  log: () => req<LogEntry[]>('GET', '/api/log'),
  resetDemo: () => req('POST', '/api/demo/reset'),
  csvUrl: (from: string, to: string) => `/api/export.csv?from=${from}&to=${to}`,
}
