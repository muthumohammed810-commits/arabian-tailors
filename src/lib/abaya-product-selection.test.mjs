import test from 'node:test';
import assert from 'node:assert/strict';
import { findLegacyAbayaFallback, getAbayaProductOrderSnapshot, getCustomerAbayaProducts, hasManagedAbayaCatalog, isCustomerEligibleAbayaProduct, moveProductWithinCategory } from './abaya-product-selection.mjs';

const published = { id: 'abaya-noor', name: 'Noor Abaya', category: 'Abaya', price: 4200, image: '/noor-main.jpg', images: ['/noor-main.jpg', '/noor-back.jpg'], description: 'Fluid lines', customizationSteps: [{ id: 'size', title: 'Size', options: [{ id: 'm', name: 'M' }] }] };

test('customer Abaya choices use the saved product record and preserve its image gallery, description, price and options', () => {
  const actual = { ...published, name: 'Noor Updated', price: 5100 };
  const products = getCustomerAbayaProducts([actual, { ...published, id: 'hidden', available: false }, { ...published, id: 'kandura', category: 'Kandura' }], { managed: true, fallbackProducts: [{ ...published, id: 'legacy' }] });
  assert.deepEqual(products, [actual]);
  assert.equal(products[0].id, 'abaya-noor');
  assert.equal(products[0].name, 'Noor Updated');
  assert.equal(products[0].price, 5100);
  assert.deepEqual(products[0].images, ['/noor-main.jpg', '/noor-back.jpg']);
  assert.deepEqual(products[0].customizationSteps[0].options, [{ id: 'm', name: 'M' }]);
});

test('hidden and unavailable Abaya products never appear in customer selections', () => {
  assert.equal(isCustomerEligibleAbayaProduct({ ...published, available: false }), false);
  assert.deepEqual(getCustomerAbayaProducts([{ ...published, available: false }], { managed: true, fallbackProducts: [published] }), []);
});

test('legacy Abaya fallback is used only when no managed Abaya catalog exists', () => {
  const legacy = { ...published, id: 'legacy-abaya' };
  assert.deepEqual(getCustomerAbayaProducts([], { managed: false, fallbackProducts: [legacy] }), [legacy]);
  assert.deepEqual(getCustomerAbayaProducts([], { managed: true, fallbackProducts: [legacy] }), []);
  assert.equal(hasManagedAbayaCatalog([{ ...published, available: false }]), true);
  assert.deepEqual(findLegacyAbayaFallback('legacy-abaya', [legacy], true), undefined);
  assert.equal(findLegacyAbayaFallback('legacy-abaya', [legacy])?.id, 'legacy-abaya');
});

test('invalid product records are not selectable', () => {
  assert.equal(isCustomerEligibleAbayaProduct({ ...published, price: -1 }), false);
  assert.equal(isCustomerEligibleAbayaProduct({ ...published, name: '' }), false);
  assert.equal(isCustomerEligibleAbayaProduct({ ...published, id: '' }), false);
});

test('checkout snapshot carries the exact selected product identity, primary uploaded image and stored price', () => {
  assert.deepEqual(getAbayaProductOrderSnapshot(published), {
    productId: 'abaya-noor', productName: 'Noor Abaya', productImage: '/noor-main.jpg', basePrice: 4200,
  });
  assert.deepEqual(getAbayaProductOrderSnapshot({ ...published, image: '', images: ['/gallery-cover.jpg'] }), {
    productId: 'abaya-noor', productName: 'Noor Abaya', productImage: '/gallery-cover.jpg', basePrice: 4200,
  });
});

test('Abaya reorder changes only Abaya product order and preserves interleaved product records', () => {
  const products = [
    { id: 'abaya-a', category: 'Abaya' },
    { id: 'kandura-a', category: 'Kandura' },
    { id: 'abaya-b', category: 'abaya' },
    { id: 'fabric-a', category: 'Fabric' },
    { id: 'abaya-c', category: 'Abaya' },
  ];
  assert.deepEqual(moveProductWithinCategory(products, 'Abaya', 'abaya-c', -1).map((item) => item.id), [
    'abaya-a', 'kandura-a', 'abaya-c', 'fabric-a', 'abaya-b',
  ]);
  assert.deepEqual(moveProductWithinCategory(products, 'Abaya', 'abaya-a', -1).map((item) => item.id), products.map((item) => item.id));
  assert.deepEqual(moveProductWithinCategory(products, 'Abaya', 'missing', 1).map((item) => item.id), products.map((item) => item.id));
});
