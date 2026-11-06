import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { authorizeAdminPushRequest } from '@/lib/admin-push-notifications.mjs';
import { isSharedBlobConfigured } from '@/lib/shared-blob-storage.mjs';
import {
  deleteAdminFcmDevice,
  deleteAdminFcmDeviceByToken,
  getAdminFcmDeviceStatus,
  getAdminFcmConfiguration,
  listAdminFcmDevices,
  listAdminPushOrderStatuses,
  saveAdminFcmToken,
  sendAdminFcmTest,
  retryFailedAdminOrderPush,
} from '@/lib/admin-push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const noStore = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });

async function authorized() {
  return authorizeAdminPushRequest(await isAdminAuthenticated());
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function readJson(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) return { tooLarge: true as const };
  try { return { body: JSON.parse(text) as Record<string, unknown> }; } catch { return { body: null }; }
}

export async function GET(request: Request) {
  if (!await authorized()) return json({ error: 'Sign in required.' }, 401);
  if (!isSharedBlobConfigured(process.env)) return json({ configured: false, storageConfigured: false, devices: [] });
  try {
    const orderId = new URL(request.url).searchParams.get('orderId');
    if (orderId !== null) {
      if (!/^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(orderId)) return json({ error: 'Invalid order reference.' }, 400);
      return json({ deliveries: await listAdminPushOrderStatuses(orderId) });
    }
    const [devices, configuration] = await Promise.all([listAdminFcmDevices(), getAdminFcmConfiguration()]);
    return json({ configured: configuration.configured, storageConfigured: configuration.storageConfigured, devices });
  } catch (error) {
    const details = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : {};
    const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
    console.error('[admin-push] Could not list device registrations', { errorName: safe(details.name), errorCode: safe(details.code) });
    return json({ error: 'Could not load notification devices.' }, 503);
  }
}

export async function POST(request: Request) {
  if (!await authorized()) return json({ error: 'Sign in required.' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Request origin could not be verified.' }, 403);
  if (!isSharedBlobConfigured(process.env)) return json({ error: 'Persistent notification storage is not configured.' }, 503);
  const parsed = await readJson(request);
  if ('tooLarge' in parsed) return json({ error: 'Notification request is too large.' }, 413);
  const body = parsed.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);

  if (body.action === 'register') {
    const result = await saveAdminFcmToken(body.token, body.deviceName);
    return result.ok ? json({ ok: true, device: result.device }, result.created ? 201 : 200) : json({ error: result.error }, 400);
  }
  if (body.action === 'status') {
    if (typeof body.token !== 'string') return json({ error: 'The current device token is required.' }, 400);
    return json(await getAdminFcmDeviceStatus(body.token));
  }
  if (body.action === 'test') {
    if (typeof body.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id)) return json({ error: 'Choose a valid registered device.' }, 400);
    const result = await sendAdminFcmTest(body.id);
    return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
  }
  if (body.action === 'retry') {
    if (typeof body.orderId !== 'string' || !/^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(body.orderId) || typeof body.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id)) return json({ error: 'Choose a valid order and registered device.' }, 400);
    const result = await retryFailedAdminOrderPush(body.orderId, body.id).catch(() => ({ ok: false as const, status: 503, error: 'Could not retry this notification safely.' }));
    return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
  }
  return json({ error: 'Choose a valid notification action.' }, 400);
}

export async function DELETE(request: Request) {
  if (!await authorized()) return json({ error: 'Sign in required.' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Request origin could not be verified.' }, 403);
  if (!isSharedBlobConfigured(process.env)) return json({ error: 'Persistent notification storage is not configured.' }, 503);
  const parsed = await readJson(request);
  if ('tooLarge' in parsed) return json({ error: 'Notification request is too large.' }, 413);
  const token = parsed.body?.token;
  const id = parsed.body?.id;
  const result = typeof token === 'string'
    ? await deleteAdminFcmDeviceByToken(token)
    : typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)
      ? await deleteAdminFcmDevice(id)
      : null;
  if (!result) return json({ error: 'Choose a valid registered device.' }, 400);
  return result.ok ? json({ ok: true }) : json({ error: result.error }, 503);
}
