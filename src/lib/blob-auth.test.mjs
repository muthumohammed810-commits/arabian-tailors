import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBlobAuth, blobAuthOptions, isBlobStoreConfigured } from './blob-auth.mjs';

const SHARED = 'store_6dZKB7vFKlfq2UmH';
const ABAYA = 'store_vkimfAjFJW0suvFN';

test('Preview OIDC selects each explicit store independently', async () => {
  const env = { VERCEL_ENV: 'preview', BLOB_STORE_ID: SHARED, ABAYA_BLOB_STORE_ID: ABAYA };
  const provider = async () => 'opaque-oidc-token';
  const shared = await resolveBlobAuth('shared', env, provider);
  const abaya = await resolveBlobAuth('abaya', env, provider);
  assert.deepEqual([shared.mode, shared.storeId], ['oidc', SHARED]);
  assert.deepEqual([abaya.mode, abaya.storeId], ['oidc', ABAYA]);
  assert.deepEqual(blobAuthOptions(shared), { storeId: SHARED, oidcToken: 'opaque-oidc-token' });
  assert.deepEqual(blobAuthOptions(abaya), { storeId: ABAYA, oidcToken: 'opaque-oidc-token' });
  assert.equal(isBlobStoreConfigured('shared', env), true);
  assert.equal(isBlobStoreConfigured('abaya', env), true);
});

test('legacy fallback stays scoped to the matching store', async () => {
  const env = {
    VERCEL_ENV: 'development', BLOB_STORE_ID: SHARED, ABAYA_BLOB_STORE_ID: ABAYA,
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_6dZKB7vFKlfq2UmH_sharedsecret', ABAYA_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_vkimfAjFJW0suvFN_abayasecret',
  };
  const unavailable = async () => { throw new Error('must not be called outside Preview'); };
  const shared = await resolveBlobAuth('shared', env, unavailable);
  const abaya = await resolveBlobAuth('abaya', env, unavailable);
  assert.equal(shared.token, env.BLOB_READ_WRITE_TOKEN);
  assert.equal(abaya.token, env.ABAYA_BLOB_READ_WRITE_TOKEN);
  assert.equal(shared.mode, 'token');
  assert.equal(abaya.mode, 'token');
});

test('Preview OIDC failure never falls back to any read-write token', async () => {
  const env = { VERCEL_ENV: 'preview', BLOB_STORE_ID: SHARED, ABAYA_BLOB_STORE_ID: ABAYA, BLOB_READ_WRITE_TOKEN: 'shared-rw-token' };
  const unavailable = async () => { throw new Error('not available'); };
  const result = await resolveBlobAuth('abaya', env, unavailable);
  assert.deepEqual(result, { ok: false, kind: 'abaya', reason: 'oidc-unavailable' });
});

test('legacy tokens with mismatched store identity are rejected', async () => {
  const result = await resolveBlobAuth('abaya', {
    VERCEL_ENV: 'development', ABAYA_BLOB_STORE_ID: ABAYA,
    ABAYA_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_wrongstore_secret', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_6dZKB7vFKlfq2UmH_sharedsecret',
  }, async () => 'unused');
  assert.deepEqual(result, { ok: false, kind: 'abaya', reason: 'store-id-mismatch' });
  assert.equal(isBlobStoreConfigured('abaya', {
    VERCEL_ENV: 'development', ABAYA_BLOB_STORE_ID: ABAYA,
    ABAYA_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_wrongstore_secret',
  }), false);
});

test('Production keeps the legacy token path even if an OIDC provider is available', async () => {
  let requested = false;
  const result = await resolveBlobAuth('shared', { VERCEL_ENV: 'production', BLOB_STORE_ID: 'store_productionstore', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_productionstore_secret' }, async () => {
    requested = true;
    return 'oidc-token';
  });
  assert.equal(requested, false);
  assert.deepEqual({ mode: result.mode, token: result.token }, { mode: 'token', token: 'vercel_blob_rw_productionstore_secret' });
});

test('missing Abaya store configuration fails closed', async () => {
  const result = await resolveBlobAuth('abaya', { VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: 'shared-rw-token' }, async () => 'oidc-token');
  assert.deepEqual(result, { ok: false, kind: 'abaya', reason: 'store-id-missing' });
});

test('Preview refuses a configured store ID outside its approved shared and Abaya targets', async () => {
  const shared = await resolveBlobAuth('shared', { VERCEL_ENV: 'preview', BLOB_STORE_ID: ABAYA }, async () => 'oidc-token');
  const abaya = await resolveBlobAuth('abaya', { VERCEL_ENV: 'preview', ABAYA_BLOB_STORE_ID: SHARED }, async () => 'oidc-token');
  assert.deepEqual(shared, { ok: false, kind: 'shared', reason: 'store-id-mismatch' });
  assert.deepEqual(abaya, { ok: false, kind: 'abaya', reason: 'store-id-mismatch' });
});
