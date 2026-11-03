export const ABAYA_COLOR_STEP_TITLE = 'Choose Abaya Colour';
export const ABAYA_STANDARD_SIZES = Object.freeze(['S', 'M', 'L', 'XL', 'XXL']);
export const ABAYA_PRODUCT_IMAGE_PREFIX = 'arabian-tailors/abaya-product-images/';
export const ABAYA_PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Legacy products without an availability flag remain visible; explicit false is unpublished. */
export function isCustomerProductAvailable(product) {
  return Boolean(product && product.available !== false);
}

export function abayaProductImagePath(id, mimeType) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : '';
  return extension ? `${ABAYA_PRODUCT_IMAGE_PREFIX}${id}.${extension}` : null;
}

export function isAbayaProductImagePath(pathname) {
  return typeof pathname === 'string' && /^arabian-tailors\/abaya-product-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(pathname);
}

/** Select storage by namespace. Abaya paths never fall back to the shared store. */
export function getProductImageBlobStore(pathname, env = process.env) {
  const isAbayaNamespace = typeof pathname === 'string' && pathname.startsWith(ABAYA_PRODUCT_IMAGE_PREFIX);
  const kind = isAbayaNamespace ? 'abaya' : 'shared';
  const storeIdKey = isAbayaNamespace ? 'ABAYA_BLOB_STORE_ID' : 'BLOB_STORE_ID';
  const token = isAbayaNamespace
    ? (typeof env.ABAYA_BLOB_READ_WRITE_TOKEN === 'string' && typeof env.ABAYA_BLOB_STORE_ID === 'string' && env.ABAYA_BLOB_STORE_ID.length ? env.ABAYA_BLOB_READ_WRITE_TOKEN : null)
    : env.BLOB_READ_WRITE_TOKEN;
  const storeId = typeof env[storeIdKey] === 'string' && env[storeIdKey].length ? env[storeIdKey] : null;
  return { kind, token: typeof token === 'string' && token.length ? token : null, storeId };
}

/** Accept only an Abaya image pathname or a private Vercel Blob URL for that path. */
export function abayaProductImagePathFromUrl(value) {
  if (typeof value !== 'string') return null;
  let pathname = value;
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.hostname.endsWith('.private.blob.vercel-storage.com')) return null;
      pathname = decodeURIComponent(url.pathname.replace(/^\//, ''));
    } catch {
      return null;
    }
  }
  return isAbayaProductImagePath(pathname) ? pathname : null;
}

/** Validate that an uploaded private image URL belongs to the configured Abaya store. */
export function isAbayaProductImageUrlForStore(value, storeId) {
  if (typeof value !== 'string' || typeof storeId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(storeId)) return false;
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === `${storeId}.private.blob.vercel-storage.com`.toLowerCase()
      && isAbayaProductImagePath(pathname);
  } catch {
    return false;
  }
}

/** Find removed Abaya images while keeping any path still referenced by another saved record. */
export function getUnreferencedAbayaProductImagePaths(previousProduct, retainedProducts = []) {
  const collect = (value, paths) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) collect(item, paths);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'image' && typeof item === 'string') {
        const path = abayaProductImagePathFromUrl(item);
        if (path) paths.add(path);
      } else if (key === 'images' && Array.isArray(item)) {
        for (const image of item) {
          const path = abayaProductImagePathFromUrl(image);
          if (path) paths.add(path);
        }
      } else if (item && typeof item === 'object') collect(item, paths);
    }
  };
  const previous = new Set();
  collect(previousProduct, previous);
  const retained = new Set();
  collect(retainedProducts, retained);
  return [...previous].filter(path => !retained.has(path));
}

export function normalizeAbayaProductCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isValidAbayaProductCode(value) {
  return /^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(normalizeAbayaProductCode(value));
}

export function validateAbayaProductCode(product, existingProducts = []) {
  const code = normalizeAbayaProductCode(product?.productCode);
  if (!isValidAbayaProductCode(code)) return 'Enter a product code using 2–32 letters, numbers, hyphens or underscores.';
  if (existingProducts.some((item) => item.id !== product.id && String(item.category || '').trim().toLowerCase() === 'abaya' && normalizeAbayaProductCode(item.productCode) === code)) {
    return 'That Abaya product code is already in use.';
  }
  return null;
}

export function isValidAbayaSalePrice(product) {
  if (product?.salePrice === undefined || product?.salePrice === null || product?.salePrice === '') return true;
  return Number.isFinite(product.salePrice) && product.salePrice >= 0 && product.salePrice <= product.price;
}

export function effectiveAbayaPrice(product) {
  if (!product || !Number.isFinite(product.price) || product.price < 0) return NaN;
  return String(product.category || '').trim().toLowerCase() === 'abaya'
    && isValidAbayaSalePrice(product)
    && Number.isFinite(product.salePrice)
    ? product.salePrice
    : product.price;
}

/** Prefer a selected colour's gallery, falling back to the product's saved gallery. */
export function getAbayaGalleryImages(product, colorOption) {
  const collect = (value) => [
    ...(Array.isArray(value?.images) ? value.images : []),
    ...(typeof value?.image === 'string' ? [value.image] : []),
  ].filter((image) => typeof image === 'string' && image.trim());
  const colorImages = [...new Set(collect(colorOption))];
  return colorImages.length ? colorImages : [...new Set(collect(product))];
}

export function validateAbayaImageFile(file, maxBytes = ABAYA_PRODUCT_IMAGE_MAX_BYTES) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPG, PNG, or WebP image.';
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) return 'Choose an image smaller than 10 MB.';
  return null;
}
