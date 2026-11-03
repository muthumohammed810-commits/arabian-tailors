import { blobDel as del, blobGet as get, blobList as list, blobPut as put, isBlobStoreConfigured } from '@/lib/blob-auth.mjs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import {
  ADMIN_PUSH_ACCOUNT_ID, ADMIN_PUSH_DELIVERY_PREFIX, ADMIN_PUSH_DEVICE_PREFIX,
  createAdminFcmDeviceRecord, createAdminOrderFcmPayload, dispatchAdminOrderFcm, fcmDeviceId,
  getFirebaseWebConfiguration, isRetryableAdminPushRecord, normalizeFcmToken,
  parseFirebaseServiceAccount, safeAdminDeviceName,
} from '@/lib/admin-push-notifications.mjs';

type DeviceRecord = { id: string; token: string; deviceName: string; adminAccount: string; registeredAt: string; lastSeenAt: string };
const devicePath = (id: string) => `${ADMIN_PUSH_DEVICE_PREFIX}${id}.json`;
const deliveryPath = (orderId: string, id: string) => `${ADMIN_PUSH_DELIVERY_PREFIX}${orderId}/${id}.json`;
const retryLockPath = (orderId: string, id: string) => `${ADMIN_PUSH_DELIVERY_PREFIX}${orderId}/${id}.retry-lock.json`;
const safeId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(value) ? value : undefined;

async function readPrivateUrl(url: string): Promise<any | null> {
  const response = await get(url, { access: 'private', useCache: false });
  if (response?.statusCode !== 200) return null;
  try { return await new Response(response.stream).json(); } catch { return null; }
}

async function privateRecord(pathname: string): Promise<any | null> {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const blob = blobs.find(item => item.pathname === pathname);
  return blob ? readPrivateUrl(blob.url) : null;
}

