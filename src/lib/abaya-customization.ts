export type AbayaStepLike = {
  id: string;
  title: string;
  options: unknown[];
};

/** Keep Abaya's saved choices intact while presenting only its model and size steps. */
export function getAbayaCustomerSteps<Step extends AbayaStepLike>(steps: Step[]) {
  const model = steps.find((step) => /model|abaya\s*style|style/i.test(step.title));
  const size = steps.find((step) => /size|measurement/i.test(step.title));
  return [
    ...(model ? [{ ...model, title: 'Select Abaya Model' }] : []),
    ...(size && size.id !== model?.id ? [{ ...size, title: 'Select Size' }] : []),
  ];
}

export const ABAYA_REFERENCE_PREFIX = 'arabian-tailors/order-reference-photos/';
export const ABAYA_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const ABAYA_REFERENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function isValidOrderReference(value: unknown): value is string {
  return typeof value === 'string' && /^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(value);
}

export function isAbayaReferencePath(pathname: string, orderId: string) {
  if (!isValidOrderReference(orderId)) return false;
  const escapedId = orderId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${ABAYA_REFERENCE_PREFIX}${escapedId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|jpeg|png|webp)$`, 'i').test(pathname);
}

export function validateAbayaReferenceFile(file: { type: string; size: number }) {
  if (!(ABAYA_REFERENCE_TYPES as readonly string[]).includes(file.type)) return 'Choose a JPG, PNG, or WebP image.';
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > ABAYA_REFERENCE_MAX_BYTES) return 'Choose an image smaller than 10 MB.';
  return null;
}

export function isAbayaReferenceUrl(value: unknown, orderId: string) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'blob.vercel-storage.com' || url.hostname.endsWith('.blob.vercel-storage.com'))) return false;
    return isAbayaReferencePath(decodeURIComponent(url.pathname.slice(1)), orderId);
  } catch {
    return false;
  }
}

export function referencePhotoFromDesign(design: unknown): string | null {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return null;
  const value = (design as { customerReferencePhoto?: unknown }).customerReferencePhoto;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === 'string' ? url : null;
}

export function isAbayaReferencePhotoForOrder(design: unknown, orderId: string) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return false;
  const record = design as { productType?: unknown; customerReferencePhoto?: unknown };
  const photo = record.customerReferencePhoto;
  if (String(record.productType || '').toLowerCase() !== 'abaya' || !photo || typeof photo !== 'object' || Array.isArray(photo)) return false;
  const value = photo as { url?: unknown; fileName?: unknown; uploaded?: unknown };
  return isAbayaReferenceUrl(value.url, orderId)
    && typeof value.fileName === 'string' && value.fileName.trim().length > 0 && value.fileName.length <= 180
    && value.uploaded === true;
}
