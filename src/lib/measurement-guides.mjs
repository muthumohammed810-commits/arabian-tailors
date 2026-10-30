export const MEASUREMENT_GUIDE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export function measurementGuideExtensionForMimeType(mimeType) {
  return MIME_EXTENSIONS.get(mimeType) || '';
}

export function isValidMeasurementGuideUpload({ type, size } = {}) {
  return Boolean(
    measurementGuideExtensionForMimeType(type)
    && Number.isFinite(size)
    && size > 0
    && size <= MEASUREMENT_GUIDE_MAX_IMAGE_BYTES,
  );
}

export function measurementGuideImagePath(productId, guideId, filename) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(productId || '')
    || !/^[A-Za-z0-9_-]{1,100}$/.test(guideId || '')
    || !/^[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(filename || '')) return '';
  return `arabian-tailors/measurement-guides/${productId}/${guideId}/${filename}`;
}

export function isMeasurementGuideImagePath(pathname) {
  if (typeof pathname !== 'string' || pathname.length > 300 || pathname.includes('..')) return false;
  const match = /^arabian-tailors\/measurement-guides\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,100})\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/i.exec(pathname);
  return Boolean(match && measurementGuideImagePath(match[1], match[2], match[3]));
}

export function measurementGuideMimeTypeForPath(pathname) {
  const match = /^arabian-tailors\/measurement-guides\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.exec(pathname || '');
  if (!match) return '';
  return ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[match[1].toLowerCase()] || '';
}

export function isMeasurementGuideImageUrl(value, productId, guideId) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'blob.vercel-storage.com' || url.hostname.endsWith('.blob.vercel-storage.com'))) return false;
    const pathname = decodeURIComponent(url.pathname.slice(1));
    const prefix = `arabian-tailors/measurement-guides/${productId}/${guideId}/`;
    return pathname.startsWith(prefix) && isMeasurementGuideImagePath(pathname);
  } catch {
    return false;
  }
}

export function isValidMeasurementGuideList(value, productId) {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set();
  return value.every((guide) => {
    if (!guide || typeof guide !== 'object' || Array.isArray(guide)
      || typeof guide.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(guide.id)
      || ids.has(guide.id)
      || typeof guide.title !== 'string' || !guide.title.trim() || guide.title.length > 120
      || typeof guide.instructions !== 'string' || guide.instructions.length > 1000
      || typeof guide.published !== 'boolean'
      || (guide.image !== undefined && guide.image !== '' && !isMeasurementGuideImageUrl(guide.image, productId, guide.id))) return false;
    ids.add(guide.id);
    return !guide.published || (typeof guide.image === 'string' && guide.image !== '' && isMeasurementGuideImageUrl(guide.image, productId, guide.id));
  });
}

export function publishedMeasurementGuides(value, productId) {
  if (!Array.isArray(value)) return [];
  return value.filter((guide) => {
    if (guide?.published !== true || typeof guide.id !== 'string' || typeof guide.title !== 'string' || typeof guide.image !== 'string' || !guide.image) return false;
    return isMeasurementGuideImageUrl(guide.image, productId, guide.id);
  })
    .map(({ id, title, instructions, image }) => ({ id, title, instructions, image, published: true }));
}

export function replaceMeasurementGuidePhoto(guides, guideId, image, productId) {
  if (!Array.isArray(guides) || !guides.some((guide) => guide?.id === guideId)
    || !guides.some((guide) => guide?.id === guideId && isMeasurementGuideImageUrl(image, productId, guideId))) return null;
  return guides.map((guide) => guide.id === guideId ? { ...guide, image } : guide);
}

export function removeMeasurementGuidePhoto(guides, guideId) {
  if (!Array.isArray(guides) || !guides.some((guide) => guide?.id === guideId)) return null;
  return guides.map((guide) => {
    if (guide.id !== guideId) return guide;
    const { image: _removedImage, ...withoutImage } = guide;
    return { ...withoutImage, published: false };
  });
}

export function deleteMeasurementGuide(guides, guideId) {
  if (!Array.isArray(guides) || !guides.some((guide) => guide?.id === guideId)) return null;
  return guides.filter((guide) => guide.id !== guideId);
}

export function moveMeasurementGuide(guides, guideId, direction) {
  if (!Array.isArray(guides) || ![-1, 1].includes(direction)) return null;
  const index = guides.findIndex((guide) => guide?.id === guideId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= guides.length) return null;
  const next = [...guides];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function hasPublishedMeasurementGuideImage(products, pathname) {
  if (!Array.isArray(products) || !isMeasurementGuideImagePath(pathname)) return false;
  return products.some((product) => /kandura/i.test(String(product?.category || ''))
    && publishedMeasurementGuides(product.measurementGuides, product.id).some((guide) => {
      try { return decodeURIComponent(new URL(guide.image).pathname.slice(1)) === pathname; }
      catch { return false; }
    }));
}
