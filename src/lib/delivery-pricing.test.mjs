import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateConfiguredSubtotal, calculateOrderTotal, DEFAULT_FLAT_DELIVERY_FEE, DELIVERY_PICKUP_ORIGIN, isValidFlatDeliveryFee, matchesOrderBreakdown, publicDeliveryRules, quoteDelivery, quoteFlatDelivery, resolveFlatDeliveryFee, withDeliveryRestrictionMode, withFlatDeliveryFee } from './delivery-pricing.ts';
import { createUpiPaymentUrl } from './upi-payment.ts';

test('PIN rules choose the most specific configured prefix', () => {
  const rules = [
    { id: 'state', prefix: '682', fee: 80, enabled: true },
    { id: 'city', prefix: '6820', fee: 35, enabled: true },
  ];
  assert.deepEqual(quoteDelivery('682001', rules), { status: 'available', fee: 35, message: 'Delivery Fee: ₹35' });
  assert.equal(quoteDelivery('682001', rules).fee, 35);
});

test('shop-approved zone prefixes quote grouped destinations and exact PIN rules override them', () => {
  const rules = [
    { id: 'approved-zone-test', area: 'Test zone only', prefix: '676', fee: 140, enabled: true },
    { id: 'approved-pin-test', area: 'Test exact PIN only', prefix: '676303', fee: 90, enabled: true },
  ];
  assert.equal(quoteDelivery('676304', rules).fee, 140);
  assert.equal(quoteDelivery('676303', rules).fee, 90);
  assert.equal(quoteDelivery('676999', [{ ...rules[0], enabled: false }]).status, 'unavailable');
  assert.equal(DELIVERY_PICKUP_ORIGIN, 'Parappanangadi, Malappuram, Kerala, India');
});

test('official postal directory provides area metadata only; approved exact PIN fees override zones', () => {
  const directory = { sourceUrl: 'https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month', importedAt: '2026-10-28T00:00:00.000Z', pins: [{ pin: '676303', offices: [{ name: 'Ullanam North B.O', district: 'Malappuram', deliveryStatus: 'Delivery' }] }] };
  const zone = { id: 'zone', area: 'Malappuram zone', prefix: '676', fee: 90, enabled: true };
  const exact = { id: 'exact', area: 'Ullanam North', prefix: '676303', fee: 125, enabled: true };
  const quote = quoteDelivery('676303', [zone, exact], directory);
  assert.equal(quote.fee, 125);
  assert.equal(quote.area, 'Ullanam North B.O');
  assert.equal(quote.district, 'Malappuram');
  assert.equal(quote.deliveryStatus, 'Delivery');
  assert.equal(quoteDelivery('676303', [zone], directory).fee, 90);
  assert.equal(quoteDelivery('676303', [zone, { ...exact, enabled: false }], directory).status, 'unavailable');
  assert.equal(quoteDelivery('676303', [], directory).status, 'unavailable');
  assert.equal(quoteDelivery('676304', [], directory).area, undefined);
});

test('free delivery is explicit and unmatched/invalid PINs never invent a fee', () => {
  assert.deepEqual(quoteDelivery('560001', [{ id: 'free', prefix: '560', fee: 0, enabled: true }]), { status: 'available', fee: 0, message: 'Delivery Fee: FREE' });
  assert.equal(quoteDelivery('56001', []).status, 'invalid');
  assert.equal(quoteDelivery('000001', [{ id: 'fake', prefix: '000', fee: 1, enabled: true }]).status, 'invalid');
  assert.equal(quoteDelivery('560001', []).status, 'unavailable');
  assert.equal(quoteDelivery('560001', [{ id: 'disabled', prefix: '560', fee: 75, enabled: false }]).status, 'unavailable');
  assert.equal(quoteDelivery('110001', [{ id: 'disabled', prefix: '110', fee: 0, enabled: false }]).status, 'unavailable');
});

test('same configured PIN quote supports both product families and does not add a fallback fee', () => {
  const rules = [{ id: 'approved-area', area: 'Test area', prefix: '560', fee: 75, enabled: true }];
  const abayaDelivery = quoteDelivery('560001', rules);
  const kanduraDelivery = quoteDelivery('560999', rules);
  assert.equal(abayaDelivery.fee, 75);
  assert.equal(kanduraDelivery.fee, 75);
  assert.equal(quoteDelivery('110001', rules).fee, null);
  assert.equal(quoteDelivery('110001', rules).status, 'unavailable');
});

