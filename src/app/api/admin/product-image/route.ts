import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return json({ error: 'Sign in required.' }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'Shared image storage is not connected.' }, 503);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES + 64 * 1024) return json({ error: 'Image must be smaller than 5 MB.' }, 413);

  const formData = await request.formData().catch(() => null);
  const image = formData?.get('image');
  if (!(image instanceof File)) return json({ error: 'Choose an image file to upload.' }, 400);
  if (!allowedTypes.has(image.type)) return json({ error: 'Use a JPEG, PNG, WebP, or GIF image.' }, 415);
  if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) return json({ error: 'Image must be smaller than 5 MB.' }, 413);
  const bytes = new Uint8Array(await image.slice(0, 16).arrayBuffer());
  const signatures: Record<string, (data: Uint8Array) => boolean> = {
    'image/jpeg': data => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    'image/png': data => data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47,
    'image/gif': data => data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38,
    'image/webp': data => data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50,
  };
  if (!signatures[image.type](bytes)) return json({ error: 'The selected file does not match its image type.' }, 415);

  try {
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.slice('image/'.length);
    const blob = await put(`arabian-tailors/product-images/${crypto.randomUUID()}.${extension}`, image, {
      access: 'public',
      addRandomSuffix: false,
      contentType: image.type,
      cacheControlMaxAge: 60 * 60 * 24 * 30,
      maximumSizeInBytes: MAX_IMAGE_BYTES,
    });
    return json({ url: blob.url });
  } catch {
    return json({ error: 'Image upload failed. Please try again.' }, 500);
  }
}
