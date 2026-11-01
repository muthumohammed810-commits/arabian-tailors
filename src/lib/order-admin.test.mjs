import assert from 'node:assert/strict';
import test from 'node:test';
import { canReviewPaymentStatus, initialCustomerOrderStatus, isUntrackedDeliveryStatusTransition, normalizePaymentStatus, paidOrderCustomerEntries, paymentAuditFields, recordPaymentConfirmation, summarizeOrders, updateDeliveryStatus } from './order-admin.mjs';

const orders = [
  { id: 'a', customer: 'Same', total: 100, statusPayment: 'Paid', status: 'New', delivery: { phone: '1' } },
  { id: 'b', customer: 'Same', total: 200, statusPayment: 'Paid', status: 'Delivered', paidAt: '2026-01-01', delivery: { phone: '1' } },
  { id: 'c', statusPayment: 'Pending verification' }, { id: 'd', statusPayment: 'Unpaid' },
  { id: 'e', statusPayment: 'Failed' }, { id: 'f', statusPayment: 'Refunded' },
];

test('payment summary counts individual canonical orders once', () => assert.deepEqual(summarizeOrders(orders), { paid: 2, unpaid: 1, pending: 1 }));
test('each paid order becomes a separate customer entry, without merging repeat customers', () => {
  const entries = paidOrderCustomerEntries(orders);
  assert.deepEqual(entries.map(entry => entry.orderId), ['a', 'b']);
  assert.equal(entries[0].name, entries[1].name);
  assert.equal(entries[1].deliveryStatus, 'Delivered');
});
test('failed, pending, unpaid, refunded and cancelled orders are excluded from Customers', () => {
  assert.deepEqual(paidOrderCustomerEntries([...orders, { id: 'g', statusPayment: 'Paid', status: 'Cancelled' }]).map(x => x.id), ['a', 'b']);
});
test('delivery confirmation is idempotent, timestamps changes, and preserves payment state', () => {
  const paid = { id: 'a', statusPayment: 'Paid', status: 'Ready to ship' };
  const marked = updateDeliveryStatus(paid, true, 'admin@example.test', '2026-10-31T00:00:00.000Z');
  assert.equal(marked.order.statusPayment, 'Paid');
  assert.equal(marked.order.deliveredAt, '2026-10-31T00:00:00.000Z');
  assert.equal(updateDeliveryStatus(marked.order, true).changed, false);
  const corrected = updateDeliveryStatus(marked.order, false, 'admin@example.test', '2026-11-01T00:00:00.000Z');
  assert.equal(corrected.order.status, 'Ready to ship');
  assert.equal(corrected.order.deliveryHistory.length, 2);
});

test('preserves every supported payment status and keeps unknown statuses distinguishable', () => {
  for (const status of ['Paid', 'Unpaid', 'Pending', 'Pending verification', 'Failed', 'Refunded']) {
    assert.equal(normalizePaymentStatus(status), status);
  }
  assert.equal(normalizePaymentStatus('Gateway review'), 'Gateway review');
  assert.deepEqual(summarizeOrders([
    { statusPayment: 'Paid' }, { statusPayment: 'Unpaid' }, { statusPayment: 'Pending' },
    { statusPayment: 'Pending verification' }, { statusPayment: 'Failed' }, { statusPayment: 'Refunded' },
    { statusPayment: 'Gateway review' },
  ]), { paid: 1, unpaid: 1, pending: 2 });
});

test('payment review can resolve pending and unpaid states but cannot rewrite final or unknown states', () => {
  assert.equal(canReviewPaymentStatus('Pending verification', 'Paid'), true);
  assert.equal(canReviewPaymentStatus('Pending', 'Paid'), true);
  assert.equal(canReviewPaymentStatus('Unpaid', 'Failed'), true);
  assert.equal(canReviewPaymentStatus('Paid', 'Refunded'), false);
  assert.equal(canReviewPaymentStatus('Gateway review', 'Paid'), false);
});

test('safe payment fields retain actual amount and dates without inventing absent values', () => {
  assert.deepEqual(paymentAuditFields({ paymentAmount: 500, paidAt: '2026-10-30T12:00:00.000Z', paymentDate: '2026-10-30T12:00:00.000Z' }), {
    paymentAmount: 500, paidAt: '2026-10-30T12:00:00.000Z', paymentDate: '2026-10-30T12:00:00.000Z',
  });
  assert.deepEqual(paymentAuditFields({ total: 900, orderType: 'custom_reference_photo', estimatedTotal: 900 }), {});
});

test('paid customer entries use only recorded amount, never custom-order estimate', () => {
  const [entry] = paidOrderCustomerEntries([{
    id: 'custom', customer: 'A', total: 2400, estimatedTotal: 2400, advanceAmount: 500,
    orderType: 'custom_reference_photo', statusPayment: 'Paid', status: 'New',
  }]);
  assert.equal(entry.amountPaid, null);
  assert.equal(entry.paymentDate, null);
});

test('server payment confirmation records the confirmed payable amount and timestamp', () => {
  const confirmed = recordPaymentConfirmation({ id: 'regular', total: 1200, statusPayment: 'Pending verification' }, 1200, '2026-10-31T10:00:00.000Z');
  assert.equal(confirmed.paymentAmount, 1200);
  assert.equal(confirmed.paidAt, '2026-10-31T10:00:00.000Z');
  assert.equal(confirmed.paymentDate, '2026-10-31T10:00:00.000Z');
  const advance = recordPaymentConfirmation({ id: 'custom', total: 2400, statusPayment: 'Pending verification' }, 500, '2026-10-31T10:00:00.000Z');
  assert.equal(advance.paymentAmount, 500);
});

test('existing recorded payment amount and date are preserved on confirmation', () => {
  const confirmed = recordPaymentConfirmation({
    statusPayment: 'Pending verification', paymentAmount: 475, paidAt: '2026-10-20T10:00:00.000Z',
  }, 500, '2026-10-31T10:00:00.000Z');
  assert.equal(confirmed.paymentAmount, 475);
  assert.equal(confirmed.paidAt, '2026-10-20T10:00:00.000Z');
  assert.equal(confirmed.paymentDate, '2026-10-20T10:00:00.000Z');
});

test('cancelled orders cannot enter or change delivery status', () => {
  const cancelled = { id: 'cancelled', status: 'Cancelled', statusPayment: 'Pending verification' };
  assert.deepEqual(updateDeliveryStatus(cancelled, true, 'admin@example.test'), { changed: false, order: cancelled, reason: 'cancelled' });
  assert.deepEqual(updateDeliveryStatus(cancelled, false, 'admin@example.test'), { changed: false, order: cancelled, reason: 'cancelled' });
});

test('customer-submitted order status never sets an order to Delivered or another admin state', () => {
  for (const submitted of ['New', 'In production', 'Ready to ship', 'Delivered', 'Cancelled']) {
    assert.equal(initialCustomerOrderStatus(submitted), 'New');
  }
});

test('delivery status transitions must use the audited delivery action', () => {
  assert.equal(isUntrackedDeliveryStatusTransition('New', 'Delivered'), true);
  assert.equal(isUntrackedDeliveryStatusTransition('Cancelled', 'Delivered'), true);
  assert.equal(isUntrackedDeliveryStatusTransition('Delivered', 'Ready to ship'), true);
  assert.equal(isUntrackedDeliveryStatusTransition('Delivered', 'Cancelled'), true);
  assert.equal(isUntrackedDeliveryStatusTransition('New', 'In production'), false);
  assert.equal(isUntrackedDeliveryStatusTransition('Delivered', 'Delivered'), false);
});