test('global shop fee defaults to ₹60 for all valid-format Indian PINs without requiring rules', () => {
  const rules = [
    { id: 'zone', area: 'Supported zone', prefix: '676', fee: 240, enabled: true },
    { id: 'exact', area: 'Exact PIN', prefix: '676303', fee: 18.5, enabled: true },
  ];
  assert.equal(DEFAULT_FLAT_DELIVERY_FEE, 60);
  assert.equal(resolveFlatDeliveryFee(undefined), 60);
  assert.equal(resolveFlatDeliveryFee('invalid stored value'), 60);
  const pins = ['110001', '560001', '676303', '682001'];
  for (const productType of ['Abaya', 'Kandura']) {
    for (const pin of pins) {
      const quote = quoteFlatDelivery(pin, rules);
      assert.equal(quote.status, 'available', `${productType} should accept valid-format PIN ${pin} by default`);
      assert.equal(quote.fee, 60);
      assert.equal(calculateOrderTotal(350, quote.fee), 410);
    }
  }
  assert.equal(quoteFlatDelivery('999999', []).fee, 60);
  assert.equal(quoteFlatDelivery('676303', [{ id: 'disabled', prefix: '676303', fee: 0, enabled: false }]).fee, 60);
  assert.equal(quoteFlatDelivery('676303', rules, null, 125.5).fee, 125.5);
});

test('changing the saved global fee from ₹60 to ₹80 survives reload and updates both checkouts', () => {
  const existingRules = [{ id: 'owner-rule', prefix: '676', fee: 450, enabled: false }];
  const initial = { storeName: 'ARABIAN TAILORS', flatDeliveryFee: 60, restrictDeliveryToConfiguredRules: false, deliveryRules: existingRules };
  assert.equal(isValidFlatDeliveryFee(80), true);
  const savedSettings = withFlatDeliveryFee(initial, 80);
  assert.equal(savedSettings.flatDeliveryFee, 80);
  assert.deepEqual(savedSettings.deliveryRules, existingRules);
  const reloadedSettings = JSON.parse(JSON.stringify(savedSettings));
  for (const productType of ['Abaya', 'Kandura']) {
    for (const pin of ['560001', '676303', '682001']) {
      const quote = quoteFlatDelivery(pin, reloadedSettings.deliveryRules, null, resolveFlatDeliveryFee(reloadedSettings.flatDeliveryFee), reloadedSettings.restrictDeliveryToConfiguredRules);
      assert.equal(quote.fee, 80, `${productType} PIN ${pin} should use the saved fee after reload`);
      const total = calculateOrderTotal(350, quote.fee);
      assert.equal(total, 430);
      assert.equal(matchesOrderBreakdown({ subtotal: 350, deliveryFee: 80, total: 430 }, 350, quote.fee), true);
    }
  }
  const restrictiveSettings = withDeliveryRestrictionMode(reloadedSettings, true);
  assert.equal(restrictiveSettings.flatDeliveryFee, 80);
  assert.deepEqual(restrictiveSettings.deliveryRules, existingRules);
  assert.equal(quoteFlatDelivery('560001', restrictiveSettings.deliveryRules, null, restrictiveSettings.flatDeliveryFee, restrictiveSettings.restrictDeliveryToConfiguredRules).status, 'unavailable');
  assert.equal(withDeliveryRestrictionMode(reloadedSettings, 'true'), null);
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001, 1.001]) {
    assert.equal(isValidFlatDeliveryFee(invalid), false);
    assert.equal(withFlatDeliveryFee(reloadedSettings, invalid), null);
  }
});

test('PIN rules restrict delivery only after explicit opt-in; fee remains global and invalid PINs stay blocked', () => {
  const rules = [
    { id: 'zone', prefix: '676', fee: 10, enabled: true },
    { id: 'blocked-exact', prefix: '676303', fee: 0, enabled: false },
  ];
  assert.equal(quoteFlatDelivery('676303', rules).fee, 60);
  assert.equal(quoteFlatDelivery('676304', rules).fee, 60);
  assert.equal(quoteFlatDelivery('676303', rules, null, 60, true).status, 'unavailable');
  assert.equal(quoteFlatDelivery('676304', rules, null, 60, true).fee, 60);
  assert.equal(quoteFlatDelivery('110001', []).fee, 60);
  assert.equal(quoteFlatDelivery('123', rules).status, 'invalid');
  assert.equal(quoteFlatDelivery('000001', rules).status, 'invalid');
});

