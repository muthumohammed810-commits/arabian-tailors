import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { isMeasurementGuideImagePath, isMeasurementGuideVideoPath, MEASUREMENT_GUIDE_MAX_IMAGE_BYTES, MEASUREMENT_GUIDE_MAX_VIDEO_BYTES, measurementGuideMimeTypeForPath, measurementGuideVideoMimeTypeForPath } from '@/lib/measurement-guides.mjs';

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

function logUploadFailure(error: unknown) {
  const details: { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown } = error && typeof error === 'object' ? error as SafeUploadError : {};
  const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
  const statusCode = Number(details.statusCode ?? details.status);
  console.error('[admin-product-image] Token request failed', {
    stage: 'token',
    errorName: safe(details.name),
    errorCode: safe(details.code),
    statusCode: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : undefined,
    blobTokenConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    vercelEnvironment: process.env.VERCEL_ENV || 'unknown',
  });
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[admin-product-image] Token request unavailable', { stage: 'token', code: 'STORAGE_NOT_CONFIGURED', vercelEnvironment: process.env.VERCEL_ENV || 'unknown' });
    return NextResponse.json({ error: 'Shared image storage is not connected.', code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
  }
  try {
    if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Sign in required.', code: 'ADMIN_AUTH_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    let body: HandleUploadBody;
    try {
      body = (await request.json()) as HandleUploadBody;
    } catch {
      return NextResponse.json({ error: 'Invalid upload authorization request.', code: 'INVALID_UPLOAD_REQUEST' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!await isAdminAuthenticated()) throw new UploadTokenError('ADMIN_AUTH_REQUIRED', 401, 'Sign in required.');
        if (isMeasurementGuideVideoPath(pathname)) return {
          allowedContentTypes: [measurementGuideVideoMimeTypeForPath(pathname)],
          addRandomSuffix: false,
          maximumSizeInBytes: MEASUREMENT_GUIDE_MAX_VIDEO_BYTES,
        };
        if (isMeasurementGuideImagePath(pathname)) return {
          allowedContentTypes: [measurementGuideMimeTypeForPath(pathname)],
          addRandomSuffix: false,
          maximumSizeInBytes: MEASUREMENT_GUIDE_MAX_IMAGE_BYTES,
        };
        if (!/^arabian-tailors\/product-images\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(pathname)) throw new UploadTokenError('INVALID_UPLOAD_PATH', 400, 'Invalid image upload path.');
        return {
          allowedContentTypes: allowedTypes,
          addRandomSuffix: true,
          maximumSizeInBytes: 5 * 1024 ** 4,
        };
      },
    });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logUploadFailure(error);
    if (error instanceof UploadTokenError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    const safeError: { status?: unknown; statusCode?: unknown } = error && typeof error === 'object' ? error as SafeUploadError : {};
    const upstreamStatus = Number(safeError.statusCode ?? safeError.status);
    const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 502;
    return NextResponse.json({ error: 'The secure image upload could not be authorized.', code: 'TOKEN_GENERATION_FAILED' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
