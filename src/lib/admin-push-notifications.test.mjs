import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeAdminPushRequest, createAdminFcmDeviceRecord, createAdminOrderFcmPayload, dispatchAdminOrderFcm,
  fcmDeviceId, getFirebaseWebConfiguration, isRetryableAdminPushRecord,
  normalizeFcmToken, persistOrderThenNotifyAdminPush,
  safeAdminDeviceName,
} from './admin-push-notifications.mjs';
import {
  createFirebaseExternalAccountOptions, createFirebaseWifCredential, diagnoseFirebaseWifAuthentication,
  getFirebaseWifConfiguration, initializeFirebaseWifApp,
} from './firebase-wif.mjs';

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

const wifEnv = {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'arabian-tailors',
  GCP_PROJECT_ID: 'arabian-tailors',
  GCP_PROJECT_NUMBER: '735989185164',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'arabian-tailors',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel-production',
  GCP_SERVICE_ACCOUNT_EMAIL: 'arabian-tailors-fcm@arabian-tailors.iam.gserviceaccount.com',
};

test('validates non-secret Workload Identity configuration against the Firebase project', () => {
  assert.deepEqual(getFirebaseWifConfiguration(wifEnv), {
    projectId: 'arabian-tailors', projectNumber: '735989185164', poolId: 'arabian-tailors',
    providerId: 'vercel-production', serviceAccountEmail: 'arabian-tailors-fcm@arabian-tailors.iam.gserviceaccount.com',
    teamSlug: 'muthumohammed810-5526s-projects', projectSlug: 'arabian-tailors',
  });
  assert.equal(getFirebaseWifConfiguration({ ...wifEnv, GCP_PROJECT_ID: 'different-project' }), null);
  assert.equal(getFirebaseWifConfiguration({ ...wifEnv, GCP_PROJECT_NUMBER: 'not-a-number' }), null);
  assert.equal(getFirebaseWifConfiguration({ ...wifEnv, GCP_SERVICE_ACCOUNT_EMAIL: 'wrong@example.com' }), null);
  assert.equal(getFirebaseWifConfiguration({ ...wifEnv, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: '' }), null);
});