test('server-side flat amount is independent of browser-submitted delivery fee and final total', () => {
  const quote = quoteFlatDelivery('676303', [{ id: 'reference-only', prefix: '676', fee: 9999, enabled: true }]);
  const serverTotal = calculateOrderTotal(350, quote.fee, 0);
  assert.equal(quote.fee, 60);
  assert.equal(serverTotal, 410);
  assert.notEqual(serverTotal, calculateOrderTotal(350, 9999, 0));
  assert.equal(matchesOrderBreakdown({ subtotal: 350, deliveryFee: 60, discount: 0, total: 410 }, 350, quote.fee), true);
  assert.equal(matchesOrderBreakdown({ subtotal: 350, deliveryFee: 9999, discount: 0, total: 10349 }, 350, quote.fee), false);
});

test('PIN 676303 matches only an explicitly enabled configured exact-PIN rule', () => {
  const fixtureOnlyRule = [{ id: 'test-fixture-only', area: 'Test fixture, not shop configuration', prefix: '676303', fee: 123, enabled: true }];
  assert.deepEqual(quoteDelivery('676303', fixtureOnlyRule), { status: 'available', fee: 123, message: 'Delivery Fee: ₹123', area: 'Test fixture, not shop configuration' });
  assert.equal(quoteDelivery('676304', fixtureOnlyRule).status, 'unavailable');
  assert.equal(quoteDelivery('676303', [{ ...fixtureOnlyRule[0], enabled: false }]).status, 'unavailable');
});

test('imported PIN rules stay ineligible until PIN and owner fee approvals are recorded', () => {
  const base = { id: 'imported', area: 'Approved area', prefix: '676303', fee: 123, enabled: true, imported: true };
  assert.equal(quoteDelivery('676303', [base]).status, 'unavailable');
  assert.equal(quoteDelivery('676303', [{ ...base, pinSource: 'https://www.indiapost.gov.in/rti/pincodelist' }]).status, 'unavailable');
  assert.equal(quoteDelivery('676303', [{ ...base, pinSource: 'https://www.indiapost.gov.in/rti/pincodelist', feeSource: 'Owner approval 2026-10-28' }]).fee, 123);
  assert.equal(quoteDelivery('676303', [{ ...base, pinSource: 'https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month', feeSource: 'Owner approval 2026-10-28' }]).fee, 123);
});

test('public delivery rules retain checkout fields but omit import approval references', () => {
  const [rule] = publicDeliveryRules([{ id: 'imported', area: 'Area', prefix: '676303', fee: 123, enabled: true, imported: true, pinSource: 'https://www.indiapost.gov.in/rti/pincodelist', feeSource: 'Owner note' }]);
  assert.deepEqual(rule, { id: 'imported', area: 'Area', prefix: '676303', fee: 123, enabled: true });
  assert.equal(quoteDelivery('676303', [rule]).fee, 123);
  const [unapproved] = publicDeliveryRules([{ id: 'bad-import', area: 'Area', prefix: '676303', fee: 123, enabled: true, imported: true }]);
  assert.equal(unapproved.enabled, false);
  assert.equal(quoteFlatDelivery('676303', [unapproved]).fee, 60);
  assert.equal(quoteFlatDelivery('676303', [unapproved], null, 60, true).status, 'unavailable');
});

test('server total includes the confirmed delivery fee and UPI uses that exact total', () => {
  const subtotal = 2450;
  const quote = quoteFlatDelivery('560001', [{ id: 'reference-only', prefix: '560', fee: 85, enabled: true }]);
  assert.equal(quote.status, 'available');
  const savedTotal = calculateOrderTotal(subtotal, quote.fee, 0);
  assert.equal(savedTotal, 2510);
  assert.equal(new URL(createUpiPaymentUrl('shop@upi', savedTotal, 'AT-123456')).searchParams.get('am'), '2510.00');
  assert.equal(calculateOrderTotal(100, 20, 10), 110);
  assert.equal(calculateOrderTotal(100, 20, 121), null);
});

