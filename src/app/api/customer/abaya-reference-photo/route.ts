import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { ABAYA_REFERENCE_MAX_BYTES, ABAYA_REFERENCE_TYPES, isModelReferencePath, isValidOrderReference, MODEL_REFERENCE_PREFIX } from '@/lib/abaya-customization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Reference photo storage is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const origin = request.headers.get('origin');
  if (!origin || new URL(request.url).origin !== origin) {
    return NextResponse.json({ error: 'The upload request origin could not be verified.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const body = await request.json() as HandleUploadBody;
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
