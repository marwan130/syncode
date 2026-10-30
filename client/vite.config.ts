import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { defineConfig } from 'vite'

const roomServer = 'http://localhost:5111'

function roomServerProxy(): ProxyOptions {
  return {
    target: roomServer,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('error', (_error, _request, response) => {
        if ('headersSent' in response && !response.headersSent) {
          response.writeHead(503, { 'Content-Type': 'application/json' })
          response.end(
            JSON.stringify({
              error: 'The Syncode room server is not running on localhost:5111.',
            })
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'monaco-vendor',
              test: /node_modules[\\/]monaco-editor[\\/]/,
              priority: 20,
            },
            {
              name: 'terminal-vendor',
              test: /node_modules[\\/]@xterm[\\/]/,
              priority: 15,
            },
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
              priority: 10,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: [{ find: /^\.\/dompurify\/dompurify\.js$/, replacement: 'dompurify' }],
  },
  server: {
    proxy: {
      '/collabhub': {
        ...roomServerProxy(),
        ws: true,
      },
      '/api': roomServerProxy(),
    },
  },
})
