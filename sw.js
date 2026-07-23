/* 싸커피 서비스 워커 — 웹 푸시 수신 (2026-07) */
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch (err) { d = { title: '싸커피', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '싸커피', {
    body: d.body || '',
    icon: 'scf-icon-180.png',
    badge: 'scf-icon-180.png',
    data: { url: d.url || './member.html' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './member.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.includes('member.html') && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
