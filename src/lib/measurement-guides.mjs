export const MEASUREMENT_GUIDE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MEASUREMENT_GUIDE_MAX_VIDEO_BYTES = 250 * 1024 * 1024;

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const VIDEO_MIME_EXTENSIONS = new Map([
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
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

export function measurementGuideVideoExtensionForMimeType(mimeType) {
  return VIDEO_MIME_EXTENSIONS.get(mimeType) || '';
}

export function isValidMeasurementGuideVideoUpload({ type, size } = {}) {
  return Boolean(
    measurementGuideVideoExtensionForMimeType(type)
    && Number.isFinite(size)
    && size > 0
    && size <= MEASUREMENT_GUIDE_MAX_VIDEO_BYTES,
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

export function measurementGuideVideoPath(productId, filename) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(productId || '')
    || !/^[0-9a-f-]{36}\.(?:mp4|webm)$/i.test(filename || '')) return '';
  return `arabian-tailors/measurement-guides/${productId}/video/${filename}`;
}

export function isMeasurementGuideVideoPath(pathname) {
  if (typeof pathname !== 'string' || pathname.length > 300 || pathname.includes('..')) return false;
  const match = /^arabian-tailors\/measurement-guides\/([A-Za-z0-9_-]{1,100})\/video\/([0-9a-f-]{36}\.(?:mp4|webm))$/i.exec(pathname);
  return Boolean(match && measurementGuideVideoPath(match[1], match[2]));
}

export function measurementGuideVideoMimeTypeForPath(pathname) {
  const match = /^arabian-tailors\/measurement-guides\/[A-Za-z0-9_-]{1,100}\/video\/[0-9a-f-]{36}\.(mp4|webm)$/i.exec(pathname || '');
  if (!match) return '';
  return ({ mp4: 'video/mp4', webm: 'video/webm' })[match[1].toLowerCase()] || '';
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

function isMeasurementGuideMediaUrl(value, productId, mediaId, pathValidator) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'blob.vercel-storage.com' || url.hostname.endsWith('.blob.vercel-storage.com'))) return false;
    const pathname = decodeURIComponent(url.pathname.slice(1));
    return pathname.startsWith(`arabian-tailors/measurement-guides/${productId}/${mediaId}/`) && pathValidator(pathname);
  } catch {
    return false;
  }
}

export function isMeasurementGuideVideoUrl(value, productId) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'blob.vercel-storage.com' || url.hostname.endsWith('.blob.vercel-storage.com'))) return false;
    const pathname = decodeURIComponent(url.pathname.slice(1));
    return pathname.startsWith(`arabian-tailors/measurement-guides/${productId}/video/`) && isMeasurementGuideVideoPath(pathname);
  } catch {
    return false;
  }
}

export function isValidMeasurementFields(value, productId) {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set();
  return value.every((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)
      || typeof field.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(field.id) || ids.has(field.id)
      || typeof field.name !== 'string' || !field.name.trim() || field.name.length > 120
      || !['cm', 'inch'].includes(field.unit)
      || (field.required !== undefined && typeof field.required !== 'boolean')
      || (field.available !== undefined && typeof field.available !== 'boolean')
      || (field.photo !== undefined && field.photo !== '' && !isMeasurementGuideImageUrl(field.photo, productId, field.id))
      || (field.photoPublished !== undefined && typeof field.photoPublished !== 'boolean')) return false;
    ids.add(field.id);
    const hasPhoto = typeof field.photo === 'string' && field.photo !== '' && isMeasurementGuideImageUrl(field.photo, productId, field.id);
    return field.photoPublished !== true || hasPhoto;
  });
}

export function isValidMeasurementGuideVideo(value, productId) {
  if (value === null || value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.instructions !== 'string' || value.instructions.length > 1000
    || typeof value.published !== 'boolean'
    || (value.url !== undefined && value.url !== '' && !isMeasurementGuideVideoUrl(value.url, productId))) return false;
  const hasVideo = typeof value.url === 'string' && value.url !== '' && isMeasurementGuideVideoUrl(value.url, productId);
  return value.published !== true || hasVideo;
}

export function publishedMeasurementFields(value, productId, enabled = true) {
  if (!Array.isArray(value)) return [];
  return value.map((field) => {
    const { photoPublished, ...safeField } = field || {};
    const hasPublishedPhoto = enabled && field?.available !== false && photoPublished === true && isMeasurementGuideImageUrl(field?.photo, productId, field?.id);
    if (hasPublishedPhoto) return safeField;
    const { photo: _unpublishedPhoto, ...withoutPhoto } = safeField;
    return withoutPhoto;
  });
}

export function publishedMeasurementGuideVideo(value, productId, enabled = true) {
  if (!enabled || !value || value.published !== true || !isMeasurementGuideVideoUrl(value.url, productId)) return undefined;
  return { url: value.url, instructions: value.instructions, published: true };
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
    && ((product.measurementsEnabled !== false && isValidMeasurementFields(product.measurements, product.id)
      && publishedMeasurementFields(product.measurements, product.id).some((field) => {
        try { return decodeURIComponent(new URL(field.photo).pathname.slice(1)) === pathname; }
        catch { return false; }
      }))
      || publishedMeasurementGuides(product.measurementGuides, product.id).some((guide) => {
      try { return decodeURIComponent(new URL(guide.image).pathname.slice(1)) === pathname; }
      catch { return false; }
    })));
}

export function hasPublishedMeasurementGuideVideo(products, pathname) {
  if (!Array.isArray(products) || !isMeasurementGuideVideoPath(pathname)) return false;
  return products.some((product) => /kandura/i.test(String(product?.category || ''))
    && product.measurementsEnabled !== false
    && publishedMeasurementGuideVideo(product.measurementGuideVideo, product.id)
    && (() => {
      try { return decodeURIComponent(new URL(product.measurementGuideVideo.url).pathname.slice(1)) === pathname; }
      catch { return false; }
    })());
}
