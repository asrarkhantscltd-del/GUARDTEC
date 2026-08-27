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
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
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
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Default precache limit is 2 MiB — today's session pushed the main
        // bundle to ~2.2 MB (agency/acknowledgment/custom-forms pages all
        // land in one chunk, no route-level code-splitting yet), which made
        // the Docker build fail outright rather than just warn. Raised with
        // headroom rather than set to the current size, so the next feature
        // added doesn't hit this same wall immediately again. Proper fix
        // later is route-based code-splitting (dynamic import()) to keep
        // individual chunks small — this is the stopgap.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Without this, the SPA navigation fallback intercepts top-level
        // navigations to /api/* (e.g. window.open, <a href="/api/...">
        // target="_blank") and serves the cached index.html instead of
        // the real response — breaking file downloads and document viewing.
        navigateFallbackDenylist: [/^\/api\//],
        // A new service worker otherwise sits "waiting" until every open
        // tab closes before it takes over, so a rebuild silently keeps
        // serving the old JS bundle. These make the new version activate
        // and take control of open tabs immediately after install.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 300 },
            },
          },
        ],
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
