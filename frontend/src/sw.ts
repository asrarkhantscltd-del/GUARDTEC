/// <reference lib="webworker" />
// Custom service worker — replaces vite-plugin-pwa's auto-generated one
// (generateSW strategy) because that strategy can't run our own code, and a
// `push` event listener is exactly that: our own code, not something a
// config option can express. This file is built via the `injectManifest`
// strategy in vite.config.ts, which just substitutes `self.__WB_MANIFEST`
// below with the real list of files to precache — everything else here is
// hand-written, including the runtime caching that used to live in
// vite.config.ts's `workbox: {...}` block.
export {}
declare let self: ServiceWorkerGlobalScope

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

self.skipWaiting()
self.addEventListener('activate', () => self.clients.claim())

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Same NetworkFirst /api caching the old generateSW config had.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 300 })],
  })
)

// SPA fallback for navigations not otherwise precached — mirrors the old
// navigateFallback: 'index.html' + navigateFallbackDenylist: [/^\/api\//].
// Without the denylist, a top-level navigation to /api/... (window.open, an
// <a target="_blank"> document link) would get served cached index.html
// instead of the real file/response.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
  })
)

// ── Push notifications ──────────────────────────────────────────────────
// Managers/directors only for now (see server.js's pushToManagers) — the
// payload is always { title, body, url } JSON, set by that same function.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string } = {}
  try {
    if (event.data) data = event.data.json()
  } catch {
    // Non-JSON payload — fall back to defaults below rather than crash.
  }
  const title = data.title || 'GuardTec Compliance'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  )
})

// Clicking the notification focuses an already-open tab if there is one,
// otherwise opens a new one — same pattern as the in-app bell's
// goToNotification, just from outside the page entirely.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c && c.url.includes(url))
      if (existing && 'focus' in existing) return (existing as WindowClient).focus()
      return self.clients.openWindow(url)
    })
  )
})
