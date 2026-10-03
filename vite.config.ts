import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the build works under the GitHub Pages subpath.
  base: './',
  plugins: [react()],
})