test('server total uses the approved exact-PIN fee when a broader zone also matches', () => {
  const directory = { sourceUrl: 'https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month', importedAt: '2026-10-28T00:00:00.000Z', pins: [{ pin: '676303', offices: [{ name: 'Ullanam B.O', district: 'Malappuram' }] }] };
  const quote = quoteDelivery('676303', [
    { id: 'zone', prefix: '676', area: 'Zone', fee: 80, enabled: true },
    { id: 'pin', prefix: '676303', area: 'Ullanam', fee: 115, enabled: true },
  ], directory);
  assert.equal(quote.fee, 115);
  assert.equal(calculateOrderTotal(350, quote.fee, 0), 465);
  assert.equal(quoteDelivery('676303', [
    { id: 'zone', prefix: '676', area: 'Zone', fee: 80, enabled: true },
    { id: 'pin-disabled', prefix: '676303', area: 'Ullanam', fee: 115, enabled: false },
  ], directory).status, 'unavailable');
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

test('a required Kandura model can be skipped while other required choices remain validated', () => {
  const product = {
    id: 'kandura-test', name: 'Signature Kandura', price: 350, category: 'Kandura',
    customizationSteps: [
      { id: 'model', title: 'Choose Your Kandura Model', required: true, options: [{ id: 'saudi', name: 'Saudi Kandura', basePrice: 450 }] },
      { id: 'size', title: 'Choose Size', required: true, options: [{ id: 'm', name: 'M' }] },
    ],
  };
  assert.deepEqual(calculateConfiguredSubtotal(product, { productType: 'Kandura', customization: [{ stepId: 'size', optionId: 'm', option: 'M' }] }), { ok: true, subtotal: 350, basePrice: 350 });
  assert.deepEqual(calculateConfiguredSubtotal(product, { productType: 'Kandura', customization: [] }), { ok: false, error: 'Select an option for Choose Size.' });
  const abaya = { ...product, id: 'abaya-test', name: 'Classic Abaya', category: 'Abaya', customizationSteps: [
    { id: 'abaya-model', title: 'Select Abaya Model', required: true, options: [{ id: 'classic', name: 'Classic Abaya' }] },
    { id: 'abaya-size', title: 'Select Size', required: true, options: [{ id: 'm', name: 'M' }] },
  ] };
  assert.deepEqual(calculateConfiguredSubtotal(abaya, { productType: 'Abaya', customization: [{ stepId: 'abaya-size', optionId: 'm', option: 'M' }] }), { ok: true, subtotal: 350, basePrice: 350 });
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

test('Abaya accepts only enabled standard sizes and ignores stored measurement and extra steps', () => {
  const sizes = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Custom Measurements'].map((name, index) => ({ id: `size-${index}`, name, priceAdjustment: 0 }));
  const abaya = { id: 'abaya-standard-sizes', name: 'Everyday Abaya', price: 1200, category: 'Abaya', customizationSteps: [
    { id: 'style', title: 'Abaya Style', required: true, options: [{ id: 'classic', name: 'Classic', priceAdjustment: 0 }] },
    { id: 'size', title: 'Choose Size', required: true, options: sizes },
    { id: 'measurements', title: 'Custom Measurements', required: true, options: [{ id: 'chest', name: 'Chest', priceAdjustment: 900 }] },
    { id: 'fabric', title: 'Fabric', required: true, options: [{ id: 'nida', name: 'Nida', priceAdjustment: 800 }] },
  ] };
  for (const name of ['S', 'M', 'L', 'XL', 'XXL']) {
    const option = sizes.find(item => item.name === name);
    const result = calculateConfiguredSubtotal(abaya, { productType: 'Abaya', customization: [{ stepId: 'size', optionId: option.id, option: option.name, priceAdjustment: 0 }] });
    assert.equal(result.ok, true, `${name} should be accepted`);
    assert.equal(result.subtotal, 1200);
  }
  for (const name of ['XXXL', 'Custom Measurements']) {
    const option = sizes.find(item => item.name === name);
    const result = calculateConfiguredSubtotal(abaya, { productType: 'Abaya', customization: [{ stepId: 'size', optionId: option.id, option: option.name, priceAdjustment: 0 }] });
    assert.equal(result.ok, false, `${name} must not be accepted for Abaya`);
  }
  assert.equal(calculateConfiguredSubtotal(abaya, { productType: 'Abaya', customization: [] }).ok, false, 'size remains required');
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
