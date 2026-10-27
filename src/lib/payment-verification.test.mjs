import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { applyVerifiedPaymentEvent, verifyPaymentWebhookSignature } from './payment-verification.ts';

const secret = 'test-only-provider-webhook-secret';
const sign = (body) => createHmac('sha256', secret).update(body).digest('hex');
const order = (overrides = {}) => ({ id: 'AT-001122', total: 2850, statusPayment: 'Pending verification', ...overrides });
const event = (overrides = {}) => ({ eventId: 'evt_001', paymentId: 'pay_001', orderId: 'AT-001122', amount: 2850, currency: 'INR', status: 'success', ...overrides });

test('new order remains pending until a verified event is applied', () => {
  assert.equal(applyVerifiedPaymentEvent(order(), event({ status: 'pending' }), true).statusPayment, 'Pending verification');
});

test('verified success marks a matching order paid', () => {
  const result = applyVerifiedPaymentEvent(order(), event(), true);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.statusPayment, 'Paid');
});

test('verified failure and cancellation remain distinct outcomes', () => {
  assert.equal(applyVerifiedPaymentEvent(order(), event({ status: 'failed' }), true).statusPayment, 'Failed');
  assert.equal(applyVerifiedPaymentEvent(order(), event({ status: 'cancelled' }), true).statusPayment, 'Cancelled');
});

test('invalid signature is rejected without changing payment status', () => {
  const body = JSON.stringify(event());
  assert.equal(verifyPaymentWebhookSignature(body, sign(body), secret), true);
  assert.equal(verifyPaymentWebhookSignature(body, '0'.repeat(64), secret), false);
  assert.equal(applyVerifiedPaymentEvent(order(), event(), false).outcome, 'invalid-signature');
});

test('amount and order references must exactly match the pending order', () => {
  assert.equal(applyVerifiedPaymentEvent(order(), event({ amount: 2851 }), true).outcome, 'amount-mismatch');
  assert.equal(applyVerifiedPaymentEvent(order(), event({ orderId: 'AT-wrong' }), true).outcome, 'invalid-event');
});

test('duplicate callback IDs are idempotent and paid orders cannot regress', () => {
  assert.equal(applyVerifiedPaymentEvent(order({ processedPaymentEventIds: ['evt_001'] }), event(), true).outcome, 'duplicate');
  assert.equal(applyVerifiedPaymentEvent(order({ statusPayment: 'Paid' }), event({ eventId: 'evt_late', status: 'failed' }), true).outcome, 'ignored-terminal');
});
