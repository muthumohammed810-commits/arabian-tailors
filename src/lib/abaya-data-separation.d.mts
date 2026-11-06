export type CatalogRecord = { id: string; category: string; catalogOwner?: 'products'; [key: string]: any };
export type CatalogSplit = { products: CatalogRecord[]; legacyAbayaProducts: CatalogRecord[] };
export type CatalogReplacement =
  | { ok: true; products: CatalogRecord[]; abayaProducts: CatalogRecord[] }
  | { ok: false; code: 'UNCLASSIFIED_ABAYA' | 'CROSS_CATALOG_ID_CONFLICT' | 'INVALID_ABAYA_RECORD' | 'UNKNOWN_CATALOG' };

export function isAbayaRecord(product: unknown): product is CatalogRecord;
export function isUnclassifiedLegacyAbaya(product: unknown): product is CatalogRecord;
export function splitProductRecords(records: CatalogRecord[]): CatalogSplit;
export function replaceProductRecordsPreservingLegacyAbaya(current: CatalogRecord[], submitted: CatalogRecord[]): CatalogRecord[];
export function replaceCatalogCollection(products: CatalogRecord[], abayaProducts: CatalogRecord[], owner: 'products' | 'abaya', submitted: CatalogRecord[]): CatalogReplacement;
export function moveLegacyAbayaToManagement(products: CatalogRecord[], abayaProducts: CatalogRecord[], productId: string): { ok: true; products: CatalogRecord[]; abayaProducts: CatalogRecord[]; moved: CatalogRecord } | { ok: false; code: 'LEGACY_ABAYA_NOT_FOUND' | 'PRODUCT_ID_CONFLICT' };
export function keepLegacyAbayaAsProduct(products: CatalogRecord[], productId: string): { ok: true; products: CatalogRecord[] } | { ok: false; code: 'LEGACY_ABAYA_NOT_FOUND' | 'PRODUCT_ID_CONFLICT' };
export function findRecordAcrossCatalogs(products: CatalogRecord[], abayaProducts: CatalogRecord[], productId: string): CatalogRecord | null;
export function getUniqueCatalogRecordIds(records: CatalogRecord[]): Set<string>;
