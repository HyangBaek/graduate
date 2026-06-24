import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GitHub Pages serves this project from https://<user>.github.io/graduate/,
// so the base path must match the repository name in production builds.
// Local dev keeps '/' so `npm run dev` still works against root.
const isProdBuild = process.env.NODE_ENV === 'production'

// https://vite.dev/config/
export default defineConfig({
  base: isProdBuild ? '/graduate/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src/app'),
      '@domain': path.resolve(__dirname, 'src/domain'),
      '@infrastructure': path.resolve(__dirname, 'src/infrastructure'),
      '@presentation': path.resolve(__dirname, 'src/presentation'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
