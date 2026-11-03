import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { ABAYA_REFERENCE_MAX_BYTES, ABAYA_REFERENCE_TYPES, isModelReferencePath, isValidOrderReference, MODEL_REFERENCE_PREFIX } from '@/lib/abaya-customization';
import { blobAuthOptions, getBlobStoreUploadAuth } from '@/lib/blob-auth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || new URL(request.url).origin !== origin) {
    return NextResponse.json({ error: 'The upload request origin could not be verified.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const body = await request.json() as HandleUploadBody | HandleUploadPresignedBody | { type: 'blob.get-upload-mode'; payload: { pathname?: unknown; clientPayload?: unknown } };
    const pathname = body.type === 'blob.get-upload-mode' ? body.payload.pathname
      : body.type === 'blob.generate-client-token' || body.type === 'blob.generate-presigned-url' ? body.payload.pathname
        : body.type === 'blob.upload-completed' ? body.payload.blob.pathname : '';
    const clientPayload = body.type === 'blob.get-upload-mode' ? body.payload.clientPayload
      : body.type === 'blob.generate-client-token' || body.type === 'blob.generate-presigned-url' ? body.payload.clientPayload
        : body.type === 'blob.upload-completed' ? body.payload.tokenPayload : '';
    const validRequest = typeof pathname === 'string' && typeof clientPayload === 'string'
      && isValidOrderReference(clientPayload) && pathname.startsWith(MODEL_REFERENCE_PREFIX) && isModelReferencePath(pathname, clientPayload);
    if (!validRequest) return NextResponse.json({ error: 'Invalid garment reference photo request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const auth = await getBlobStoreUploadAuth('shared');
    if (!auth.ok) return NextResponse.json({ error: 'Reference photo storage is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (body.type === 'blob.get-upload-mode') return NextResponse.json({ mode: auth.mode === 'oidc' ? 'presigned' : 'legacy' }, { headers: { 'Cache-Control': 'no-store' } });
    let result: unknown;
    if (auth.mode === 'oidc') {
      if (body.type !== 'blob.generate-presigned-url' && body.type !== 'blob.upload-completed') return NextResponse.json({ error: 'Preview uploads require the signed URL flow.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      result = await handleUploadPresigned({
        body,
        request,
        webhookPublicKey: 'webhookPublicKey' in auth ? auth.webhookPublicKey : undefined,
        getSignedToken: async (uploadPath, payload) => {
          const orderId = payload || '';
          if (uploadPath !== pathname || orderId !== clientPayload) throw new Error('Invalid garment reference photo request.');
          const token = await issueSignedToken({ ...blobAuthOptions(auth), pathname: uploadPath, operations: ['put'], allowedContentTypes: [...ABAYA_REFERENCE_TYPES], maximumSizeInBytes: ABAYA_REFERENCE_MAX_BYTES });
          return { token, urlOptions: { addRandomSuffix: false, allowOverwrite: true, tokenPayload: orderId } };
        },
      });
    } else {
      if (body.type !== 'blob.generate-client-token' && body.type !== 'blob.upload-completed') return NextResponse.json({ error: 'Invalid legacy upload request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      result = await handleUpload({
        token: auth.token,
        body,
        request,
        onBeforeGenerateToken: async (uploadPath, payload) => {
          const orderId = payload || '';
          if (!isValidOrderReference(orderId) || uploadPath !== pathname || !isModelReferencePath(uploadPath, orderId)) throw new Error('Invalid garment reference photo request.');
          return { allowedContentTypes: [...ABAYA_REFERENCE_TYPES], maximumSizeInBytes: ABAYA_REFERENCE_MAX_BYTES, addRandomSuffix: false, allowOverwrite: true, tokenPayload: orderId };
        },
      });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The model reference photo could not be authorized. Check the file and retry.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
