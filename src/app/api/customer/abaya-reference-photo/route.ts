import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { ABAYA_REFERENCE_MAX_BYTES, ABAYA_REFERENCE_TYPES, isModelReferencePath, isValidOrderReference, MODEL_REFERENCE_PREFIX } from '@/lib/abaya-customization';
import { resolveSharedBlobStorage, sharedBlobAuthOptions, sharedBlobUploadMode } from '@/lib/shared-blob-storage.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const mode = sharedBlobUploadMode(process.env);
  if (mode === 'unavailable') return NextResponse.json({ error: 'Reference photo storage is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ mode }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const storage = resolveSharedBlobStorage(process.env);
  if (!storage.configured) {
    return NextResponse.json({ error: 'Reference photo storage is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const origin = request.headers.get('origin');
  if (!origin || new URL(request.url).origin !== origin) {
    return NextResponse.json({ error: 'The upload request origin could not be verified.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const body = await request.json() as HandleUploadBody;
    if (storage.mode === 'oidc') {
      const result = await handleUploadPresigned({
        body: body as HandleUploadPresignedBody,
        request,
        getSignedToken: async (pathname, clientPayload) => {
          const orderId = clientPayload || '';
          if (!isValidOrderReference(orderId) || !pathname.startsWith(MODEL_REFERENCE_PREFIX) || !isModelReferencePath(pathname, orderId)) {
            throw new Error('Invalid garment reference photo request.');
          }
          const token = await issueSignedToken({
            ...sharedBlobAuthOptions(process.env),
            pathname,
            operations: ['put'],
            allowedContentTypes: [...ABAYA_REFERENCE_TYPES],
            maximumSizeInBytes: ABAYA_REFERENCE_MAX_BYTES,
          });
          return { token, urlOptions: {
            allowedContentTypes: [...ABAYA_REFERENCE_TYPES],
            maximumSizeInBytes: ABAYA_REFERENCE_MAX_BYTES,
            addRandomSuffix: false,
            allowOverwrite: true,
          } };
        },
      });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const orderId = clientPayload || '';
        if (!isValidOrderReference(orderId) || !pathname.startsWith(MODEL_REFERENCE_PREFIX) || !isModelReferencePath(pathname, orderId)) {
          throw new Error('Invalid garment reference photo request.');
        }
        return {
          allowedContentTypes: [...ABAYA_REFERENCE_TYPES],
          maximumSizeInBytes: ABAYA_REFERENCE_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: orderId,
        };
      },
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The model reference photo could not be authorized. Check the file and retry.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