async function allDevices(): Promise<DeviceRecord[]> {
  const output: DeviceRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: ADMIN_PUSH_DEVICE_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    const records = await Promise.all(page.blobs.map(async blob => ({ blob, value: await readPrivateUrl(blob.url) })));
    for (const { blob, value } of records) {
      if (value?.id && value.adminAccount === ADMIN_PUSH_ACCOUNT_ID && normalizeFcmToken(value.token) && fcmDeviceId(value.token) === value.id) {
        output.push({ id: value.id, token: value.token, adminAccount: ADMIN_PUSH_ACCOUNT_ID, deviceName: safeAdminDeviceName(value.deviceName), registeredAt: typeof value.registeredAt === 'string' ? value.registeredAt : blob.uploadedAt.toISOString(), lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : blob.uploadedAt.toISOString() });
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return output;
}

async function removeStoredDevice(id: string) {
  const path = devicePath(id);
  const { blobs } = await list({ prefix: path, limit: 1 });
  const blob = blobs.find(item => item.pathname === path);
  if (blob) await del(blob.url);
}

function firebaseApp(): App | null {
  const webConfig = getFirebaseWebConfiguration(process.env);
  const serviceAccount = parseFirebaseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, webConfig?.projectId);
  if (!webConfig || !serviceAccount || !isBlobStoreConfigured('shared')) return null;
  const existing = getApps().find(app => app.name === 'arabian-tailors-fcm');
  if (existing) return existing;
  return initializeApp({ credential: cert({ projectId: serviceAccount.projectId, clientEmail: serviceAccount.clientEmail, privateKey: serviceAccount.privateKey }) }, 'arabian-tailors-fcm');
}

function sendFcm(token: string, data: Record<string, string>) {
  const app = firebaseApp();
  if (!app) throw Object.assign(new Error('FCM is not configured.'), { code: 'app/not-configured' });
  return getMessaging(app).send({ token, data, webpush: { headers: { TTL: '60' } } });
}

export async function getAdminFcmConfiguration() {
  return { configured: Boolean(firebaseApp()), storageConfigured: isBlobStoreConfigured('shared') };
}

export async function listAdminFcmDevices() {
  return (await allDevices()).map(({ id, deviceName, registeredAt, lastSeenAt }) => ({ id, deviceName, registeredAt, lastSeenAt }));
}

export async function getAdminFcmDeviceStatus(rawToken: unknown) {
  const token = normalizeFcmToken(rawToken);
  const id = token && fcmDeviceId(token);
  if (!id) return { registered: false, id: null };
  const record = await privateRecord(devicePath(id));
  return { registered: Boolean(record && record.adminAccount === ADMIN_PUSH_ACCOUNT_ID && record.id === id), id: record?.id === id ? id : null };
}

export async function saveAdminFcmToken(rawToken: unknown, rawDeviceName: unknown) {
  const token = normalizeFcmToken(rawToken);
  if (!token) return { ok: false as const, error: 'The Firebase registration token is invalid. Enable notifications again on this device.' };
  const id = fcmDeviceId(token);
  if (!id) return { ok: false as const, error: 'Could not identify this device registration.' };
  if (!firebaseApp()) return { ok: false as const, error: 'Firebase messaging is not configured on the server.' };
  try {
    const existing = await privateRecord(devicePath(id));
    const timestamp = new Date().toISOString();
    const record = createAdminFcmDeviceRecord(token, rawDeviceName, existing, timestamp);
    if (!record) return { ok: false as const, error: 'The Firebase registration token is invalid.' };
    await put(devicePath(id), JSON.stringify(record), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    return { ok: true as const, created: !existing, device: { id, deviceName: record.deviceName, registeredAt: record.registeredAt, lastSeenAt: record.lastSeenAt } };
  } catch (error) {
    console.error('[admin-fcm] Token registration save failed', { deviceId: id, errorName: safeId((error as any)?.name), errorCode: safeId((error as any)?.code) });
    return { ok: false as const, error: 'Could not save this device registration. Try again.' };
  }
}

export async function deleteAdminFcmDevice(id: string) {
  try { await removeStoredDevice(id); return { ok: true as const }; }
  catch (error) { console.error('[admin-fcm] Device removal failed', { deviceId: id, errorName: safeId((error as any)?.name), errorCode: safeId((error as any)?.code) }); return { ok: false as const, error: 'Could not remove this device registration.' }; }
}

export async function deleteAdminFcmDeviceByToken(rawToken: unknown) {
  const token = normalizeFcmToken(rawToken);
  const id = token && fcmDeviceId(token);
  return id ? deleteAdminFcmDevice(id) : { ok: false as const, error: 'The current device registration could not be identified.' };
}

export async function sendAdminFcmTest(id: string) {
  const device = await privateRecord(devicePath(id));
  if (!device || device.adminAccount !== ADMIN_PUSH_ACCOUNT_ID || fcmDeviceId(device.token) !== id) return { ok: false as const, status: 404, error: 'This device registration no longer exists.' };
  try {
    await sendFcm(device.token, { kind: 'test', title: 'ARABIAN TAILORS', body: 'Test notification. Push alerts are enabled on this device.', url: '/admin', tag: `admin-push-test-${id.slice(0, 12)}` });
    return { ok: true as const };
  } catch (error) {
    const code = safeId((error as any)?.code);
    console.error('[admin-fcm] Test notification failed', { deviceId: id, errorCode: code });
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') { await removeStoredDevice(id).catch(() => undefined); return { ok: false as const, status: 410, error: 'The Firebase registration expired. Remove it and enable notifications again.' }; }
    return { ok: false as const, status: 502, error: 'Firebase did not accept the test notification. Check this device’s notification permission and Firebase configuration.' };
  }
}

export async function listAdminPushOrderStatuses(orderId: string) {
  const order = await privateRecord(`arabian-tailors/orders/${orderId}.json`);
  if (!order || order.id !== orderId) return [];
  const prefix = `${ADMIN_PUSH_DELIVERY_PREFIX}${orderId}/`;
  const [{ blobs }, devices] = await Promise.all([list({ prefix, limit: 1000 }), allDevices()]);
  const output: Array<{ id: string; deviceName: string; status: string; updatedAt?: string; acceptedAt?: string; errorCode?: string }> = [];
  const seen = new Set<string>();
  for (const blob of blobs) {
    if (blob.pathname.endsWith('.retry-lock.json')) continue;
    const id = blob.pathname.slice(prefix.length).replace(/\.json$/, '');
    if (!/^[a-f0-9]{64}$/.test(id)) continue;
    const record = await privateRecord(blob.pathname);
    if (!record || !['sending', 'sent', 'failed', 'unknown', 'expired', 'skipped'].includes(record.status)) continue;
    seen.add(id);
    output.push({ id, deviceName: safeAdminDeviceName(record.deviceName), status: record.status, ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}), ...(typeof record.acceptedAt === 'string' ? { acceptedAt: record.acceptedAt } : {}), ...(typeof record.errorCode === 'string' ? { errorCode: record.errorCode } : {}) });
  }
  for (const item of devices) if (!seen.has(item.id)) output.push({ id: item.id, deviceName: item.deviceName, status: 'pending' });
  return output;
}

