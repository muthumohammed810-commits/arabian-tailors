import { createHash } from 'node:crypto';

export const ADMIN_PUSH_DEVICE_PREFIX = 'arabian-tailors/admin-push/fcm-devices/';
export const ADMIN_PUSH_DELIVERY_PREFIX = 'arabian-tailors/admin-push/fcm-deliveries/';
export const ADMIN_PUSH_ACCOUNT_ID = 'shared-admin';

const safeOrderId = value => typeof value === 'string' && /^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(value);

export function normalizeFcmToken(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return token.length >= 100 && token.length <= 4096 && /^[A-Za-z0-9:_-]+$/.test(token) ? token : null;
}

export function fcmDeviceId(token) {
  const normalized = normalizeFcmToken(token);
  return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}

export function safeAdminDeviceName(value) {
  if (typeof value !== 'string') return 'Admin device';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Admin device';
}

export function createAdminFcmDeviceRecord(rawToken, rawDeviceName, existing, timestamp) {
  const token = normalizeFcmToken(rawToken);
  const id = token && fcmDeviceId(token);
  if (!token || !id || typeof timestamp !== 'string' || !timestamp) return null;
  return {
    id,
    token,
    deviceName: safeAdminDeviceName(rawDeviceName),
    adminAccount: ADMIN_PUSH_ACCOUNT_ID,
    registeredAt: typeof existing?.registeredAt === 'string' ? existing.registeredAt : timestamp,
    lastSeenAt: timestamp,
  };
}

export function getFirebaseWebConfiguration(env) {
  const keys = {
    apiKey: 'NEXT_PUBLIC_FIREBASE_API_KEY',
    authDomain: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    projectId: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    messagingSenderId: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'NEXT_PUBLIC_FIREBASE_APP_ID',
    vapidKey: 'NEXT_PUBLIC_FIREBASE_VAPID_KEY',
  };
  const config = Object.fromEntries(Object.entries(keys).map(([key, envKey]) => [key, typeof env?.[envKey] === 'string' ? env[envKey].trim() : '']));
  if (Object.values(config).some(value => !value) || !/^[A-Za-z0-9_-]{20,}$/.test(config.vapidKey)) return null;
  if (!/^[A-Za-z0-9-]+$/.test(config.projectId) || !/^\d+$/.test(config.messagingSenderId)) return null;
  return config;
}

export function parseFirebaseServiceAccount(raw, expectedProjectId) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 32_000) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.project_id !== 'string' || parsed.project_id !== expectedProjectId
      || typeof parsed.client_email !== 'string' || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(parsed.client_email)
      || typeof parsed.private_key !== 'string' || !parsed.private_key.includes('PRIVATE KEY')) return null;
    return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: parsed.private_key };
  } catch { return null; }
}

export function createAdminOrderFcmPayload(orderId) {
  if (!safeOrderId(orderId)) throw new TypeError('Invalid order reference.');
  return {
    data: {
      kind: 'new_order',
      title: 'ARABIAN TAILORS',
      body: `New Order Received! Order #${orderId} has been placed.`,
      orderId,
      url: `/admin?orderId=${encodeURIComponent(orderId)}`,
      tag: `arabian-tailors-order-${orderId}`,
    },
  };
}

export function authorizeAdminPushRequest(isAdminAuthenticated) {
  return isAdminAuthenticated === true;
}

export function isRetryableAdminPushStatus(status) { return status === 'failed'; }
export function isRetryableAdminPushRecord(record) { return record == null || isRetryableAdminPushStatus(record.status); }

function safeFcmError(error) {
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9_./-]{1,120}$/.test(error.code) ? error.code : undefined;
  return {
    code,
    invalidToken: code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token',
    rejected: code?.startsWith('messaging/'),
  };
}

/** Claim each device/order before sending. Unknown outcomes stay locked to prevent duplicate alerts. */
export async function dispatchAdminOrderFcm({ orderId, devices, claimDelivery, saveDelivery, send, removeDevice, now = () => new Date().toISOString(), concurrency = 20 }) {
  const payload = createAdminOrderFcmPayload(orderId);
  const result = { attempted: 0, sent: 0, failed: 0, unknown: 0, expired: 0, skipped: 0 };
  const entries = Array.isArray(devices) ? devices : [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < entries.length) {
      const device = entries[nextIndex++];
      const token = normalizeFcmToken(device?.token);
      const id = device?.id || fcmDeviceId(token);
      if (!token || !/^[a-f0-9]{64}$/.test(id || '')) { result.skipped++; continue; }
      let claimed = false;
      try { claimed = await claimDelivery(orderId, id); } catch { result.failed++; continue; }
      if (!claimed) { result.skipped++; continue; }
      result.attempted++;
      try {
        await send(token, payload);
        const sentAt = now();
        try {
          await saveDelivery(orderId, id, { status: 'sent', acceptedAt: sentAt, updatedAt: sentAt });
          result.sent++;
        } catch {
          await saveDelivery(orderId, id, { status: 'unknown', acceptedAt: sentAt, updatedAt: now(), errorCode: 'delivery_record_save_failed' }).catch(() => undefined);
          result.unknown++;
        }
      } catch (error) {
        const safe = safeFcmError(error);
        const status = safe.invalidToken ? 'expired' : safe.rejected ? 'failed' : 'unknown';
        const record = { status, updatedAt: now(), ...(safe.code ? { errorCode: safe.code } : {}) };
        await saveDelivery(orderId, id, record).catch(() => undefined);
        if (safe.invalidToken) {
          await removeDevice(id).catch(() => undefined);
          result.expired++;
        } else if (status === 'failed') result.failed++;
        else result.unknown++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), entries.length) }, () => worker()));
  return result;
}

export async function persistOrderThenNotifyAdminPush(order, { persist, notify }) {
  const saved = await persist(order);
  try { await notify(saved); } catch { /* A notification failure must never roll back a persisted order. */ }
  return saved;
}
