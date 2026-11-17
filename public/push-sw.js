/* Veil Lock-Aware High-Priority Web Push Service Worker Script */

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Internet Edge',
    body: 'New encrypted activity · Open & unlock to view',
    tag: 'veil-private-alert',
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: parsed.title || payload.title,
          body: parsed.body || payload.body,
          tag: parsed.tag || payload.tag,
        };
      }
    }
  } catch {
    // Fallback to discreet zero-leakage alert
  }

  // Zero-leakage notification: never reveals message content, sender, or space name
  // on lock screen or notification tray. Requires opening & unlocking the app to read.
  const options = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [240, 100, 240, 100, 240],
    data: {
      url: '/',
      receivedAt: Date.now(),
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({ type: 'notification:opened' });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
        return undefined;
      })
  );
});
