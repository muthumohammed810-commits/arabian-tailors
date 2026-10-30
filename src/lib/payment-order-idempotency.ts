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
    && existing.subtotal === incoming.subtotal
    && existing.deliveryFee === incoming.deliveryFee
    && (existing.discount || 0) === (incoming.discount || 0)
    // Custom-reference orders may receive an Admin-confirmed final total later;
    // retries still compare against the immutable estimate from creation.
    && (existing.estimatedTotal ?? existing.total) === (incoming.estimatedTotal ?? incoming.total)
    && (existing.orderType || 'standard') === (incoming.orderType || 'standard')
    && (existing.advanceAmount ?? null) === (incoming.advanceAmount ?? null)
    && existing.paymentMethod === incoming.paymentMethod
    && (existing.whatsappConsent?.customerUpdates === true) === (incoming.whatsappConsent?.customerUpdates === true)
    && JSON.stringify(existing.delivery) === JSON.stringify(incoming.delivery)
    && JSON.stringify(existing.design) === JSON.stringify(incoming.design);
}
