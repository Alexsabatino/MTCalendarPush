import type { Slot } from './rotation'

export interface PushedClass {
  key: string
  mtId: string
  /** Empty until the genre rotation has been pushed to this class. */
  genre: string
  level: number
  typeId: string
  createdAt: string
}

export interface SyncPlan {
  create: Slot[]
  update: { slot: Slot; pushed: PushedClass; typeId: string }[]
  remove: PushedClass[]
  unchanged: number
  missingTypes: string[]
}

export const classLabel = (genre: string, level: number) => (genre ? `${genre} L${level}` : `Level ${level}`)

/**
 * Compares the planned rotation against classes this tool already created in Mariana Tek.
 * Only future classes inside [from, to] are touched; past classes are never changed.
 */
export function planSync(
  desired: Slot[],
  pushed: PushedClass[],
  typeFor: (genre: string, level: number) => string | undefined,
  from: string,
  to: string,
  now: string,
  opts: { remove?: boolean } = {},
): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [], unchanged: 0, missingTypes: [] }
  const future = (key: string) => key > now
  const byKey = new Map(pushed.map((p) => [p.key, p]))
  const wanted = new Set<string>()
  for (const slot of desired) {
    if (!future(slot.key)) continue
    wanted.add(slot.key)
    const typeId = typeFor(slot.genre, slot.level)
    if (!typeId) {
      const label = classLabel(slot.genre, slot.level)
      if (!plan.missingTypes.includes(label)) plan.missingTypes.push(label)
      continue
    }
    const existing = byKey.get(slot.key)
    if (!existing) plan.create.push(slot)
    else if (existing.typeId !== typeId) plan.update.push({ slot, pushed: existing, typeId })
    else plan.unchanged++
  }
  if (opts.remove === false) return plan
  for (const p of pushed) {
    const date = p.key.slice(0, 10)
    if (date < from || date > to || !future(p.key)) continue
    if (!wanted.has(p.key)) plan.remove.push(p)
  }
  return plan
}
