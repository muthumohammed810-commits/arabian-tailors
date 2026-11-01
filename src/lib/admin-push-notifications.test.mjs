import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeAdminPushRequest, createAdminFcmDeviceRecord, createAdminOrderFcmPayload, dispatchAdminOrderFcm,
  fcmDeviceId, getFirebaseWebConfiguration, isRetryableAdminPushRecord,
  normalizeFcmToken, parseFirebaseServiceAccount, persistOrderThenNotifyAdminPush,
  safeAdminDeviceName,
} from './admin-push-notifications.mjs';

const token = suffix => `fcm-device-registration-token-${suffix}-`.repeat(8);
const device = suffix => ({ id: fcmDeviceId(token(suffix)), token: token(suffix), deviceName: `Admin ${suffix}` });

test('validates FCM registration tokens and creates stable distinct per-device identifiers', () => {
  assert.equal(normalizeFcmToken(token('one')), token('one'));
  assert.equal(normalizeFcmToken('short'), null);
  assert.equal(normalizeFcmToken('x'.repeat(5000)), null);
  assert.notEqual(fcmDeviceId(token('one')), fcmDeviceId(token('two')));
  assert.equal(fcmDeviceId(token('one')), fcmDeviceId(token('one')));
});

test('records each device under the authenticated shared Admin account and preserves registration timestamps', () => {
  const registeredAt = '2026-10-30T00:00:00.000Z';
  const previous = { registeredAt: '2026-10-01T00:00:00.000Z' };
  const record = createAdminFcmDeviceRecord(token('new-device'), 'Android · Chrome', previous, registeredAt);
  assert.equal(record.adminAccount, 'shared-admin');
  assert.equal(record.id, fcmDeviceId(record.token));
  assert.equal(record.registeredAt, previous.registeredAt);
  assert.equal(record.lastSeenAt, registeredAt);
  assert.equal(createAdminFcmDeviceRecord('invalid-token', 'Device', null, registeredAt), null);
});

test('accepts only complete public Firebase configuration and valid VAPID key', () => {
  const env = { NEXT_PUBLIC_FIREBASE_API_KEY: 'key', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'shop.firebaseapp.com', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'shop-project', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789', NEXT_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:abcdef', NEXT_PUBLIC_FIREBASE_VAPID_KEY: 'A'.repeat(65) };
  assert.equal(getFirebaseWebConfiguration(env).projectId, 'shop-project');
  assert.equal(getFirebaseWebConfiguration({ ...env, NEXT_PUBLIC_FIREBASE_PROJECT_ID: '' }), null);
  assert.equal(getFirebaseWebConfiguration({ ...env, NEXT_PUBLIC_FIREBASE_VAPID_KEY: 'bad' }), null);
});

test('validates the service-account project and keeps its private fields server-only', () => {
  const service = { project_id: 'shop-project', client_email: 'push@shop-project.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----' };
  const parsed = parseFirebaseServiceAccount(JSON.stringify(service), 'shop-project');
  assert.equal(parsed.projectId, 'shop-project');
  assert.equal(parseFirebaseServiceAccount(JSON.stringify(service), 'other-project'), null);
  assert.equal(parseFirebaseServiceAccount('{bad json', 'shop-project'), null);
});

test('notification payload carries only order reference, safe text, and Admin target', () => {
  assert.deepEqual(createAdminOrderFcmPayload('AT-001025'), { data: { kind: 'new_order', title: 'ARABIAN TAILORS', body: 'New Order Received! Order #AT-001025 has been placed.', orderId: 'AT-001025', url: '/admin?orderId=AT-001025', tag: 'arabian-tailors-order-AT-001025' } });
  assert.throws(() => createAdminOrderFcmPayload('AT-001025\nprivate'));
  assert.equal(JSON.stringify(createAdminOrderFcmPayload('AT-001025')).includes('phone'), false);
});

