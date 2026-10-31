import { isMeasurementGuideImagePath, isMeasurementGuideVideoPath } from './measurement-guides.mjs';

const PRIVATE_BLOB_HOST_SUFFIX = '.private.blob.vercel-storage.com';
const PRODUCT_IMAGE_PREFIX = 'arabian-tailors/product-images/';
const PRODUCT_IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}\.(?:jpg|png|webp|gif)$/i;

/** The connected Vercel Blob store is private; uploads must use matching access. */
export const productImageBlobAccess = 'private' as const;

/** Public storefront delivery is limited to immutable images in the product-images folder. */
export function isPublicProductImagePath(pathname: string): boolean {
  if (!pathname.startsWith(PRODUCT_IMAGE_PREFIX)) return false;
  const filename = pathname.slice(PRODUCT_IMAGE_PREFIX.length);
  return PRODUCT_IMAGE_FILE.test(filename) && !filename.includes('..');
}

/** Turn private Blob URLs into the app's narrowly scoped public image proxy URL. */
export function productImageSource(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith(PRIVATE_BLOB_HOST_SUFFIX)) return value;
    const pathname = decodeURIComponent(url.pathname.slice(1));
    if (!isPublicProductImagePath(pathname) && !isMeasurementGuideImagePath(pathname) && !isMeasurementGuideVideoPath(pathname)) return value;
    return `/api/product-image?pathname=${encodeURIComponent(pathname)}`;
  } catch {
    return value;
  }
}
