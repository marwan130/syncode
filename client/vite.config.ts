import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/collabhub': {
        target: 'http://localhost:5111',
        // proxy websockets to the backend for signalr
        ws: true,
      },
      '/api': {
        target: 'http://localhost:5111',
      },
    },
  },
})
