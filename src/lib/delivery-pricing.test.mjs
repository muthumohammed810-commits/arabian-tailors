import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateConfiguredSubtotal, quoteDelivery } from './delivery-pricing.ts';

test('PIN rules choose the most specific configured prefix', () => {
  const rules = [
    { id: 'state', prefix: '682', fee: 80, enabled: true },
    { id: 'city', prefix: '6820', fee: 35, enabled: true },
  ];
  assert.deepEqual(quoteDelivery('682001', rules), { status: 'available', fee: 35, message: 'Delivery Fee: ₹35' });
  assert.equal(quoteDelivery('682001', rules).fee, 35);
});

test('free delivery is explicit and unmatched/invalid PINs never invent a fee', () => {
  assert.deepEqual(quoteDelivery('560001', [{ id: 'free', prefix: '560', fee: 0, enabled: true }]), { status: 'available', fee: 0, message: 'Delivery Fee: FREE' });
  assert.equal(quoteDelivery('56001', []).status, 'invalid');
  assert.equal(quoteDelivery('110001', [{ id: 'disabled', prefix: '110', fee: 0, enabled: false }]).status, 'unavailable');
});

test('server pricing uses saved model base and configured option prices', () => {
  const product = { id: 'kandura', name: 'Kandura', price: 2000, customizationSteps: [
    { id: 'models', title: 'Choose Your Kandura Model', required: true, options: [{ id: 'saudi', name: 'Saudi', basePrice: 2300, priceAdjustment: 100 }] },
    { id: 'colors', title: 'Choose Color', required: true, options: [{ id: 'ivory', name: 'Ivory', priceAdjustment: 50 }] },
  ] };
  const result = calculateConfiguredSubtotal(product, { selectedModel: { id: 'saudi' }, customization: [
    { stepId: 'models', optionId: 'saudi', option: 'Saudi', priceAdjustment: 100 },
    { stepId: 'colors', optionId: 'ivory', option: 'Ivory', priceAdjustment: 50 },
  ] });
  assert.deepEqual(result, { ok: true, basePrice: 2300, subtotal: 2450 });
});

test('server rejects client-tampered option charges and missing required choices', () => {
  const product = { id: 'abaya', name: 'Abaya', price: 4000, customizationSteps: [
    { id: 'model', title: 'Abaya Model', required: true, options: [{ id: 'classic', name: 'Classic', priceAdjustment: 0 }] },
    { id: 'size', title: 'Size', required: true, options: [{ id: 'm', name: 'M', priceAdjustment: 0 }] },
  ] };
  assert.equal(calculateConfiguredSubtotal(product, { customization: [{ stepId: 'model', optionId: 'classic', option: 'Classic', priceAdjustment: 500 }] }).ok, false);
  assert.equal(calculateConfiguredSubtotal(product, { customization: [{ stepId: 'model', optionId: 'classic', option: 'Classic', priceAdjustment: 0 }] }).ok, false);
});

test('model-specific customization prices are counted once and Abaya validates only model and size', () => {
  const kandura = { id: 'kandura', name: 'Kandura', price: 2000, category: 'Kandura', customizationSteps: [
    { id: 'model', title: 'Choose Your Kandura Model', required: true, options: [{ id: 'saudi', name: 'Saudi', priceAdjustment: 0, modelCustomization: { colors: { required: true, visible: true, options: [{ id: 'ivory', name: 'Ivory', priceAdjustment: 25 }] } } }] },
  ] };
  assert.equal(calculateConfiguredSubtotal(kandura, { selectedModel: { id: 'saudi' }, customization: [
    { stepId: 'model', optionId: 'saudi', option: 'Saudi', priceAdjustment: 0 },
    { stepId: 'model-saudi-colors', optionId: 'ivory', option: 'Ivory', priceAdjustment: 25 },
  ] }).subtotal, 2025);

  const abaya = { id: 'abaya', name: 'Abaya', price: 4000, category: 'Abaya', customizationSteps: [
    { id: 'model', title: 'Abaya Style', required: true, options: [{ id: 'classic', name: 'Classic', priceAdjustment: 0 }] },
    { id: 'size', title: 'Size', required: true, options: [{ id: 'm', name: 'M', priceAdjustment: 0 }] },
    { id: 'abaya-extra', title: 'Embroidery', required: true, options: [{ id: 'none', name: 'None', priceAdjustment: 500 }] },
  ] };
  const result = calculateConfiguredSubtotal(abaya, { productType: 'Abaya', selectedModel: { id: 'classic' }, customization: [
    { stepId: 'model', optionId: 'classic', option: 'Classic', priceAdjustment: 0 },
    { stepId: 'size', optionId: 'm', option: 'M', priceAdjustment: 0 },
  ] });
  assert.deepEqual(result, { ok: true, basePrice: 4000, subtotal: 4000 });
});

test('Abaya reference photo can substitute for a model selection but not the required size', () => {
  const abaya = { id: 'abaya', name: 'Abaya', price: 4000, category: 'Abaya', customizationSteps: [
    { id: 'model', title: 'Abaya Style', required: true, options: [{ id: 'classic', name: 'Classic', priceAdjustment: 0 }] },
    { id: 'size', title: 'Size', required: true, options: [{ id: 'm', name: 'M', priceAdjustment: 0 }] },
  ] };
  assert.equal(calculateConfiguredSubtotal(abaya, { productType: 'Abaya', customerReferencePhoto: { url: 'some-url' }, customization: [
    { stepId: 'size', optionId: 'm', option: 'M', priceAdjustment: 0 },
  ] }).ok, true);
  assert.equal(calculateConfiguredSubtotal(abaya, { productType: 'Abaya', customerReferencePhoto: { url: 'some-url' }, customization: [] }).ok, false);
});