test('builds Google external-account configuration with Vercel subject-token supplier and service-account impersonation', async () => {
  const suppliedToken = 'opaque-oidc-token'.repeat(10);
  const options = createFirebaseExternalAccountOptions(getFirebaseWifConfiguration(wifEnv), async () => suppliedToken);
  assert.equal(options.type, 'external_account');
  assert.equal(options.audience, '//iam.googleapis.com/projects/735989185164/locations/global/workloadIdentityPools/arabian-tailors/providers/vercel-production');
  assert.equal(options.subject_token_type, 'urn:ietf:params:oauth:token-type:jwt');
  assert.equal(options.token_url, 'https://sts.googleapis.com/v1/token');
  assert.equal(options.service_account_impersonation_url, 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/arabian-tailors-fcm@arabian-tailors.iam.gserviceaccount.com:generateAccessToken');
  assert.equal(await options.subject_token_supplier.getSubjectToken(), suppliedToken);
});

test('initializes Firebase Admin lazily with mocked Vercel OIDC and Google external-account client', async () => {
  const seen = { subjectOptions: null, clientOptions: null, authClient: null, appOptions: null, tokenCalls: 0 };
  const fakeApp = { name: 'arabian-tailors-fcm' };
  class MockExternalAccountClient {
    static fromJSON(options) {
      seen.clientOptions = options;
      seen.authClient = {
        credentials: { expiry_date: Date.now() + 3_600_000 },
        async getAccessToken() {
          seen.tokenCalls++;
          const subjectToken = await options.subject_token_supplier.getSubjectToken();
          assert.equal(subjectToken, 'mock-vercel-oidc-token'.repeat(10));
          this.credentials.access_token = 'mock-short-lived-google-access-token';
          return { token: this.credentials.access_token };
        },
      };
      return seen.authClient;
    }
  }
  const app = initializeFirebaseWifApp({
    env: wifEnv,
    getSubjectToken: async options => { seen.subjectOptions = options; return 'mock-vercel-oidc-token'.repeat(10); },
    ExternalAccountClient: MockExternalAccountClient,
    getApps: () => [],
    initializeApp: (options, name) => { seen.appOptions = options; return { ...fakeApp, name }; },
  });
  assert.equal(app.name, 'arabian-tailors-fcm-wif');
  assert.equal(seen.tokenCalls, 0, 'initialization must not exchange a token until Firebase needs one');
  assert.equal(seen.appOptions.projectId, 'arabian-tailors');
  const access = await seen.appOptions.credential.getAccessToken();
  assert.equal(access.access_token, 'mock-short-lived-google-access-token');
  assert.ok(access.expires_in > 0);
  assert.deepEqual(seen.authClient.scopes, ['https://www.googleapis.com/auth/firebase.messaging']);
  assert.deepEqual(seen.subjectOptions, { team: 'muthumohammed810-5526s-projects', project: 'arabian-tailors' });
});

test('reuses initialized Firebase app and rejects failed WIF authentication without exposing provider details', async () => {
  const existing = { name: 'arabian-tailors-fcm-wif' };
  let initialized = false;
  const reused = initializeFirebaseWifApp({ env: wifEnv, getSubjectToken: async () => '', ExternalAccountClient: {}, getApps: () => [existing], initializeApp: () => { initialized = true; } });
  assert.equal(reused, existing);
  assert.equal(initialized, false);

  const credential = createFirebaseWifCredential({ getAccessToken: async () => { throw new Error('sensitive provider response'); } });
  await assert.rejects(credential.getAccessToken(), error => {
    assert.equal(error.message, 'Google Cloud Workload Identity authentication failed.');
    assert.equal(error.code, 'firebase/wif-auth-failed');
    assert.equal(error.message.includes('sensitive provider response'), false);
    return true;
  });
});

test('fails closed for missing WIF settings and invalid Vercel subject tokens', async () => {
  assert.equal(initializeFirebaseWifApp({ env: {}, getSubjectToken: async () => '', ExternalAccountClient: {}, getApps: () => [], initializeApp: () => assert.fail('must not initialize') }), null);
  class MockExternalAccountClient {
    static fromJSON(options) {
      return { credentials: {}, getAccessToken: async () => ({ token: await options.subject_token_supplier.getSubjectToken() }) };
    }
  }
  const app = initializeFirebaseWifApp({
    env: wifEnv, getSubjectToken: async () => 'short', ExternalAccountClient: MockExternalAccountClient,
    getApps: () => [], initializeApp: options => ({ options }),
  });
  await assert.rejects(app.options.credential.getAccessToken(), error => {
    assert.equal(error.message, 'Google Cloud Workload Identity authentication failed.');
    assert.equal(error.message.includes('short'), false);
    return true;
  });
});

test('WIF diagnostic confirms impersonated access-token issuance without returning token material or sending FCM', async () => {
  const received = { subjectOptions: null, scope: null };
  const result = await diagnoseFirebaseWifAuthentication({
    env: wifEnv,
    getSubjectToken: async options => { received.subjectOptions = options; return 'mock-oidc-token'.repeat(12); },
    ExternalAccountClient: { fromJSON: options => ({
      credentials: { expiry_date: Date.now() + 60_000 },
      async getAccessToken() { await options.subject_token_supplier.getSubjectToken(); received.scope = this.scopes; return { token: 'mock-google-access-token-never-return-this' }; },
    }) },
  });
  assert.deepEqual(result, { ok: true, stage: 'service-account-impersonation', httpStatus: 200, message: 'Google access token issued successfully; no notification was sent.' });
  assert.deepEqual(received.subjectOptions, { team: 'muthumohammed810-5526s-projects', project: 'arabian-tailors' });
  assert.deepEqual(received.scope, ['https://www.googleapis.com/auth/firebase.messaging']);
  assert.equal(JSON.stringify(result).includes('mock-google-access-token'), false);
  assert.equal(JSON.stringify(result).includes('mock-oidc-token'), false);
});

test('WIF diagnostic reports missing configuration and sanitized Vercel OIDC failure', async () => {
  const missing = await diagnoseFirebaseWifAuthentication({ env: {}, getSubjectToken: async () => assert.fail('must not request token'), ExternalAccountClient: {} });
  assert.deepEqual(missing, { ok: false, stage: 'configuration', httpStatus: 503, message: 'WIF configuration is missing or invalid.' });

  const failed = await diagnoseFirebaseWifAuthentication({
    env: wifEnv,
    getSubjectToken: async () => { throw new Error('private token and provider response'); },
    ExternalAccountClient: { fromJSON: options => ({ getAccessToken: async () => options.subject_token_supplier.getSubjectToken() }) },
  });
  assert.deepEqual(failed, { ok: false, stage: 'vercel-oidc', httpStatus: 503, message: 'Vercel could not provide an OIDC token in this request context.' });
  assert.equal(JSON.stringify(failed).includes('private token'), false);
});

test('WIF diagnostic reports safe HTTP status and identifies STS or impersonation failure stage', async () => {
  for (const [url, status, stage, message] of [
    ['https://sts.googleapis.com/v1/token', 400, 'google-sts-exchange', 'Google Security Token Service rejected or could not process the identity exchange.'],
    ['https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/example:generateAccessToken', 403, 'service-account-impersonation', 'Google IAM could not impersonate the configured service account.'],
  ]) {
    const result = await diagnoseFirebaseWifAuthentication({
      env: wifEnv,
      getSubjectToken: async () => 'mock-oidc-token'.repeat(12),
      ExternalAccountClient: { fromJSON: () => ({ getAccessToken: async () => { throw Object.assign(new Error('sensitive error details'), { response: { status, config: { url } } }); } }) },
    });
    assert.deepEqual(result, { ok: false, stage, httpStatus: status, message });
    assert.equal(JSON.stringify(result).includes(url), false);
    assert.equal(JSON.stringify(result).includes('sensitive error details'), false);
  }
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

test('marks a confirmed WIF authentication failure as retryable without exposing credential details', async () => {
  const registered = device('wif-failure'); const saved = [];
  const result = await dispatchAdminOrderFcm({ orderId: 'AT-001029', devices: [registered], claimDelivery: async () => true, saveDelivery: async (_orderId, _id, state) => saved.push(state), send: async () => { throw Object.assign(new Error('sensitive credential details'), { code: 'firebase/wif-auth-failed' }); }, removeDevice: async () => assert.fail('valid token should remain') });
  assert.equal(result.failed, 1);
  assert.equal(saved[0].status, 'failed');
  assert.equal(isRetryableAdminPushRecord(saved[0]), true);
  assert.equal(JSON.stringify(saved).includes('sensitive credential details'), false);
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
