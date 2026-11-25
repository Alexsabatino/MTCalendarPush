import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const api = process.env.API_PORT ?? '8790'
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': `http://127.0.0.1:${api}` } },
  test: { environment: 'node' },
} as never)
