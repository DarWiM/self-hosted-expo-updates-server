import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // PrimeReact is a single ~580 kB (≈150 kB gzip) UI kit that can't be
    // meaningfully split further and is needed on first paint; it lives in its
    // own cacheable `primereact` chunk. Raise the warning limit just past it so
    // the intentional vendor chunk doesn't flag every build.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split vendor code out of the app bundle into a few long-lived,
        // separately-cacheable chunks. Route code is already lazy-loaded
        // (src/index.tsx), so this targets the vendor weight that otherwise
        // rode along in the entry chunk: PrimeReact (the UI kit) is the
        // heaviest, React core changes rarely, and the rest (moment, lodash,
        // feathers, socket.io, fontawesome) share a general vendor chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('primereact') || id.includes('primeicons') || id.includes('@primeuix')) return 'primereact'
          if (
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/react/') ||
            id.includes('/scheduler/')
          ) {
            return 'react'
          }
          return 'vendor'
        },
      },
    },
  },
})
