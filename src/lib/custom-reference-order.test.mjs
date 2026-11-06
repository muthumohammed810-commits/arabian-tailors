import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createUpiPaymentUrl } from './upi-payment.ts';
import { isAbayaReferencePhotoForOrder, isPhotoOnlyAbayaReferenceOrder } from './abaya-customization.ts';
import {
  createCustomReferenceOrderFields,
  customerPaymentAmount,
  CUSTOM_REFERENCE_ADVANCE,
  canContinueAbayaReferenceChoice,
  isRequiredCustomizationSelectionMissing,
  remainingAfterReferenceAdvance,
  updateCustomReferenceFinalPrice,
} from './custom-reference-order.ts';

const storeRouteSource = readFileSync(new URL('../app/api/store-data/route.ts', import.meta.url), 'utf8');

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

test('initial Abaya selection can continue with an uploaded reference photo and no model', () => {
  assert.equal(canContinueAbayaReferenceChoice(false, false, false), false);
  assert.equal(canContinueAbayaReferenceChoice(false, true, true), false, 'wait until upload completes');
  assert.equal(canContinueAbayaReferenceChoice(false, true, false), true, 'photo-only request is selectable');
  assert.equal(canContinueAbayaReferenceChoice(true, false, false), true, 'a selected Abaya remains valid');
});

test('an attached Abaya reference photo makes only that order an exact INR 500 advance order', () => {
  const id = `AT-${'b'.repeat(32)}`;
  const design = {
    productType: 'Abaya',
    customerReferencePhoto: {
      url: `https://store.blob.vercel-storage.com/arabian-tailors/order-reference-photos/${id}/123e4567-e89b-12d3-a456-426614174000.jpg`,
      fileName: 'abaya-reference.jpg',
      uploaded: true,
    },
  };
  assert.equal(isAbayaReferencePhotoForOrder(design, id), true);
  const orderFields = createCustomReferenceOrderFields(4820);
  assert.equal(orderFields.advanceAmount, 500);
  assert.equal(customerPaymentAmount({ ...orderFields, total: 4820 }), 500);
  assert.equal(customerPaymentAmount({ orderType: 'standard', total: 4820 }), 4820, 'without a reference photo, standard checkout keeps its full total');
  assert.equal(customerPaymentAmount({ orderType: 'custom_reference_photo', advanceAmount: 501, total: 4820 }), null, 'a manipulated advance is rejected');
});

test('Abaya remaining balance subtracts the included advance from the actual selected model total', () => {
  assert.equal(remainingAfterReferenceAdvance(1500), 1000);
  assert.equal(remainingAfterReferenceAdvance(2750.75), 2250.75);
  assert.equal(remainingAfterReferenceAdvance(500), 0);
  assert.equal(remainingAfterReferenceAdvance(499.99), null, 'below-advance model totals are not allowed to create an overpayment or negative balance');
  assert.equal(remainingAfterReferenceAdvance(Number.NaN), null);
});

test('server checkout validates the attached photo, sets the advance once, and returns the saved payment on retries', () => {
  assert.match(storeRouteSource, /order\.design\?\.customerReferencePhoto !== undefined && \(!isGarmentReferencePhotoForOrder\(order\.design, order\.id\) \|\| !referencePhotoUrl\)/);
  assert.match(storeRouteSource, /const isCustomReferenceOrder = Boolean\(referencePhotoUrl\)/);
  assert.match(storeRouteSource, /hasPricedAbayaReference \? remainingAfterReferenceAdvance\(subtotal\) : null/);
  assert.match(storeRouteSource, /hasPricedAbayaReference && estimatedBalanceAfterAdvance === null/);
  assert.match(storeRouteSource, /estimatedBalanceAfterAdvance: estimatedBalanceAfterAdvance \?\? null/);
  assert.match(storeRouteSource, /isCustomReferenceOrder\s*\?\s*\{ \.\.\.createCustomReferenceOrderFields\(finalTotal\)/);
  assert.match(storeRouteSource, /paymentAmount: customerPaymentAmount\(clean\)/);
  assert.match(storeRouteSource, /if \(isSameOrderIntent\(existing, clean\)\) return json\([\s\S]*?alreadySaved: true/);
  assert.match(storeRouteSource, /orderType: isCustomReferenceOrder \? CUSTOM_REFERENCE_ORDER_TYPE : 'standard'/);
});

test('photo-only Abaya reference orders are accepted only with a private order-scoped photo and empty model selections', () => {
  const id = `AT-${'f'.repeat(32)}`;
  const url = `https://store.blob.vercel-storage.com/arabian-tailors/order-reference-photos/${id}/123e4567-e89b-12d3-a456-426614174000.jpg`;
  const order = {
    id,
    product: 'Abaya · Custom Reference',
    subtotal: 0,
    deliveryFee: 60,
    discount: 0,
    total: 60,
    paymentMethod: 'upi',
    design: {
      productType: 'Abaya',
      customerReferencePhoto: { url, fileName: 'reference.jpg', uploaded: true },
      basePrice: 0,
      options: [],
      customization: [],
      note: '',
      subtotal: 0,
    },
  };
  assert.equal(isPhotoOnlyAbayaReferenceOrder(order), true);
  assert.equal(isPhotoOnlyAbayaReferenceOrder({ ...order, productId: 'abaya-noor' }), false);
  assert.equal(isPhotoOnlyAbayaReferenceOrder({ ...order, design: { ...order.design, productType: 'Kandura' } }), false);
  assert.equal(isPhotoOnlyAbayaReferenceOrder({ ...order, design: { ...order.design, basePrice: 900 } }), false);
  assert.equal(isPhotoOnlyAbayaReferenceOrder({ ...order, design: { ...order.design, selectedModel: { id: 'model-one' } } }), false);
  assert.equal(isPhotoOnlyAbayaReferenceOrder({ ...order, design: { ...order.design, options: ['unverified'] } }), false);
  assert.equal(isPhotoOnlyAbayaReferenceOrder({ ...order, design: { ...order.design, customerReferencePhoto: { ...order.design.customerReferencePhoto, url: url.replace(id, `AT-${'a'.repeat(32)}`) } } }), false);
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
