import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpiPaymentUrl } from './upi-payment.ts';
import {
  createCustomReferenceOrderFields,
  customerPaymentAmount,
  CUSTOM_REFERENCE_ADVANCE,
  isRequiredCustomizationSelectionMissing,
  updateCustomReferenceFinalPrice,
} from './custom-reference-order.ts';

test('verified photo order gets an independent INR 500 pending advance and preserves the estimate', () => {
  const terms = createCustomReferenceOrderFields(4260);
  assert.equal(terms.estimatedTotal, 4260);
  assert.equal(terms.advanceAmount, 500);
  assert.equal(terms.advanceStatus, 'Pending verification');
  assert.equal(terms.finalPrice, null);
  assert.equal(terms.finalPriceConfirmed, false);
  assert.equal(terms.remainingBalance, null);
  const paymentAmount = customerPaymentAmount({ orderType: terms.orderType, advanceAmount: terms.advanceAmount, total: terms.estimatedTotal });
  assert.equal(paymentAmount, CUSTOM_REFERENCE_ADVANCE);
  const paymentUrl = createUpiPaymentUrl('atelier@example', paymentAmount, 'AT-123456');
  assert.equal(new URL(paymentUrl.replace('upi://', 'https://')).searchParams.get('am'), '500.00');
});

test('regular order still requests its verified full total and does not acquire advance fields', () => {
  assert.equal(customerPaymentAmount({ orderType: 'standard', total: 4260 }), 4260);
  assert.equal(customerPaymentAmount({ orderType: 'standard', total: -1 }), null);
});

test('Abaya and Kandura model/style selection is optional, while other required choices stay required', () => {
  for (const garment of ['Abaya', 'Kandura']) {
    assert.equal(isRequiredCustomizationSelectionMissing(true, false, true, false), false, `${garment} model may be skipped`);
    assert.equal(isRequiredCustomizationSelectionMissing(true, false, true, true), true, `${garment} photo upload must finish before leaving its step`);
    assert.equal(isRequiredCustomizationSelectionMissing(true, false, false, false), true, `${garment} required size/options remain required`);
    assert.equal(isRequiredCustomizationSelectionMissing(true, true, false, false), false);
  }
});

test('final price remains unset until an explicit valid Admin confirmation', () => {
  const order = { ...createCustomReferenceOrderFields(4260), statusPayment: 'Pending verification' };
  assert.equal(updateCustomReferenceFinalPrice(order, { finalPrice: 6500, finalPriceConfirmed: false }).finalPrice, null);
  assert.equal(updateCustomReferenceFinalPrice(order, { finalPrice: 499, finalPriceConfirmed: true }), null);
  assert.equal(updateCustomReferenceFinalPrice(order, { finalPrice: 6500.001, finalPriceConfirmed: true }), null);
});

test('remaining balance appears only when final price is confirmed and advance is verified paid', () => {
  const order = { ...createCustomReferenceOrderFields(4260), statusPayment: 'Pending verification' };
  const awaitingAdvance = updateCustomReferenceFinalPrice(order, { finalPrice: 6500, finalPriceConfirmed: true });
  assert.equal(awaitingAdvance.total, 6500);
  assert.equal(awaitingAdvance.remainingBalance, null);
  const paidAdvance = updateCustomReferenceFinalPrice({ ...order, statusPayment: 'Paid' }, { finalPrice: 6500, finalPriceConfirmed: true }, 'Paid');
  assert.equal(paidAdvance.advanceStatus, 'Paid');
  assert.equal(paidAdvance.remainingBalance, 6000);
});

test('clearing Admin confirmation safely restores the original estimate', () => {
  const initial = { ...createCustomReferenceOrderFields(4260), statusPayment: 'Pending verification' };
  const confirmed = updateCustomReferenceFinalPrice(initial, { finalPrice: 6500, finalPriceConfirmed: true });
  const cleared = updateCustomReferenceFinalPrice(confirmed, { finalPriceConfirmed: false });
  assert.equal(cleared.total, 4260);
  assert.equal(cleared.finalPrice, null);
  assert.equal(cleared.remainingBalance, null);
});
