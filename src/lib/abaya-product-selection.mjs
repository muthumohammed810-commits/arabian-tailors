export function isAbayaProduct(product) {
  return Boolean(product && typeof product === 'object' && String(product.category || '').trim().toLowerCase() === 'abaya');
}

export function isCustomerEligibleAbayaProduct(product) {
  return Boolean(isAbayaProduct(product)
    && typeof product.id === 'string' && product.id.trim()
    && typeof product.name === 'string' && product.name.trim()
    && product.available !== false
    && Number.isFinite(product.price) && product.price >= 0);
}

/** A persisted marker prevents a deleted or hidden catalog from being revived by legacy fallback data. */
export function hasManagedAbayaCatalog(products, persistedMarker = false) {
  return persistedMarker === true || (Array.isArray(products) && products.some(isAbayaProduct));
}

export function getCustomerAbayaProducts(products, { managed = false, fallbackProducts = [] } = {}) {
  const eligible = (Array.isArray(products) ? products : []).filter(isCustomerEligibleAbayaProduct);
  if (eligible.length || managed) return eligible;
  return (Array.isArray(fallbackProducts) ? fallbackProducts : []).filter(isCustomerEligibleAbayaProduct);
}

export function findLegacyAbayaFallback(productId, products, persistedMarker = false) {
  if (persistedMarker || !Array.isArray(products)) return undefined;
  return products.find(product => product.id === productId && isCustomerEligibleAbayaProduct(product));
}

export function getAbayaProductOrderSnapshot(product) {
  if (!isCustomerEligibleAbayaProduct(product)) return null;
  return {
    productId: product.id,
    productName: product.name,
    productImage: product.image || product.images?.[0] || '',
    basePrice: product.price,
  };
}

/** Reorder only records in the requested category; mixed catalog entries keep their slots. */
export function moveProductWithinCategory(products, category, productId, direction) {
  if (!Array.isArray(products) || ![-1, 1].includes(direction)) return Array.isArray(products) ? [...products] : [];
  const normalize = (value) => String(value || '').trim().toLowerCase();
  const categoryIndexes = products.flatMap((product, index) => normalize(product?.category) === normalize(category) ? [index] : []);
  const position = categoryIndexes.findIndex((index) => products[index]?.id === productId);
  const targetPosition = position + direction;
  if (position < 0 || targetPosition < 0 || targetPosition >= categoryIndexes.length) return [...products];
  const result = [...products];
  const sourceIndex = categoryIndexes[position];
  const targetIndex = categoryIndexes[targetPosition];
  [result[sourceIndex], result[targetIndex]] = [result[targetIndex], result[sourceIndex]];
  return result;
}
