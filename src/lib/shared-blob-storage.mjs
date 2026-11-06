/**
 * Resolve the shared application Blob store without allowing Preview credentials
 * to fall back to a token that may belong to another store.
 *
 * Preview deployments use Vercel OIDC and the branch-specific preview store id.
 * Production and local Development keep the existing read-write-token path.
 */
export function resolveSharedBlobStorage(env = process.env) {
  if (env.VERCEL_ENV === 'preview') {
    const storeId = typeof env.PREVIEW_BLOB_STORE_ID === 'string' ? env.PREVIEW_BLOB_STORE_ID.trim() : '';
    const oidcToken = typeof env.VERCEL_OIDC_TOKEN === 'string' ? env.VERCEL_OIDC_TOKEN.trim() : '';
    if (!storeId || !oidcToken) return { mode: 'unavailable', configured: false };
    return { mode: 'oidc', configured: true, storeId, oidcToken };
  }

  const token = typeof env.BLOB_READ_WRITE_TOKEN === 'string' ? env.BLOB_READ_WRITE_TOKEN.trim() : '';
  if (!token) return { mode: 'unavailable', configured: false };
  return { mode: 'token', configured: true, token };
}

export function sharedBlobAuthOptions(env = process.env) {
  const storage = resolveSharedBlobStorage(env);
  if (!storage.configured) throw new Error('Shared Blob storage is not configured for this environment.');
  return storage.mode === 'oidc'
    ? { oidcToken: storage.oidcToken, storeId: storage.storeId }
    : { token: storage.token };
}

export function isSharedBlobConfigured(env = process.env) {
  return resolveSharedBlobStorage(env).configured;
}

export function sharedBlobUploadMode(env = process.env) {
  const storage = resolveSharedBlobStorage(env);
  if (!storage.configured) return 'unavailable';
  return storage.mode === 'oidc' ? 'presigned' : 'client-token';
}
