import test from 'node:test';
import assert from 'node:assert/strict';
import { getBlobStoreUploadAuth } from './blob-auth.mjs';

test('Preview upload authorization uses store-specific webhook keys', async () => {
  const env = {
    VERCEL_ENV: 'preview',
    BLOB_STORE_ID: 'store_6dZKB7vFKlfq2UmH',
    ABAYA_BLOB_STORE_ID: 'store_vkimfAjFJW0suvFN',
    BLOB_WEBHOOK_PUBLIC_KEY: 'shared-public-key',
    ABAYA_BLOB_WEBHOOK_PUBLIC_KEY: 'abaya-public-key',
  };
  const oidc = async () => 'oidc-token';
  const shared = await getBlobStoreUploadAuth('shared', env, oidc);
  const abaya = await getBlobStoreUploadAuth('abaya', env, oidc);
  assert.equal(shared.storeId, env.BLOB_STORE_ID);
  assert.equal(shared.webhookPublicKey, env.BLOB_WEBHOOK_PUBLIC_KEY);
  assert.equal(abaya.storeId, env.ABAYA_BLOB_STORE_ID);
  assert.equal(abaya.webhookPublicKey, env.ABAYA_BLOB_WEBHOOK_PUBLIC_KEY);
});

test('OIDC upload authorization fails closed when the store webhook key is missing', async () => {
  const result = await getBlobStoreUploadAuth('abaya', {
    VERCEL_ENV: 'preview', ABAYA_BLOB_STORE_ID: 'store_vkimfAjFJW0suvFN',
  }, async () => 'oidc-token');
  assert.deepEqual(result, { ok: false, kind: 'abaya', reason: 'webhook-key-missing' });
});

test('legacy upload fallback remains available without changing Production protocol selection', async () => {
  const result = await getBlobStoreUploadAuth('shared', {
    VERCEL_ENV: 'production', BLOB_READ_WRITE_TOKEN: 'production-token',
  }, async () => { throw new Error('must not request OIDC in Production'); });
  assert.equal(result.mode, 'token');
  assert.equal(result.webhookPublicKey, undefined);
});
