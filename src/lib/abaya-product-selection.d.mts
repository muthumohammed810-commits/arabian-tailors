export type AbayaProductRecord = {
  id: string;
  name: string;
  category: string;
  price: number;
  available?: boolean;
  image?: string;
  images?: string[];
};

export function isAbayaProduct(product: unknown): boolean;
export function isCustomerEligibleAbayaProduct(product: unknown): product is AbayaProductRecord;
export function hasManagedAbayaCatalog(products: readonly unknown[], persistedMarker?: boolean): boolean;
export function getCustomerAbayaProducts<T extends AbayaProductRecord>(products: readonly T[], options?: { managed?: boolean; fallbackProducts?: readonly T[] }): T[];
export function findLegacyAbayaFallback<T extends AbayaProductRecord>(productId: string, products: readonly T[], persistedMarker?: boolean): T | undefined;
export function getAbayaProductOrderSnapshot(product: AbayaProductRecord): { productId: string; productName: string; productImage: string; basePrice: number } | null;
