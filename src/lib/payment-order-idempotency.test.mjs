import assert from 'node:assert/strict';
import test from 'node:test';
import { isSameOrderIntent } from './payment-order-idempotency.ts';
import { customerPaymentAmount, remainingAfterReferenceAdvance } from './custom-reference-order.ts';

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

test('WhatsApp contact permission is part of the immutable order intent', () => {
  assert.equal(isSameOrderIntent(makeOrder({ whatsappConsent: { customerUpdates: true } }), makeOrder({ whatsappConsent: { customerUpdates: false } })), false);
  assert.equal(isSameOrderIntent(makeOrder({ whatsappConsent: { customerUpdates: true } }), makeOrder({ whatsappConsent: { customerUpdates: true, capturedAt: 'later' } })), true);
});

test('custom reference order retry stays idempotent after Admin confirms a final price', () => {
  const incoming = makeOrder({ orderType: 'custom_reference_photo', estimatedTotal: 3200, advanceAmount: 500, finalPrice: null });
  const existing = makeOrder({ orderType: 'custom_reference_photo', estimatedTotal: 3200, advanceAmount: 500, finalPrice: 6500, finalPriceConfirmed: true, total: 6500, statusPayment: 'Paid' });
  assert.equal(isSameOrderIntent(existing, incoming), true);
  assert.equal(isSameOrderIntent(existing, { ...incoming, advanceAmount: 600 }), false);
});

test('replaying an Abaya reference-photo checkout reuses the existing single ₹500 payment record', () => {
  const id = 'AT-ffeeddccbbaa99887766554433221100';
  const design = {
    productType: 'Abaya',
    productId: 'abaya-noor',
    productName: 'Noor Abaya',
    basePrice: 1500,
    options: [],
    customization: [],
    selectedModel: { id: 'noor-model', name: 'Noor Abaya', basePrice: 1500 },
    customerReferencePhoto: { url: `https://store.blob.vercel-storage.com/arabian-tailors/order-reference-photos/${id}/123e4567-e89b-12d3-a456-426614174000.jpg`, fileName: 'reference.jpg', uploaded: true },
    subtotal: 1500,
  };
  const incoming = makeOrder({ id, product: 'Noor Abaya', productId: 'abaya-noor', productName: 'Noor Abaya', productImage: 'https://example.invalid/noor.jpg', basePrice: 1500, subtotal: 1500, deliveryFee: 60, total: 1560, orderType: 'custom_reference_photo', estimatedTotal: 1560, estimatedBalanceAfterAdvance: remainingAfterReferenceAdvance(1500), advanceAmount: 500, design });
  const existing = { ...incoming, paymentAmount: 500, statusPayment: 'Paid', paidAt: '2026-11-06T09:00:00.000Z' };
  assert.equal(isSameOrderIntent(existing, incoming), true, 'retry with the same order reference returns the saved order instead of creating a second one');
  assert.equal(customerPaymentAmount(existing), 500, 'the saved reference order still exposes exactly one advance amount');
  assert.equal(existing.estimatedBalanceAfterAdvance, 1000, 'the ₹500 advance was deducted from the ₹1,500 model total');
  assert.equal(customerPaymentAmount({ ...existing, advanceAmount: 501 }), null);
});
