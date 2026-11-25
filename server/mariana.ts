export interface MtOption { id: string; name: string; detail?: string }

export interface NewClass {
  startDate: string
  startTime: string
  typeId: string
  layoutId: string
  instructorIds: string[]
  publicNote?: string
}

export interface MarianaClient {
  mode: 'demo' | 'live'
  label: string
  listClassTypes(): Promise<MtOption[]>
  listLayouts(): Promise<MtOption[]>
  createClass(c: NewClass): Promise<string>
  changeClassType(id: string, typeId: string, publicNote?: string): Promise<void>
  reservationCount(id: string): Promise<number>
  /** Deletes a class that has no reservations. Classes with reservations are left for staff to handle. */
  deleteClass(id: string): Promise<void>
}

export class MarianaError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}

type JsonApiResource = { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, unknown> }

/** Mariana Tek Admin API (JSON:API over REST). https://docs.marianatek.com/ */
export class LiveMariana implements MarianaClient {
  mode = 'live' as const
  label: string
  private base: string
  constructor(tenant: string, private token: string, private fetchImpl: typeof fetch = fetch) {
    this.base = `https://${tenant}.marianatek.com/api`
    this.label = `${tenant}.marianatek.com`
  }

  private async req(method: string, path: string, body?: unknown) {
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.api+json',
        ...(body ? { 'Content-Type': 'application/vnd.api+json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new MarianaError(`Mariana Tek ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`, res.status)
    }
    return res.status === 204 ? null : res.json()
  }

  private async listAll(path: string): Promise<JsonApiResource[]> {
    const out: JsonApiResource[] = []
    for (let page = 1; page <= 20; page++) {
      const sep = path.includes('?') ? '&' : '?'
      const body = (await this.req('GET', `${path}${sep}page_size=100&page=${page}`)) as { data: JsonApiResource[]; links?: { next?: string | null } }
      out.push(...body.data)
      if (!body.links?.next) break
    }
    return out
  }

  async listClassTypes() {
    const rows = await this.listAll('/class_session_types/?enabled=true')
    return rows.map((r) => ({ id: r.id, name: String(r.attributes?.name ?? r.id), detail: r.attributes?.duration ? `${r.attributes.duration} min` : undefined }))
  }

  async listLayouts() {
    const rows = await this.listAll('/layouts/')
    return rows.map((r) => ({ id: r.id, name: String(r.attributes?.name ?? r.id) }))
  }

  async createClass(c: NewClass) {
    const body = await this.req('POST', '/class_sessions/', {
      data: {
        type: 'class_sessions',
        attributes: { start_date: c.startDate, start_time: `${c.startTime}:00`, public: true, ...(c.publicNote ? { public_note: c.publicNote } : {}) },
        relationships: {
          class_session_type: { data: { type: 'class_session_types', id: c.typeId } },
          layout: { data: { type: 'layouts', id: c.layoutId } },
          ...(c.instructorIds.length ? { instructors: { data: c.instructorIds.map((id) => ({ type: 'instructors', id })) } } : {}),
        },
      },
    }) as { data: JsonApiResource }
    return body.data.id
  }

  async changeClassType(id: string, typeId: string, publicNote?: string) {
    await this.req('PATCH', `/class_sessions/${id}/`, {
      data: {
        type: 'class_sessions', id,
        ...(publicNote !== undefined ? { attributes: { public_note: publicNote } } : {}),
        relationships: { class_session_type: { data: { type: 'class_session_types', id: typeId } } },
      },
    })
  }

  async reservationCount(id: string) {
    const body = await this.req('GET', `/class_sessions/${id}/`) as { data: JsonApiResource }
    const a = body.data.attributes ?? {}
    return Number(a.standard_reservation_user_count ?? 0) + Number(a.waitlist_reservation_user_count ?? 0)
  }

  async deleteClass(id: string) {
    await this.req('DELETE', `/class_sessions/${id}/`)
  }
}

export interface DemoClass { id: string; startDate: string; startTime: string; typeId: string; layoutId: string; reservations: number; publicNote?: string }

/** Stand-in for a Mariana Tek site so the planner can be tried without API access. */
export class DemoMariana implements MarianaClient {
  mode = 'demo' as const
  label = 'Demo studio (not a real Mariana Tek site)'
  constructor(private state: { classes: DemoClass[]; nextId: number }, private persist: () => void) {}
  static types(genres: string[], levels: number): MtOption[] {
    return genres.flatMap((g, gi) => Array.from({ length: levels }, (_, li) => ({ id: `demo-type-${gi + 1}${li + 1}`, name: `${g} ${li + 1}`, detail: '50 min' })))
  }
  genres: string[] = []
  levels = 3
  async listClassTypes() { return DemoMariana.types(this.genres, this.levels) }
  async listLayouts() { return [{ id: 'demo-layout-1', name: 'Main Studio (24 spots)' }, { id: 'demo-layout-2', name: 'Studio B (12 spots)' }] }
  async createClass(c: NewClass) {
    const id = `demo-${this.state.nextId++}`
    this.state.classes.push({ id, startDate: c.startDate, startTime: c.startTime, typeId: c.typeId, layoutId: c.layoutId, reservations: 0, publicNote: c.publicNote })
    this.persist()
    return id
  }
  private find(id: string) {
    const c = this.state.classes.find((x) => x.id === id)
    if (!c) throw new MarianaError(`Class ${id} not found`, 404)
    return c
  }
  async changeClassType(id: string, typeId: string, publicNote?: string) { const c = this.find(id); c.typeId = typeId; if (publicNote !== undefined) c.publicNote = publicNote; this.persist() }
  async reservationCount(id: string) { return this.find(id).reservations }
  async deleteClass(id: string) { this.find(id); this.state.classes = this.state.classes.filter((x) => x.id !== id); this.persist() }
}
