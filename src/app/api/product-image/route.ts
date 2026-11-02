import { get } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { isPublicProductImagePath } from '@/lib/product-image-url';
import { hasPublishedMeasurementGuideImage, hasPublishedMeasurementGuideVideo, isMeasurementGuideImagePath, isMeasurementGuideVideoPath } from '@/lib/measurement-guides.mjs';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { ABAYA_PRODUCT_IMAGE_PREFIX, getProductImageBlobStore, isAbayaProductImagePath, isAbayaProductImageUrlForStore } from '@/lib/abaya-product.mjs';

async function isPublishedGuideImage(pathname: string) {
  const stored = await get('arabian-tailors/store.json', { access: 'private', useCache: false });
  if (stored?.statusCode !== 200 || !stored.stream) return false;
  const store = await new Response(stored.stream).json() as { products?: unknown };
  return hasPublishedMeasurementGuideImage(store.products as any[], pathname);
}

async function isPublishedGuideVideo(pathname: string) {
  const stored = await get('arabian-tailors/store.json', { access: 'private', useCache: false });
  if (stored?.statusCode !== 200 || !stored.stream) return false;
  const store = await new Response(stored.stream).json() as { products?: unknown };
  return hasPublishedMeasurementGuideVideo(store.products as any[], pathname);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get('pathname') || '';
  const productImage = isPublicProductImagePath(pathname);
  const abayaNamespace = pathname.startsWith(ABAYA_PRODUCT_IMAGE_PREFIX);
  const abayaImage = isAbayaProductImagePath(pathname);
  const guideImage = isMeasurementGuideImagePath(pathname);
  const guideVideo = isMeasurementGuideVideoPath(pathname);
  if (pathname.length > 300 || (!productImage && !guideImage && !guideVideo) || (abayaNamespace && !abayaImage)) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    if (guideImage && !await isAdminAuthenticated()) {
      if (!await isPublishedGuideImage(pathname)) {
        return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    if (guideVideo && !await isAdminAuthenticated()) {
      if (!await isPublishedGuideVideo(pathname)) {
        return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    const storage = getProductImageBlobStore(pathname);
    if (storage.kind === 'abaya' && !storage.token) {
      return new NextResponse('Abaya image storage is not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (storage.kind === 'shared' && !storage.token) {
      return new NextResponse('Image storage is not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const result = await get(pathname, { access: 'private', token: storage.token || undefined });
    if (storage.kind === 'abaya' && !isAbayaProductImageUrlForStore(result?.blob.url, process.env.ABAYA_BLOB_STORE_ID)) {
      return new NextResponse('Image not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const blobPathAllowed = productImage
      ? isPublicProductImagePath(result?.blob.pathname || '')
      : result?.blob.pathname === pathname;
    if (result?.statusCode !== 200 || !result.stream || !blobPathAllowed) {
      return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const contentType = result.blob.contentType.toLowerCase();
    const allowedContentTypes = guideVideo ? ['video/mp4', 'video/webm'] : ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedContentTypes.includes(contentType)) {
      return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    // Product photos are intentionally public storefront content. The private store's
    // store.json and order records are never addressable through this fixed path allowlist.
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
          'Cache-Control': guideImage || guideVideo ? 'private, no-store' : 'public, max-age=86400, s-maxage=31536000, immutable',
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
