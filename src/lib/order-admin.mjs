const PAYMENT_PAID = new Set(['Paid']);
const PAYMENT_UNPAID = new Set(['Unpaid']);
const PAYMENT_PENDING = new Set(['Pending', 'Pending verification']);
const PAYMENT_STATUSES = new Set(['Paid', 'Unpaid', 'Pending', 'Pending verification', 'Failed', 'Refunded']);
const PAYMENT_REVIEWABLE = new Set(['Pending verification', 'Pending', 'Unpaid']);
export function normalizePaymentStatus(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Pending verification';
  return value.trim().slice(0, 100);
}

export function initialCustomerOrderStatus(_submittedStatus) {
  return 'New';
}

export function isUntrackedDeliveryStatusTransition(currentStatus, nextStatus) {
  return typeof nextStatus === 'string'
    && nextStatus !== currentStatus
    && (currentStatus === 'Delivered' || nextStatus === 'Delivered');
}

export function canReviewPaymentStatus(current, next) {
  return typeof next === 'string' && PAYMENT_STATUSES.has(next)
    && PAYMENT_REVIEWABLE.has(typeof current === 'string' && current ? current : 'Pending verification')
    && next !== 'Pending verification';
}

export function paymentAuditFields(order) {
  return {
    ...(typeof order?.paymentAmount === 'number' && Number.isFinite(order.paymentAmount) && order.paymentAmount >= 0 ? { paymentAmount: order.paymentAmount } : {}),
    ...(typeof order?.paidAt === 'string' && order.paidAt ? { paidAt: order.paidAt } : {}),
    ...(typeof order?.paymentDate === 'string' && order.paymentDate ? { paymentDate: order.paymentDate } : {}),
  };
}

export function recordPaymentConfirmation(order, expectedAmount, confirmedAt) {
  if (order?.statusPayment === 'Paid') return order;
  const amount = typeof order?.paymentAmount === 'number' && Number.isFinite(order.paymentAmount) && order.paymentAmount >= 0
    ? order.paymentAmount
    : expectedAmount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || typeof confirmedAt !== 'string' || !confirmedAt) return null;
  const recordedAt = order?.paidAt || order?.paymentDate || confirmedAt;
  return {
    ...order,
    paymentAmount: amount,
    paidAt: order?.paidAt || recordedAt,
    paymentDate: order?.paymentDate || recordedAt,
  };
}

export function summarizeOrders(orders = []) {
  return orders.reduce((counts, order) => {
    const status = String(order?.statusPayment || 'Pending verification');
    if (PAYMENT_PAID.has(status)) counts.paid += 1;
    else if (PAYMENT_UNPAID.has(status)) counts.unpaid += 1;
    else if (PAYMENT_PENDING.has(status)) counts.pending += 1;
    return counts;
  }, { paid: 0, unpaid: 0, pending: 0 });
}

export function paidOrderCustomerEntries(orders = []) {
  return orders
    .filter(order => PAYMENT_PAID.has(String(order?.statusPayment || '')) && order?.status !== 'Cancelled' && order?.statusPayment !== 'Refunded')
    .map(order => ({
      id: String(order.id), orderId: String(order.id), name: order.customer || order.delivery?.name || '',
      phone: order.delivery?.phone || '', address: order.delivery?.address || '', city: order.delivery?.city || '',
      postal: order.delivery?.postal || '', product: order.productName || order.product || '',
      amountPaid: typeof order.paymentAmount === 'number' && Number.isFinite(order.paymentAmount) && order.paymentAmount >= 0 ? order.paymentAmount : null,
      paymentDate: order.paidAt || order.paymentDate || null,
      paymentStatus: order.statusPayment, deliveryStatus: order.status || 'New',
      email: order.delivery?.email || '',
    }));
}

export function updateDeliveryStatus(order, delivered, actor, now = new Date().toISOString()) {
  if (order?.status === 'Cancelled') return { changed: false, order, reason: 'cancelled' };
  const current = order?.status === 'Delivered';
  if (current === delivered) return { changed: false, order };
  const history = Array.isArray(order.deliveryHistory) ? order.deliveryHistory : [];
  const event = { status: delivered ? 'Delivered' : 'Ready to ship', at: now, ...(actor ? { admin: actor } : {}) };
  return { changed: true, order: { ...order, status: event.status, deliveredAt: delivered ? now : null, deliveryHistory: [...history, event] } };
}
