import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_CONFIG, type ClassChange, type RotationConfig, type SkipRule } from '../shared/rotation'
import type { PushedClass } from '../shared/sync'
import type { DemoClass } from './mariana'

export interface LogEntry { at: string; action: string; detail: string }

export interface StoreData {
  config: RotationConfig
  skips: SkipRule[]
  changes: ClassChange[]
  typeMap: Record<string, string>
  layoutId: string
  instructorIds: string[]
  pushed: PushedClass[]
  log: LogEntry[]
  demo: { classes: DemoClass[]; nextId: number }
}

const fresh = (): StoreData => ({
  config: structuredClone(DEFAULT_CONFIG),
  skips: [],
  changes: [],
  typeMap: {},
  layoutId: '',
  instructorIds: [],
  pushed: [],
  log: [],
  demo: { classes: [], nextId: 1001 },
})

export class Store {
  data: StoreData
  constructor(private file: string | null) {
    this.data = fresh()
    if (file && fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      const config = { ...DEFAULT_CONFIG, ...saved.config }
      delete config.times
      this.data = { ...fresh(), ...saved, config }
    }
  }
  save() {
    if (!this.file) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }
  log(action: string, detail: string) {
    this.data.log.unshift({ at: new Date().toISOString(), action, detail })
    this.data.log = this.data.log.slice(0, 500)
    this.save()
  }
  reset() { this.data = fresh(); this.save() }
}
