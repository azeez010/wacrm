// OgaDesk service worker: only shows Web Push notifications and routes clicks.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_) {
    data = { title: 'OgaDesk', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'OgaDesk'
  event.waitUntil(
    (async () => {
      // Chromium lets us stay silent while the app is open and focused; Safari and
      // Firefox require a banner for every push, so they always get one.
      if (/Chrome\//.test(self.navigator.userAgent)) {
        const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        if (open.some((c) => c.visibilityState === 'visible' && c.focused)) return
      }
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        icon: '/android-chrome-192x192.png',
        badge: '/favicon-96x96.png',
        data: { url: data.url || '/inbox' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/inbox', self.location.origin).href
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of open) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus()
          if ('navigate' in c) await c.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
