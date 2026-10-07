import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'Shared image storage is not connected.' }, { status: 503 });
  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!await isAdminAuthenticated()) throw new Error('Sign in required.');
        if (!/^arabian-tailors\/product-images\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(pathname)) throw new Error('Invalid image upload path.');
        return {
          allowedContentTypes: allowedTypes,
          addRandomSuffix: true,
          maximumSizeInBytes: 5 * 1024 ** 4,
        };
      },
    });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image upload failed.';
    const status = message === 'Sign in required.' ? 401 : 400;
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
