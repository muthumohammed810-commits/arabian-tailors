export { ABAYA_STANDARD_SIZES, getAbayaCustomerSteps } from './abaya-size-options.mjs';

export const MODEL_REFERENCE_PREFIX = 'arabian-tailors/order-reference-photos/';
/** Backwards-compatible name for existing Abaya uploads and stored URLs. */
export const ABAYA_REFERENCE_PREFIX = MODEL_REFERENCE_PREFIX;
export const ABAYA_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const ABAYA_REFERENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function isValidOrderReference(value: unknown): value is string {
  return typeof value === 'string' && /^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(value);
}

export function isModelReferencePath(pathname: string, orderId: string) {
  if (!isValidOrderReference(orderId)) return false;
  const escapedId = orderId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${MODEL_REFERENCE_PREFIX}${escapedId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|jpeg|png|webp)$`, 'i').test(pathname);
}

/** Backwards-compatible path validator used by older Abaya upload callers. */
export const isAbayaReferencePath = isModelReferencePath;

export function validateModelReferenceFile(file: { type: string; size: number }) {
  if (!(ABAYA_REFERENCE_TYPES as readonly string[]).includes(file.type)) return 'Choose a JPG, PNG, or WebP image.';
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > ABAYA_REFERENCE_MAX_BYTES) return 'Choose an image smaller than 10 MB.';
  return null;
}

export const validateAbayaReferenceFile = validateModelReferenceFile;

export function isModelReferenceUrl(value: unknown, orderId: string) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'blob.vercel-storage.com' || url.hostname.endsWith('.blob.vercel-storage.com'))) return false;
    return isModelReferencePath(decodeURIComponent(url.pathname.slice(1)), orderId);
  } catch {
    return false;
  }
}

export const isAbayaReferenceUrl = isModelReferenceUrl;

export function referencePhotoFromDesign(design: unknown): string | null {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return null;
  const value = (design as { customerReferencePhoto?: unknown }).customerReferencePhoto;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === 'string' ? url : null;
}

export function isGarmentReferencePhotoForOrder(design: unknown, orderId: string, productCategory?: string) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return false;
  const record = design as { productType?: unknown; customerReferencePhoto?: unknown };
  const photo = record.customerReferencePhoto;
  const orderCategory = String(record.productType || '').trim().toLowerCase();
  const expectedCategory = productCategory?.trim().toLowerCase();
  if (!['abaya', 'kandura'].includes(orderCategory) || (expectedCategory && orderCategory !== expectedCategory) || !photo || typeof photo !== 'object' || Array.isArray(photo)) return false;
  const value = photo as { url?: unknown; fileName?: unknown; uploaded?: unknown };
  return isModelReferenceUrl(value.url, orderId)
    && typeof value.fileName === 'string' && value.fileName.trim().length > 0 && value.fileName.length <= 180
    && value.uploaded === true;
}

/** Backwards-compatible validator for existing Abaya orders. */
export function isAbayaReferencePhotoForOrder(design: unknown, orderId: string) {
  return isGarmentReferencePhotoForOrder(design, orderId, 'abaya');
}

/** Strict server-side shape for an Abaya reference order with no catalog product selection. */
export function isPhotoOnlyAbayaReferenceOrder(order: any) {
  const design = order?.design;
  if (!order || order.productId !== undefined || order.productName !== undefined || order.productImage !== undefined || order.basePrice !== undefined
    || !design || design.productId !== undefined || design.productName !== undefined || design.productImage !== undefined
    || String(design.productType || '').trim().toLowerCase() !== 'abaya' || design.basePrice !== 0
    || design.selectedModel !== undefined || !Array.isArray(design.options) || design.options.length !== 0
    || !Array.isArray(design.customization) || design.customization.length !== 0 || design.subtotal !== 0
    || !isAbayaReferencePhotoForOrder(design, String(order.id || ''))) return false;
  const allowedDesignFields = new Set(['productType', 'basePrice', 'options', 'customization', 'customerReferencePhoto', 'note', 'subtotal']);
  return Object.keys(design).every((key) => allowedDesignFields.has(key));
}
