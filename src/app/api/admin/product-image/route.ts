import { handleUploadPresigned, handleUpload, type HandleUploadBody, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { blobAuthOptions, blobDelFor, getBlobStoreUploadAuth, isBlobStoreConfigured } from '@/lib/blob-auth.mjs';
import { isMeasurementGuideImagePath, isMeasurementGuideVideoPath, MEASUREMENT_GUIDE_MAX_IMAGE_BYTES, MEASUREMENT_GUIDE_MAX_VIDEO_BYTES, measurementGuideMimeTypeForPath, measurementGuideVideoMimeTypeForPath } from '@/lib/measurement-guides.mjs';
import { getProductImageBlobStore, isAbayaProductImagePath, ABAYA_PRODUCT_IMAGE_MAX_BYTES } from '@/lib/abaya-product.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
type SafeUploadError = Error & { code?: string; status?: number; statusCode?: number };

class UploadTokenError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'UploadTokenError';
  }
}

function logUploadFailure(error: unknown, storageKind: 'abaya' | 'shared') {
  const details: { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown } = error && typeof error === 'object' ? error as SafeUploadError : {};
  const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
  const statusCode = Number(details.statusCode ?? details.status);
  console.error('[admin-product-image] Token request failed', {
    stage: 'token',
    errorName: safe(details.name),
    errorCode: safe(details.code),
    statusCode: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : undefined,
    storageKind,
    blobStoreConfigured: Boolean(storageKind === 'abaya' ? process.env.ABAYA_BLOB_STORE_ID : process.env.BLOB_STORE_ID),
    vercelEnvironment: process.env.VERCEL_ENV || 'unknown',
  });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Sign in required.', code: 'ADMIN_AUTH_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let storageKind: 'abaya' | 'shared' = 'shared';
  try {
    let body: (HandleUploadBody | HandleUploadPresignedBody | { type: 'blob.get-upload-mode'; payload: { pathname: string } });
    try {
      body = (await request.json()) as HandleUploadBody | HandleUploadPresignedBody | { type: 'blob.get-upload-mode'; payload: { pathname: string } };
    } catch {
      return NextResponse.json({ error: 'Invalid upload authorization request.', code: 'INVALID_UPLOAD_REQUEST' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const pathname = body.type === 'blob.generate-client-token' || body.type === 'blob.generate-presigned-url'
      ? body.payload.pathname
      : body.type === 'blob.upload-completed' ? body.payload.blob.pathname : body.type === 'blob.get-upload-mode' ? body.payload.pathname : '';
    const storage = getProductImageBlobStore(pathname);
    storageKind = storage.kind === 'abaya' ? 'abaya' : 'shared';
    const auth = await getBlobStoreUploadAuth(storageKind);
    if (!auth.ok) {
      const isAbaya = storage.kind === 'abaya';
      console.error('[admin-product-image] Upload authorization unavailable', { stage: 'token', code: isAbaya ? 'ABAYA_STORAGE_NOT_CONFIGURED' : 'STORAGE_NOT_CONFIGURED', reason: auth.reason, storageKind: storage.kind, vercelEnvironment: process.env.VERCEL_ENV || 'unknown' });
      return NextResponse.json({ error: isAbaya ? 'Abaya image storage is not configured.' : 'Shared image storage is not connected.', code: isAbaya ? 'ABAYA_STORAGE_NOT_CONFIGURED' : 'STORAGE_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.type === 'blob.get-upload-mode') {
      if (typeof pathname !== 'string' || !getUploadPolicy(pathname)) return NextResponse.json({ error: 'Invalid image upload path.', code: 'INVALID_UPLOAD_PATH' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      return NextResponse.json({ mode: auth.mode === 'oidc' ? 'presigned' : 'legacy' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const policyFor = async (pathname: string) => {
        if (!await isAdminAuthenticated()) throw new UploadTokenError('ADMIN_AUTH_REQUIRED', 401, 'Sign in required.');
        const policy = getUploadPolicy(pathname);
        if (!policy) throw new UploadTokenError('INVALID_UPLOAD_PATH', 400, 'Invalid image upload path.');
        return policy;
    };
    let response: unknown;
    if (auth.mode === 'oidc') {
      if (body.type !== 'blob.generate-presigned-url' && body.type !== 'blob.upload-completed') return NextResponse.json({ error: 'Preview uploads require the signed URL flow.', code: 'PRESIGNED_UPLOAD_REQUIRED' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      response = await handleUploadPresigned({
        body,
        request,
        webhookPublicKey: 'webhookPublicKey' in auth ? auth.webhookPublicKey : undefined,
        getSignedToken: async (path, _clientPayload, _multipart) => {
          const policy = await policyFor(path);
          const token = await issueSignedToken({ ...blobAuthOptions(auth), pathname: path, operations: ['put'], allowedContentTypes: policy.allowedContentTypes, maximumSizeInBytes: policy.maximumSizeInBytes });
          return { token, urlOptions: { addRandomSuffix: policy.addRandomSuffix, allowOverwrite: policy.allowOverwrite } };
        },
      });
    } else {
      if (body.type !== 'blob.generate-client-token' && body.type !== 'blob.upload-completed') return NextResponse.json({ error: 'Invalid legacy upload request.', code: 'LEGACY_UPLOAD_REQUIRED' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      response = await handleUpload({
      token: auth.token,
      body,
      request,
      onBeforeGenerateToken: async (path) => policyFor(path),
      });
    }
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logUploadFailure(error, storageKind);
    if (error instanceof UploadTokenError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    const safeError: { status?: unknown; statusCode?: unknown } = error && typeof error === 'object' ? error as SafeUploadError : {};
    const upstreamStatus = Number(safeError.statusCode ?? safeError.status);
    const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 502;
    return NextResponse.json({ error: 'The secure image upload could not be authorized.', code: 'TOKEN_GENERATION_FAILED' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

function getUploadPolicy(pathname: string) {
  if (isMeasurementGuideVideoPath(pathname)) return {
          allowedContentTypes: [measurementGuideVideoMimeTypeForPath(pathname)],
          addRandomSuffix: false,
          allowOverwrite: false,
          maximumSizeInBytes: MEASUREMENT_GUIDE_MAX_VIDEO_BYTES,
        };
  if (isMeasurementGuideImagePath(pathname)) return {
          allowedContentTypes: [measurementGuideMimeTypeForPath(pathname)],
          addRandomSuffix: false,
          allowOverwrite: false,
          maximumSizeInBytes: MEASUREMENT_GUIDE_MAX_IMAGE_BYTES,
        };
  if (isAbayaProductImagePath(pathname)) return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
          // The client persists this exact UUID pathname on the product. UUIDs
          // are unique already, and a suffix would make the saved path differ
          // from the path allowlisted by the storefront image proxy.
          addRandomSuffix: false,
          allowOverwrite: false,
          maximumSizeInBytes: ABAYA_PRODUCT_IMAGE_MAX_BYTES,
        };
  if (!/^arabian-tailors\/product-images\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(pathname)) return null;
  return {
          allowedContentTypes: allowedTypes,
          addRandomSuffix: true,
          allowOverwrite: false,
          maximumSizeInBytes: 5 * 1024 ** 4,
        };
}

/** Delete only authenticated Abaya media, using only the dedicated Abaya token. */
export async function DELETE(request: Request) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Sign in required.', code: 'ADMIN_AUTH_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Same-origin request required.', code: 'ORIGIN_NOT_ALLOWED' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Same-origin request required.', code: 'ORIGIN_NOT_ALLOWED' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  let pathname: unknown;
  try {
    pathname = (await request.json() as { pathname?: unknown }).pathname;
  } catch {
    return NextResponse.json({ error: 'Invalid image deletion request.', code: 'INVALID_DELETE_REQUEST' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!isAbayaProductImagePath(String(pathname || ''))) return NextResponse.json({ error: 'Only Abaya gallery images can be deleted here.', code: 'INVALID_ABAYA_IMAGE_PATH' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const storage = getProductImageBlobStore(String(pathname));
  if (!isBlobStoreConfigured('abaya')) return NextResponse.json({ error: 'Abaya image storage is not configured.', code: 'ABAYA_STORAGE_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    await blobDelFor('abaya', String(pathname));
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const details = error && typeof error === 'object' ? error as { status?: unknown; statusCode?: unknown; code?: unknown } : {};
    const statusCode = Number(details.statusCode ?? details.status);
    const code = typeof details.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(details.code) ? details.code : undefined;
    console.error('[admin-product-image] Abaya image deletion failed', { stage: 'delete', errorCode: code, statusCode: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : undefined });
    return NextResponse.json({ error: 'The Abaya image could not be removed from storage.', code: 'ABAYA_IMAGE_DELETE_FAILED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
