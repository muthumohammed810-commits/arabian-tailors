/** Keep authenticated Admin reads on the complete private store record. */
export function buildAdminStoreResponse(store, orders, customers, orderSummary) {
  return { ...store, orders, customers, orderSummary };
}
