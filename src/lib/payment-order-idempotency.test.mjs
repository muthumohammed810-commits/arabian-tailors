import assert from 'node:assert/strict';
import test from 'node:test';
import { isSameOrderIntent } from './payment-order-idempotency.ts';

const makeOrder = (overrides = {}) => ({
  id: 'AT-00112233445566778899aabbccddeeff',
  customer: 'A Customer',
  product: 'Signature Kandura · Saudi · Ivory',
  productId: 'kandura-signature',
  productName: 'The Signature Kandura',
  productImage: 'https://example.invalid/kandura.jpg',
  basePrice: 2850,
  subtotal: 3000,
  deliveryFee: 200,
  discount: 0,
  total: 3200,
  paymentMethod: 'upi',
  delivery: { email: 'a@example.com', phone: '9999999999', address: '1 Main Road', city: 'Kochi', postal: '682001' },
  design: { selectedModel: { id: 'saudi', name: 'Saudi Kandura' }, customization: [{ step: 'Colour', option: 'Ivory', priceAdjustment: 0 }] },
  statusPayment: 'Pending verification',
  ...overrides,
});

test('replayed identical create request is idempotent even after payment review', () => {
  assert.equal(isSameOrderIntent(makeOrder({ statusPayment: 'Paid' }), makeOrder()), true);
});

test('same reference with a different amount, delivery, or selected design is not a duplicate', () => {
  assert.equal(isSameOrderIntent(makeOrder(), makeOrder({ total: 3100 })), false);
  assert.equal(isSameOrderIntent(makeOrder(), makeOrder({ deliveryFee: 150 })), false);
  assert.equal(isSameOrderIntent(makeOrder(), makeOrder({ delivery: { ...makeOrder().delivery, city: 'Thrissur' } })), false);
  assert.equal(isSameOrderIntent(makeOrder(), makeOrder({ design: { selectedModel: { id: 'emirati', name: 'Emirati Kandura' } } })), false);
});

test('different order references are never treated as the same order', () => {
  assert.equal(isSameOrderIntent(makeOrder(), makeOrder({ id: 'AT-ffeeddccbbaa99887766554433221100' })), false);
});
