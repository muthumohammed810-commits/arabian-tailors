const normalizeCategory = (product) => String(product?.category || '').trim().toLowerCase();

export function isAbayaRecord(product) {
  return Boolean(product && typeof product === 'object' && normalizeCategory(product) === 'abaya');
}

/** Legacy Abaya rows stay byte-for-byte in the old array until an Admin classifies them. */
export function isUnclassifiedLegacyAbaya(product) {
  return isAbayaRecord(product) && product.catalogOwner !== 'products';
}

export function splitProductRecords(records) {
  const source = Array.isArray(records) ? records : [];
  return {
    products: source.filter((record) => !isUnclassifiedLegacyAbaya(record)),
    legacyAbayaProducts: source.filter(isUnclassifiedLegacyAbaya),
  };
}

/** Replace only Product-owned records, preserving each legacy Abaya record and its slot. */
export function replaceProductRecordsPreservingLegacyAbaya(current, submitted) {
  const existing = Array.isArray(current) ? current : [];
  const nextProducts = Array.isArray(submitted) ? submitted.filter((record) => !isUnclassifiedLegacyAbaya(record)) : [];
  let nextIndex = 0;
  const merged = existing.map((record) => {
    if (isUnclassifiedLegacyAbaya(record)) return record;
    return nextProducts[nextIndex++] ?? null;
  }).filter(Boolean);
  merged.push(...nextProducts.slice(nextIndex));
  return merged;
}

/** Replace exactly one catalog while leaving the other catalog object untouched. */
export function replaceCatalogCollection(products, abayaProducts, owner, submitted) {
  const currentProducts = Array.isArray(products) ? products : [];
  const currentAbayaProducts = Array.isArray(abayaProducts) ? abayaProducts : [];
  const next = Array.isArray(submitted) ? submitted : [];
  if (owner === 'products') {
    if (next.some((record) => isUnclassifiedLegacyAbaya(record))) return { ok: false, code: 'UNCLASSIFIED_ABAYA' };
    if (next.some((record) => currentAbayaProducts.some((abaya) => abaya?.id === record?.id))) return { ok: false, code: 'CROSS_CATALOG_ID_CONFLICT' };
    return {
      ok: true,
      products: replaceProductRecordsPreservingLegacyAbaya(currentProducts, next),
      abayaProducts: currentAbayaProducts,
    };
  }
  if (owner === 'abaya') {
    if (next.some((record) => !isAbayaRecord(record) || record.catalogOwner !== undefined)) return { ok: false, code: 'INVALID_ABAYA_RECORD' };
    if (new Set(next.map((record) => record.id)).size !== next.length
      || next.some((record) => currentProducts.some((product) => product?.id === record?.id))) {
      return { ok: false, code: 'CROSS_CATALOG_ID_CONFLICT' };
    }
    return { ok: true, products: currentProducts, abayaProducts: next };
  }
  return { ok: false, code: 'UNKNOWN_CATALOG' };
}

/** Explicit, reversible-in-content transfer. IDs and all nested data are retained unchanged. */
export function moveLegacyAbayaToManagement(products, abayaProducts, productId) {
  const source = Array.isArray(products) ? products : [];
  const target = Array.isArray(abayaProducts) ? abayaProducts : [];
  const legacy = source.find((record) => record?.id === productId && isUnclassifiedLegacyAbaya(record));
  if (!legacy) return { ok: false, code: 'LEGACY_ABAYA_NOT_FOUND' };
  if (target.some((record) => record?.id === productId) || source.some((record) => record?.id === productId && record !== legacy)) {
    return { ok: false, code: 'PRODUCT_ID_CONFLICT' };
  }
  return {
    ok: true,
    products: source.filter((record) => record !== legacy),
    abayaProducts: [...target, legacy],
    moved: legacy,
  };
}

/** Explicitly retain a legacy Abaya as a standalone Product; does not copy or publish new data. */
export function keepLegacyAbayaAsProduct(products, productId) {
  const source = Array.isArray(products) ? products : [];
  const matches = source.filter((record) => record?.id === productId);
  if (matches.length !== 1 || !isUnclassifiedLegacyAbaya(matches[0])) return { ok: false, code: matches.length > 1 ? 'PRODUCT_ID_CONFLICT' : 'LEGACY_ABAYA_NOT_FOUND' };
  const next = source.map((record) => {
    if (record?.id !== productId || !isUnclassifiedLegacyAbaya(record)) return record;
    return { ...record, catalogOwner: 'products' };
  });
  return { ok: true, products: next };
}

/** Reject ambiguous IDs rather than letting an operation mutate whichever collection wins. */
export function findRecordAcrossCatalogs(products, abayaProducts, productId) {
  const matches = [...(Array.isArray(products) ? products : []), ...(Array.isArray(abayaProducts) ? abayaProducts : [])]
    .filter((record) => record?.id === productId);
  return matches.length === 1 ? matches[0] : null;
}

export function getUniqueCatalogRecordIds(records) {
  const counts = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (typeof record?.id === 'string') counts.set(record.id, (counts.get(record.id) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([id]) => id));
}
