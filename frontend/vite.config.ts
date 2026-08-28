import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest (not generateSW) because push notifications need a
      // hand-written `push` event listener in the service worker itself —
      // see src/sw.ts, which also now owns the runtime-caching rules that
      // used to live in the `workbox: {...}` block below.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      devOptions: { enabled: true, type: 'module' },
      includeAssets: ['icon.svg', 'favicon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        id: '/',
        name: 'GuardTec Compliance',
        short_name: 'GuardTec',
        description: 'GuardTec Security — Staff Compliance Management',
        theme_color: '#1e2535',
        background_color: '#1e2535',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
  { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
],
        screenshots: [
          { src: 'screenshots/login-mobile.jpeg', sizes: '1072x2048', type: 'image/jpeg', form_factor: 'narrow', label: 'Sign in to the GuardTec compliance portal' },
        ],
      },
      // Same 2MiB-default problem as before (see the old comment this
      // replaced): the main bundle is ~2.2MB, so the precache list built
      // into sw.ts needs the same raised ceiling generateSW used to apply
      // automatically via `workbox.maximumFileSizeToCacheInBytes`.
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react': path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
