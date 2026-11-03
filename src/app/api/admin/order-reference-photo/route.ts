import { blobGet as get, blobList as list, isBlobStoreConfigured } from '@/lib/blob-auth.mjs';
import { NextRequest, NextResponse } from 'next/server';
import { isGarmentReferencePhotoForOrder, isModelReferenceUrl, isValidOrderReference, referencePhotoFromDesign } from '@/lib/abaya-customization';
import { isAdminAuthenticated } from '@/app/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORDER_PREFIX = 'arabian-tailors/orders/';
const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: NextRequest) {
  if (!await isAdminAuthenticated()) return new NextResponse('Sign in required', { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  if (!isBlobStoreConfigured('shared')) return notFound();
  const orderId = request.nextUrl.searchParams.get('orderId') || '';
  if (!isValidOrderReference(orderId)) return notFound();

  try {
    const orderPath = `${ORDER_PREFIX}${orderId}.json`;
    const { blobs } = await list({ prefix: orderPath, limit: 1 });
    const orderBlob = blobs.find((blob) => blob.pathname === orderPath);
    if (!orderBlob) return notFound();
    const storedOrder = await get(orderBlob.url, { access: 'private', useCache: false });
    if (storedOrder?.statusCode !== 200) return notFound();
    const order = await new Response(storedOrder.stream).json() as { design?: unknown };
    const url = referencePhotoFromDesign(order.design);
    if (!url || !isGarmentReferencePhotoForOrder(order.design, orderId)) return notFound();

    const photo = await get(url, { access: 'private', useCache: false });
    if (photo?.statusCode !== 200 || !photo.stream || !isModelReferenceUrl(photo.blob.url, orderId)) return notFound();
    const contentType = photo.blob.contentType.toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return notFound();
    return new NextResponse(photo.stream, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new NextResponse('Reference photo unavailable', { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
