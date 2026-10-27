export const PENDING_UPI_STATUS = 'Pending verification' as const;

/** Public checkout can only create an unpaid UPI order, regardless of submitted status fields. */
export function getCustomerOrderPaymentFields(order: unknown) {
  if (!order || typeof order !== 'object' || (order as { paymentMethod?: unknown }).paymentMethod !== 'upi') return null;
  return { paymentMethod: 'upi' as const, statusPayment: PENDING_UPI_STATUS };
}
