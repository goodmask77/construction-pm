// GD /prep 推播 Service Worker（v4.33.0 張良：點通知直接打開主畫面GD+本人身分）
// 放根目錄＝scope 蓋到 /prep（/ops/ 下的 scope 蓋不到 rewrite 後的 /prep 網址）
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()) })

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data.json() } catch (_) { d = { body: e.data ? e.data.text() : '' } }
  const jobs = [self.registration.showNotification(d.title || 'GD', {
    body: d.body || '',
    icon: '/ops/icon-192.png?v=2',
    badge: '/ops/icon-192.png?v=2',
    data: { url: d.url || '/prep' }
  })]
  // v4.33.2 圖示紅點數字（張良：要像一般app顯示1234）：payload 帶 badge=未簽收數 → setAppBadge
  if (d.badge != null && 'setAppBadge' in navigator) jobs.push(navigator.setAppBadge(Number(d.badge) || 0).catch(() => {}))
  e.waitUntil(Promise.all(jobs))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data || {}).url || '/prep'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) {
      if (w.url.includes('/prep')) { try { w.navigate(url) } catch (_) {} return w.focus() }
    }
    return self.clients.openWindow(url)
  }))
})
