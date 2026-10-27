import { get } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { isPublicProductImagePath } from '@/lib/product-image-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get('pathname') || '';
  if (pathname.length > 180 || !isPublicProductImagePath(pathname)) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const result = await get(pathname, { access: 'private' });
    if (result?.statusCode !== 200 || !result.stream || !result.blob.pathname.startsWith('arabian-tailors/product-images/')) {
      return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const contentType = result.blob.contentType.toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
      return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    // Product photos are intentionally public storefront content. The private store's
    // store.json and order records are never addressable through this fixed path allowlist.
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
    });
  } catch (error) {
    const details = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown; statusCode?: unknown } : {};
    const status = Number(details.statusCode ?? details.status);
    const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
    console.error('[product-image] Private image read failed', {
      stage: 'image-read',
      errorCode: safe(details.code),
      statusCode: Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
    });
    return new NextResponse('Image unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