test('rejects all push management actions unless the existing Admin session is authenticated', () => {
  assert.equal(authorizeAdminPushRequest(false), false);
  assert.equal(authorizeAdminPushRequest(undefined), false);
  assert.equal(authorizeAdminPushRequest(true), true);
});

test('fans out to multiple devices and suppresses duplicate order/device sends', async () => {
  const devices = [device('one'), device('two')];
  const claims = new Set(); const sent = []; const saved = [];
  const callbacks = {
    claimDelivery: async (orderId, id) => { const key = `${orderId}:${id}`; if (claims.has(key)) return false; claims.add(key); return true; },
    saveDelivery: async (orderId, id, state) => saved.push({ orderId, id, ...state }),
    send: async (target, payload) => sent.push({ target, payload }),
    removeDevice: async () => assert.fail('valid token should remain registered'),
    now: () => '2026-10-30T00:00:00.000Z',
  };
  assert.equal((await dispatchAdminOrderFcm({ orderId: 'AT-001025', devices, ...callbacks })).sent, 2);
  assert.equal(sent.length, 2);
  assert.equal(saved.every(item => item.status === 'sent'), true);
  assert.equal((await dispatchAdminOrderFcm({ orderId: 'AT-001025', devices, ...callbacks })).skipped, 2);
  assert.equal(sent.length, 2);
});

test('removes invalid FCM registration tokens after confirmed unregistered responses', async () => {
  const registered = device('expired'); const removed = []; const saved = [];
  const result = await dispatchAdminOrderFcm({ orderId: 'AT-001026', devices: [registered], claimDelivery: async () => true, saveDelivery: async (_orderId, id, state) => saved.push({ id, ...state }), send: async () => { throw Object.assign(new Error('private token omitted'), { code: 'messaging/registration-token-not-registered' }); }, removeDevice: async id => removed.push(id) });
  assert.equal(result.expired, 1);
  assert.deepEqual(removed, [registered.id]);
  assert.equal(saved[0].status, 'expired');
  assert.equal(JSON.stringify(saved).includes(registered.token), false);
});

test('does not allow automatic retry when FCM accepted a push but status persistence failed', async () => {
  const registered = device('accepted'); const states = []; let sends = 0;
  const result = await dispatchAdminOrderFcm({ orderId: 'AT-001027', devices: [registered], claimDelivery: async () => true, saveDelivery: async (_orderId, _id, state) => { if (state.status === 'sent') throw new Error('storage failed'); states.push(state); }, send: async () => { sends++; }, removeDevice: async () => assert.fail('device should remain') });
  assert.equal(sends, 1);
  assert.equal(result.unknown, 1);
  assert.equal(states[0].status, 'unknown');
  assert.equal(isRetryableAdminPushRecord(states[0]), false);
});

test('only clear confirmed send rejections are retryable', () => {
  assert.equal(isRetryableAdminPushRecord({ status: 'failed' }), true);
  for (const status of ['sending', 'sent', 'unknown', 'expired']) assert.equal(isRetryableAdminPushRecord({ status }), false);
  assert.equal(isRetryableAdminPushRecord(null), true);
});

test('notification failure cannot undo a saved order, while save failure prevents sending', async () => {
  const events = [];
  const saved = await persistOrderThenNotifyAdminPush({ id: 'AT-1027' }, { persist: async value => { events.push('persist'); return value; }, notify: async () => { events.push('notify'); throw new Error('FCM unavailable'); } });
  assert.equal(saved.id, 'AT-1027');
  assert.deepEqual(events, ['persist', 'notify']);
  let sent = false;
  await assert.rejects(persistOrderThenNotifyAdminPush({ id: 'AT-1028' }, { persist: async () => { throw new Error('storage failed'); }, notify: async () => { sent = true; } }));
  assert.equal(sent, false);
});

test('device label strips control characters and is bounded', () => {
  assert.equal(safeAdminDeviceName('Phone\n Admin'), 'Phone Admin');
  assert.equal(safeAdminDeviceName('x'.repeat(200)).length, 100);
});
