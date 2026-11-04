export function buildAdminStoreResponse<TStore extends object, TOrder, TCustomer, TSummary>(
  store: TStore,
  orders: TOrder[],
  customers: TCustomer[],
  orderSummary: TSummary,
): TStore & { orders: TOrder[]; customers: TCustomer[]; orderSummary: TSummary };
