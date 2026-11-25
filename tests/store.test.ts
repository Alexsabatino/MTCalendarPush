import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, OLD_PLACEHOLDER_WEEKLY } from '../shared/rotation'
import { Store } from '../server/store'

const saved = (weekly: unknown) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rp-')), 'store.json')
  fs.writeFileSync(file, JSON.stringify({ config: { ...DEFAULT_CONFIG, weekly } }))
  return new Store(file).data.config.weekly
}

describe('saved settings', () => {
  it("swaps the old made-up weekly schedule for the studio's sheet", () => {
    expect(saved(OLD_PLACEHOLDER_WEEKLY)).toEqual(DEFAULT_CONFIG.weekly)
    expect(DEFAULT_CONFIG.weekly.map((d) => d.length)).toEqual([7, 12, 12, 12, 12, 12, 9])
  })
  it('keeps a weekly schedule the studio entered', () => {
    const own = [[{ time: '09:00', level: 2 }], [], [], [], [], [], []]
    expect(saved(own)).toEqual(own)
  })
})
