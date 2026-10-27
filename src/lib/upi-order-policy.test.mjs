import assert from 'node:assert/strict';
import test from 'node:test';
import { getCustomerOrderPaymentFields } from './upi-order-policy.ts';

test('customer UPI orders are always created pending payment', () => {
  assert.deepEqual(getCustomerOrderPaymentFields({ paymentMethod: 'upi' }), {
    paymentMethod: 'upi',
    statusPayment: 'Pending verification',
  });
});

test('customer cannot choose another method or submit a paid status', () => {
  assert.equal(getCustomerOrderPaymentFields({ paymentMethod: 'card' }), null);
  assert.equal(getCustomerOrderPaymentFields({ paymentMethod: 'cod' }), null);
  assert.deepEqual(getCustomerOrderPaymentFields({ paymentMethod: 'upi', statusPayment: 'Paid' }), {
    paymentMethod: 'upi',
    statusPayment: 'Pending verification',
  });
  assert.equal(getCustomerOrderPaymentFields(undefined), null);
});
