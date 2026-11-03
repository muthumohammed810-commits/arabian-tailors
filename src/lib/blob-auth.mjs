import { getVercelOidcToken } from '@vercel/oidc';
import { del, get, list, put } from '@vercel/blob';

const configs = Object.freeze({
  shared: Object.freeze({ storeIdKey: 'BLOB_STORE_ID', tokenKey: 'BLOB_READ_WRITE_TOKEN' }),
  abaya: Object.freeze({ storeIdKey: 'ABAYA_BLOB_STORE_ID', tokenKey: 'ABAYA_BLOB_READ_WRITE_TOKEN' }),
});
const previewStoreIds = Object.freeze({
  shared: 'store_6dZKB7vFKlfq2UmH',
  abaya: 'store_vkimfAjFJW0suvFN',
});

function storageConfig(kind, env) {
  const config = configs[kind];
  if (!config) throw new Error('Unknown Blob store');
  const storeId = typeof env[config.storeIdKey] === 'string' ? env[config.storeIdKey].trim() : '';
  const token = typeof env[config.tokenKey] === 'string' ? env[config.tokenKey].trim() : '';
  return { storeId, token };
}

/** Resolve one store's credentials per request. Preview is OIDC-only; Production keeps its existing
 * read-write-token path, and Development can use a legacy token only when its encoded store ID matches.
 */
export async function resolveBlobAuth(kind, env = process.env, oidcTokenProvider = getVercelOidcToken) {
  const { storeId, token } = storageConfig(kind, env);
  const isPreview = env.VERCEL_ENV === 'preview';
  if (isPreview) {
    if (!storeId) return { ok: false, kind, reason: 'store-id-missing' };
    if (normalizeStoreId(storeId) !== normalizeStoreId(previewStoreIds[kind])) return { ok: false, kind, reason: 'store-id-mismatch' };
    try {
      const oidcToken = await oidcTokenProvider();
      if (typeof oidcToken === 'string' && oidcToken.trim()) {
        return { ok: true, kind, mode: 'oidc', storeId, oidcToken: oidcToken.trim() };
      }
    } catch {
      // Preview is OIDC-only: never silently downgrade to a token for another store.
    }
    return { ok: false, kind, reason: 'oidc-unavailable' };
  }
  if (env.VERCEL_ENV === 'production') {
    if (kind === 'abaya' && !storeId) return { ok: false, kind, reason: 'store-id-missing' };
    if (token) return { ok: true, kind, mode: 'token', storeId: storeId || null, token };
    return { ok: false, kind, reason: storeId ? 'credentials-missing' : 'store-id-missing' };
  }
  if (token) {
    const tokenStoreId = parseStoreIdFromReadWriteToken(token);
    const expectedStoreId = normalizeStoreId(storeId);
    const canUseLegacyToken = tokenStoreId && expectedStoreId && tokenStoreId === expectedStoreId;
    if (canUseLegacyToken) return { ok: true, kind, mode: 'token', storeId: storeId || tokenStoreId, token };
    return { ok: false, kind, reason: tokenStoreId ? 'store-id-mismatch' : 'token-store-unverifiable' };
  }
  return { ok: false, kind, reason: storeId ? 'credentials-missing' : 'store-id-missing' };
}

function parseStoreIdFromReadWriteToken(token) {
  if (typeof token !== 'string') return '';
  const [, , , storeId = ''] = token.split('_');
  return storeId;
}

function normalizeStoreId(storeId) {
  return typeof storeId === 'string' && storeId.startsWith('store_') ? storeId.slice(6) : storeId;
}

export function isBlobStoreConfigured(kind, env = process.env) {
  const { storeId, token } = storageConfig(kind, env);
  const isPreview = env.VERCEL_ENV === 'preview';
  if (isPreview) return normalizeStoreId(storeId) === normalizeStoreId(previewStoreIds[kind]);
  if (env.VERCEL_ENV === 'production') return Boolean(token && (kind !== 'abaya' || storeId));
  if (!token) return false;
  const tokenStoreId = parseStoreIdFromReadWriteToken(token);
  const expectedStoreId = normalizeStoreId(storeId);
  return Boolean(tokenStoreId && expectedStoreId && tokenStoreId === expectedStoreId);
}

export function blobAuthOptions(auth) {
  if (!auth?.ok) throw new Error('Blob storage is not configured for the selected store');
  return auth.mode === 'oidc'
    ? { storeId: auth.storeId, oidcToken: auth.oidcToken }
    : { token: auth.token };
}

async function optionsForRequest(kind, options = {}) {
  const auth = await resolveBlobAuth(kind);
  const requestOptions = { ...options };
  delete requestOptions.token;
  delete requestOptions.oidcToken;
  delete requestOptions.storeId;
  delete requestOptions.presignedUrlPayload;
  return { ...requestOptions, ...blobAuthOptions(auth) };
}

export const blobGet = async (input, options) => get(input, await optionsForRequest('shared', options));
export const blobGetFor = async (kind, input, options) => get(input, await optionsForRequest(kind, options));
export const blobList = async (options) => list(await optionsForRequest('shared', options));
export const blobPut = async (pathname, body, options) => put(pathname, body, await optionsForRequest('shared', options));
export const blobDel = async (input, options) => del(input, await optionsForRequest('shared', options));
export const blobDelFor = async (kind, input, options) => del(input, await optionsForRequest(kind, options));

export async function getBlobStoreUploadAuth(kind, env = process.env, oidcTokenProvider = getVercelOidcToken) {
  const auth = await resolveBlobAuth(kind, env, oidcTokenProvider);
  if (!auth.ok) return auth;
  const webhookKeyName = kind === 'abaya' ? 'ABAYA_BLOB_WEBHOOK_PUBLIC_KEY' : 'BLOB_WEBHOOK_PUBLIC_KEY';
  const webhookPublicKey = typeof env[webhookKeyName] === 'string' ? env[webhookKeyName].trim() : '';
  if (auth.mode === 'oidc' && !webhookPublicKey) return { ok: false, kind, reason: 'webhook-key-missing' };
  return { ...auth, webhookPublicKey: webhookPublicKey || undefined };
}
