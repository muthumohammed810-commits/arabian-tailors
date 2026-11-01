'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Check, RefreshCw, Trash2 } from 'lucide-react';
import { disableAdminFcmToken, getAdminFcmToken, getAdminFirebaseMessaging, listenForAdminFcmMessages } from '@/lib/firebase-client';

type Device = { id: string; deviceName: string; registeredAt: string; lastSeenAt: string };
type State = { configured: boolean; storageConfigured: boolean; devices: Device[] };

async function responseJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (HTTP ${response.status}).`);
  return body;
}

function deviceName() {
  const ua = navigator.userAgent;
  const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Browser';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Browser';
  return `${platform} · ${browser}`;
}

function safeForegroundText(payload: { data?: Record<string, string> }) {
  const data = payload.data || {};
  const orderId = data.kind === 'new_order' && /^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(data.orderId || '') ? data.orderId : '';
  return { title: 'ARABIAN TAILORS', body: orderId ? `New Order Received! Order #${orderId} has been placed.` : 'Test notification. Push alerts are enabled on this device.', tag: orderId ? `arabian-tailors-order-${orderId}` : 'arabian-tailors-admin-test', data: { url: orderId ? `/admin?orderId=${encodeURIComponent(orderId)}` : '/admin' } };
}

export default function AdminPushNotifications() {
  const [state, setState] = useState<State>({ configured: false, storageConfigured: false, devices: [] });
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await responseJson(await fetch('/api/admin/push-notifications', { cache: 'no-store', credentials: 'same-origin' }));
      setState({ configured: result.configured === true, storageConfigured: result.storageConfigured === true, devices: Array.isArray(result.devices) ? result.devices : [] });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (registration) {
          const { token } = await getAdminFcmToken(registration);
          const status = await responseJson(await fetch('/api/admin/push-notifications', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', token }) }));
          setCurrentDeviceId(typeof status.id === 'string' ? status.id : '');
        }
      }
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load notification settings.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = async () => {
    setBusy('enable'); setMessage(null);
    try {
      if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('This browser does not support Firebase web notifications. Try current Chrome, Edge, Firefox or Safari.');
      if (!window.isSecureContext) throw new Error('Notifications require HTTPS. Open the secure Arabian Tailors website.');
      if (!state.configured || !state.storageConfigured) throw new Error('Firebase Messaging or persistent storage is not configured. Ask the site owner to finish the Firebase and Blob setup.');
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted. Allow notifications in this browser’s site settings, then try again.');
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const { token } = await getAdminFcmToken(registration);
      if (!token) throw new Error('Firebase did not return a registration token for this device. Check Firebase Web Push setup and try again.');
      const saved = await responseJson(await fetch('/api/admin/push-notifications', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register', token, deviceName: deviceName() }) }));
      setCurrentDeviceId(saved.device?.id || '');
      await refresh();
      setMessage({ kind: 'success', text: 'Firebase notifications are enabled and this device is registered.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not enable notifications on this device.' });
    } finally { setBusy(''); }
  };

  const testDevice = async (id: string) => {
    setBusy(`test:${id}`); setMessage(null);
    try {
      await responseJson(await fetch('/api/admin/push-notifications', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) }));
      setMessage({ kind: 'success', text: 'Firebase accepted a test notification for this device.' });
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Test notification failed.' }); }
    finally { setBusy(''); }
  };

  const removeDevice = async (id: string) => {
    if (!window.confirm('Remove this Admin device from push notifications?')) return;
    setBusy(`remove:${id}`); setMessage(null);
    try {
      await responseJson(await fetch('/api/admin/push-notifications', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }));
      if (id === currentDeviceId) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (registration) { const { messaging } = await getAdminFcmToken(registration); await disableAdminFcmToken(messaging); }
        setCurrentDeviceId('');
      }
      await refresh();
      setMessage({ kind: 'success', text: 'Device registration removed.' });
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not remove this device.' }); }
    finally { setBusy(''); }
  };

  const disableThisDevice = async () => {
    setBusy('disable'); setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration) throw new Error('This device has no Firebase Messaging registration.');
      const { messaging, token } = await getAdminFcmToken(registration);
      await responseJson(await fetch('/api/admin/push-notifications', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }));
      await disableAdminFcmToken(messaging);
      setCurrentDeviceId('');
      await refresh();
      setMessage({ kind: 'success', text: 'Notifications are disabled on this device.' });
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not disable notifications on this device.' }); }
    finally { setBusy(''); }
  };

  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'Notification' in window;

  return <article className="panel admin-push-panel">
    <div className="panel-heading orders-heading"><div><span className="panel-overline">ADMIN DEVICE ALERTS</span><h3>Push Notifications</h3><p className="subtle">Each Admin device registers separately with Firebase. Alerts are sent only after an order is saved.</p></div><button type="button" className="admin-btn secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/> Refresh</button></div>
    {!state.configured && <p className="admin-push-note" role="status">Firebase Cloud Messaging is not fully configured. Device registration is unavailable until the owner configures Firebase Web settings and the server service account.</p>}
    {!state.storageConfigured && <p className="admin-push-note is-error" role="status">Persistent Vercel Blob storage is unavailable; device tokens cannot be saved safely.</p>}
    {typeof Notification !== 'undefined' && Notification.permission === 'denied' && <p className="admin-push-note is-error">Notifications are blocked in this browser. Change the site permission in browser settings before enabling.</p>}
    {!supported && <p className="admin-push-note">This browser does not support the service workers and notifications needed for background alerts.</p>}
    <div className="admin-push-actions"><button type="button" className="admin-btn primary" onClick={() => void enable()} disabled={busy !== '' || loading || !supported}><BellRing size={15}/>{busy === 'enable' ? 'Enabling…' : 'Enable notifications on this device'}</button>{currentDeviceId && <button type="button" className="admin-btn secondary" onClick={() => void disableThisDevice()} disabled={busy !== ''}>{busy === 'disable' ? 'Disabling…' : 'Disable this device'}</button>}<span>Permission is requested only after you press Enable.</span></div>
    {message && <p className={`admin-push-message is-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.kind === 'success' && <Check size={14}/>} {message.text}</p>}
    <section className="admin-push-device-list"><div className="admin-push-list-head"><h4>Registered Admin devices</h4><span>{state.devices.length}</span></div>
      {loading ? <p className="subtle">Loading registered devices…</p> : state.devices.length ? state.devices.map(device => <article className="admin-push-device" key={device.id}><div><b>{device.deviceName}{device.id === currentDeviceId ? ' · This device' : ''}</b><small>Registered {new Date(device.registeredAt).toLocaleString()}</small><small>Last refreshed {new Date(device.lastSeenAt).toLocaleString()}</small></div><div className="row-actions"><button type="button" className="admin-btn secondary" onClick={() => void testDevice(device.id)} disabled={busy !== ''}>{busy === `test:${device.id}` ? 'Sending…' : 'Send test'}</button><button type="button" className="icon-danger" aria-label={`Remove ${device.deviceName}`} onClick={() => void removeDevice(device.id)} disabled={busy !== ''}><Trash2 size={14}/></button></div></article>) : <p className="empty-state">No devices registered. Enable notifications from each Admin device you want to receive alerts on.</p>}
    </section>
    <p className="admin-push-footnote">Push alerts follow the browser and OS notification settings. On iPhone/iPad, install the site to the Home Screen and open the installed web app; availability depends on the OS version and settings.</p>
  </article>;
}

export function AdminFcmForegroundListener() {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void getAdminFirebaseMessaging().then(messaging => {
      if (!messaging || cancelled) return;
      unsubscribe = listenForAdminFcmMessages(messaging, payload => {
        if (Notification.permission !== 'granted') return;
        const notice = safeForegroundText(payload);
        void navigator.serviceWorker.ready.then(registration => registration.showNotification(notice.title, { body: notice.body, tag: notice.tag, icon: '/icons/arabian-tailors.svg', badge: '/icons/arabian-tailors.svg', data: notice.data }));
      });
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  return null;
}

type Delivery = { id: string; deviceName: string; status: string; acceptedAt?: string; updatedAt?: string; errorCode?: string };

export function AdminPushOrderStatus({ orderId }: { orderId: string }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await responseJson(await fetch(`/api/admin/push-notifications?orderId=${encodeURIComponent(orderId)}`, { cache: 'no-store', credentials: 'same-origin' })); setDeliveries(Array.isArray(result.deliveries) ? result.deliveries : []); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load FCM delivery status.'); }
    finally { setLoading(false); }
  }, [orderId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const retry = async (id: string) => {
    setBusy(id); setError('');
    try { await responseJson(await fetch('/api/admin/push-notifications', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry', orderId, id }) })); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not retry FCM delivery.'); await refresh(); }
    finally { setBusy(''); }
  };
  return <section className="order-whatsapp-notifications admin-order-push-status"><span className="panel-overline">ADMIN DEVICE ALERTS</span><h3>Push notifications</h3><p className="subtle">“Accepted” means Firebase accepted the message for delivery; actual display depends on device and browser settings.</p>
    {error && <p className="admin-push-message is-error" role="alert">{error}</p>}
    {loading ? <small className="subtle">Loading delivery status…</small> : deliveries.length ? deliveries.map(item => <article className="order-whatsapp-row" key={item.id}><div><b>{item.deviceName}</b><span className={`status-pill status-${item.status}`}>{item.status}</span><small>{item.acceptedAt ? `Accepted ${new Date(item.acceptedAt).toLocaleString()}` : item.updatedAt ? `Updated ${new Date(item.updatedAt).toLocaleString()}` : ''}{item.errorCode ? ` · ${item.errorCode}` : ''}</small>{item.status === 'unknown' && <small>Outcome is unknown; retry is withheld to avoid duplicate alerts.</small>}</div>{['failed', 'pending'].includes(item.status) && <button type="button" className="admin-btn secondary" disabled={busy !== ''} onClick={() => void retry(item.id)}>{busy === item.id ? 'Sending…' : item.status === 'pending' ? 'Send notification' : 'Retry notification'}</button>}</article>) : <small className="subtle">No FCM send attempt is recorded. Devices may not have been registered when this order was placed.</small>}
  </section>;
}
