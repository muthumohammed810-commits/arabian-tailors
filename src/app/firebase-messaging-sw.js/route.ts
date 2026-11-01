import { NextResponse } from 'next/server';
import { getFirebaseWebConfiguration } from '@/lib/admin-push-notifications.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getFirebaseWebConfiguration(process.env);
  if (!config) return new NextResponse('// Firebase Messaging is not configured.', { status: 503, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
  const firebaseAppConfig = { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, messagingSenderId: config.messagingSenderId, appId: config.appId };
  const script = `
    self.addEventListener('notificationclick', function(event) {
      event.notification.close();
      var requested = event.notification && event.notification.data && event.notification.data.url;
      var target = typeof requested === 'string' && /^\\/admin(?:[?#]|$)/.test(requested) ? requested : '/admin';
      var absolute = new URL(target, self.location.origin).href;
      event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windows) {
        for (var i = 0; i < windows.length; i++) {
          var client = windows[i];
          var currentUrl = new URL(client.url);
          if (currentUrl.origin === self.location.origin && currentUrl.pathname.startsWith('/admin') && 'focus' in client) {
            if ('navigate' in client) return client.navigate(absolute).then(function() { return client.focus(); });
            return client.focus();
          }
        }
        return self.clients.openWindow(absolute);
      }));
    });
    importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js');
    firebase.initializeApp(${JSON.stringify(firebaseAppConfig)});
    var messaging = firebase.messaging();
    messaging.onBackgroundMessage(function(payload) {
      var data = payload && payload.data ? payload.data : {};
      var orderId = typeof data.orderId === 'string' && /^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(data.orderId) ? data.orderId : '';
      var title = data.kind === 'test' ? 'ARABIAN TAILORS' : 'ARABIAN TAILORS';
      var body = orderId ? 'New Order Received! Order #' + orderId + ' has been placed.' : 'Test notification. Push alerts are enabled on this device.';
      return self.registration.showNotification(title, {
        body: body,
        icon: '/icons/arabian-tailors.svg',
        badge: '/icons/arabian-tailors.svg',
        tag: orderId ? 'arabian-tailors-order-' + orderId : 'arabian-tailors-admin-test',
        data: { url: orderId ? '/admin?orderId=' + encodeURIComponent(orderId) : '/admin' }
      });
    });
  `;
  return new NextResponse(script, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Service-Worker-Allowed': '/' } });
}
