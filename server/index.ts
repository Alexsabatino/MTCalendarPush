import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import { clientFromEnv, createApp } from './app'
import { Store } from './store'

const store = new Store(path.resolve(process.env.DATA_FILE ?? 'data/store.json'))
const client = clientFromEnv()
const app = createApp({ store, client })
const dist = path.resolve('dist')
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}
const port = Number(process.env.API_PORT ?? 8790)
app.listen(port, '127.0.0.1', () => {
  console.log(`API on http://127.0.0.1:${port} — ${client ? `LIVE Mariana Tek (${client.label})` : 'demo mode (no Mariana Tek connection)'}`)
})