export async function retryFailedAdminOrderPush(orderId: string, id: string) {
  const app = firebaseApp();
  if (!app) return { ok: false as const, status: 503, error: 'Firebase messaging is not configured yet.' };
  const order = await privateRecord(`arabian-tailors/orders/${orderId}.json`);
  if (!order || order.id !== orderId) return { ok: false as const, status: 404, error: 'The saved order could not be found.' };
  const existing = await privateRecord(deliveryPath(orderId, id));
  if (!isRetryableAdminPushRecord(existing)) return { ok: false as const, status: 409, error: 'Only a confirmed failed or not-yet-attempted delivery can be retried. Unknown outcomes are not retried to avoid duplicate alerts.' };
  const device = await privateRecord(devicePath(id));
  if (!device || device.adminAccount !== ADMIN_PUSH_ACCOUNT_ID || fcmDeviceId(device.token) !== id) return { ok: false as const, status: 410, error: 'This device registration expired or was removed.' };
  const lockPath = retryLockPath(orderId, id);
  const found = await list({ prefix: lockPath, limit: 1 });
  if (found.blobs.some(blob => blob.pathname === lockPath)) return { ok: false as const, status: 409, error: 'A retry is already in progress or has an unknown outcome.' };
  try { await put(lockPath, JSON.stringify({ createdAt: new Date().toISOString() }), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' }); }
  catch { return { ok: false as const, status: 409, error: 'A retry is already in progress. Refresh its status before trying again.' }; }
  try {
    await sendFcm(device.token, createAdminOrderFcmPayload(orderId).data);
  } catch (error) {
    const code = safeId((error as any)?.code);
    const expired = code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
    const rejected = code?.startsWith('messaging/');
    const status = expired ? 'expired' : rejected ? 'failed' : 'unknown';
    await put(deliveryPath(orderId, id), JSON.stringify({ status, deviceName: safeAdminDeviceName(device.deviceName), updatedAt: new Date().toISOString(), ...(code ? { errorCode: code } : {}), retried: true }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }).catch(() => undefined);
    if (expired) await removeStoredDevice(id).catch(() => undefined);
    if (status !== 'unknown') await removeRetryLock(lockPath).catch(() => undefined);
    return { ok: false as const, status: expired ? 410 : rejected ? 502 : 504, error: expired ? 'The Firebase token expired. Enable notifications again.' : rejected ? 'Firebase rejected this retry.' : 'Delivery outcome is unknown; it will not be retried to avoid duplicates.' };
  }
  const acceptedAt = new Date().toISOString();
  try {
    await put(deliveryPath(orderId, id), JSON.stringify({ status: 'sent', deviceName: safeAdminDeviceName(device.deviceName), acceptedAt, updatedAt: acceptedAt, retried: true }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    await removeRetryLock(lockPath);
    return { ok: true as const };
  } catch (error) {
    console.error('[admin-fcm] Accepted retry status could not be saved', { orderId, deviceId: id, errorName: safeId((error as any)?.name), errorCode: safeId((error as any)?.code) });
    await put(deliveryPath(orderId, id), JSON.stringify({ status: 'unknown', deviceName: safeAdminDeviceName(device.deviceName), acceptedAt, updatedAt: new Date().toISOString(), errorCode: 'delivery_record_save_failed', retried: true }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }).catch(() => undefined);
    return { ok: false as const, status: 503, error: 'Firebase accepted the alert, but the delivery record could not be confirmed. It will not be retried to avoid duplicates.' };
  }
}

async function removeRetryLock(pathname: string) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const blob = blobs.find(item => item.pathname === pathname);
  if (blob) await del(blob.url);
}

export async function notifyAdminDevicesOfOrder(orderId: string) {
  try {
    if (!firebaseApp()) return { attempted: 0, sent: 0, skipped: 0 };
    const devices = await allDevices();
    return await dispatchAdminOrderFcm({ orderId, devices,
      claimDelivery: async (order: string, deviceId: string) => {
        const path = deliveryPath(order, deviceId);
        try { await put(path, JSON.stringify({ status: 'sending', deviceName: devices.find(item => item.id === deviceId)?.deviceName || 'Admin device', claimedAt: new Date().toISOString() }), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' }); return true; }
        catch (error) { const code = safeId((error as any)?.code); const status = Number((error as any)?.statusCode); if (status === 409 || status === 412 || code === 'BLOB_ALREADY_EXISTS') return false; throw error; }
      },
      saveDelivery: async (order: string, deviceId: string, value: Record<string, unknown>) => { const device = devices.find(item => item.id === deviceId); await put(deliveryPath(order, deviceId), JSON.stringify({ ...value, deviceName: device?.deviceName || 'Admin device' }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }); },
      send: (token: string, payload: { data: Record<string, string> }) => sendFcm(token, payload.data),
      removeDevice: removeStoredDevice,
      concurrency: 20,
    });
  } catch (error) {
    console.error('[admin-fcm] Order notification fanout failed', { orderId, errorName: safeId((error as any)?.name), errorCode: safeId((error as any)?.code) });
    return { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }
}
