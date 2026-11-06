import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSharedBlobStorage, sharedBlobAuthOptions, sharedBlobUploadMode } from './shared-blob-storage.mjs';

test('Preview storage selects only the configured Preview OIDC store', () => {
  const env = {
    VERCEL_ENV: 'preview',
    PREVIEW_BLOB_STORE_ID: 'store_9OM9pcb4JPYkKOZ1',
    VERCEL_OIDC_TOKEN: 'preview-oidc-test-value',
    BLOB_READ_WRITE_TOKEN: 'legacy-token-for-another-store',
    BLOB_STORE_ID: 'store_T4m6R6ualv1ZHaxs',
  };

  assert.deepEqual(resolveSharedBlobStorage(env), {
    mode: 'oidc', configured: true,
    storeId: 'store_9OM9pcb4JPYkKOZ1', oidcToken: 'preview-oidc-test-value',
  });
  assert.deepEqual(sharedBlobAuthOptions(env), {
    oidcToken: 'preview-oidc-test-value', storeId: 'store_9OM9pcb4JPYkKOZ1',
  });
  assert.equal(sharedBlobUploadMode(env), 'presigned');
});

test('Preview fails closed when OIDC or the Preview store id is missing', () => {
  assert.deepEqual(resolveSharedBlobStorage({
    VERCEL_ENV: 'preview',
    BLOB_READ_WRITE_TOKEN: 'must-not-be-used-as-preview-fallback',
    BLOB_STORE_ID: 'store_T4m6R6ualv1ZHaxs',
  }), { mode: 'unavailable', configured: false });
  assert.equal(sharedBlobUploadMode({ VERCEL_ENV: 'preview', PREVIEW_BLOB_STORE_ID: 'store_9OM9pcb4JPYkKOZ1' }), 'unavailable');
  assert.throws(() => sharedBlobAuthOptions({ VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: 'legacy-token' }), /not configured/);
});

test('Production ignores Preview OIDC settings and preserves the existing BLOB token path', () => {
  const env = {
    VERCEL_ENV: 'production',
    BLOB_READ_WRITE_TOKEN: 'existing-production-token',
    PREVIEW_BLOB_STORE_ID: 'store_9OM9pcb4JPYkKOZ1',
    VERCEL_OIDC_TOKEN: 'preview-oidc-test-value',
  };
  assert.deepEqual(resolveSharedBlobStorage(env), { mode: 'token', configured: true, token: 'existing-production-token' });
  assert.deepEqual(sharedBlobAuthOptions(env), { token: 'existing-production-token' });
  assert.equal(sharedBlobUploadMode(env), 'client-token');
});

test('Development keeps using the existing BLOB read-write token', () => {
  const env = { VERCEL_ENV: 'development', BLOB_READ_WRITE_TOKEN: 'development-token' };
  assert.deepEqual(sharedBlobAuthOptions(env), { token: 'development-token' });
  assert.equal(sharedBlobUploadMode(env), 'client-token');
});
