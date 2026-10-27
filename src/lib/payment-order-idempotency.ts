/** Compare the immutable customer intent for safe retries after a lost response. */
export function isSameOrderIntent(existing: any, incoming: any) {
  if (!existing || !incoming) return false;
  return existing.id === incoming.id
    && existing.customer === incoming.customer
    && existing.product === incoming.product
    && existing.productId === incoming.productId
    && existing.productName === incoming.productName
    && existing.productImage === incoming.productImage
    && existing.basePrice === incoming.basePrice
    && existing.total === incoming.total
    && existing.paymentMethod === incoming.paymentMethod
    && JSON.stringify(existing.delivery) === JSON.stringify(incoming.delivery)
    && JSON.stringify(existing.design) === JSON.stringify(incoming.design);
}
