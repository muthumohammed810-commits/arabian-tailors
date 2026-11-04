import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPublicStoreProduct } from './public-store-product.mjs';

test('public Abaya projection exposes only storefront fields and customer-visible customization data', () => {
  const source = {
    id: 'abaya-evening', name: 'Evening Abaya', category: 'Abaya', price: 6200,
    description: 'A tailored silhouette', image: 'https://images.example/main.jpg',
    images: ['https://images.example/main.jpg', 'https://images.example/back.jpg'],
    available: true, stock: 8, internalCost: 2600, adminNotes: 'supplier batch A',
    storefrontSecret: 'must not escape', modelCode: 'ADMIN-ONLY',
    options: ['Regular length', 'Petite length'],
    customizationSteps: [
      { id: 'colour', title: 'Colour', required: true, options: [
        { id: 'black', name: 'Black', description: 'Matte crepe', swatch: '#111111', priceAdjustment: 250, basePrice: 99999, stock: 3, adminNote: 'internal', modelCustomization: {
          colors: { required: true, visible: true, internal: 'no', options: [
            { id: 'ink', name: 'Ink', swatch: '#000000', priceAdjustment: 0 },
            { id: 'hidden-colour', name: 'Hidden', visible: false, priceAdjustment: 999 },
            { id: 'empty-stock', name: 'Sold out', stock: 0 },
          ] },
          fabrics: { visible: false, required: true, options: [{ id: 'private-fabric', name: 'Hidden fabric' }] },
          steps: [{ id: 'lining', title: 'Lining', description: 'Lightweight', required: false, options: [{ id: 'silk', name: 'Silk' }, { id: 'hidden-lining', name: 'Hidden', available: false }] }],
          privateConfig: 'no',
        } },
        { id: 'hidden-black', name: 'Hidden black', visible: false },
        { id: 'unavailable-black', name: 'Unavailable black', available: false },
        { id: 'sold-out-black', name: 'Sold out', stock: 0 },
      ] },
      { id: 'hidden-step', title: 'Internal sourcing', visible: false, required: true, options: [{ id: 'secret', name: 'Secret' }] },
      { id: 'sold-out-step', title: 'Limited', available: false, options: [{ id: 'x', name: 'X' }] },
    ],
  };

  const result = projectPublicStoreProduct(source);
  assert.deepEqual(Object.keys(result).sort(), ['available', 'category', 'customizationSteps', 'description', 'id', 'image', 'images', 'name', 'options', 'price'].sort());
  assert.deepEqual(result.customizationSteps.map(step => step.id), ['colour']);
  assert.deepEqual(result.customizationSteps[0].options.map(option => option.id), ['black']);
  assert.equal(result.customizationSteps[0].options[0].stock, undefined);
  assert.equal(result.customizationSteps[0].options[0].basePrice, undefined, 'legacy option base prices cannot supersede the saved Abaya product price');
  assert.equal(result.customizationSteps[0].options[0].adminNote, undefined);
  const nested = result.customizationSteps[0].options[0].modelCustomization;
  assert.deepEqual(nested.colors.options.map(option => option.id), ['ink']);
  assert.equal(nested.fabrics, undefined);
  assert.deepEqual(nested.steps.map(step => step.id), ['lining']);
  assert.equal(nested.steps[0].options.some(option => option.id === 'hidden-lining'), false);
  assert.equal(nested.privateConfig, undefined);
  assert.equal(result.stock, undefined);
  assert.equal(result.internalCost, undefined);
  assert.equal(result.adminNotes, undefined);
  assert.equal(result.modelCode, undefined);
  assert.deepEqual(source.customizationSteps[0].options[0].modelCustomization.colors.options.map(option => option.id), ['ink', 'hidden-colour', 'empty-stock'], 'projection does not mutate the Admin record');
});

test('public Kandura projection retains the customer measurement and published guide contract without private product fields', () => {
  const result = projectPublicStoreProduct({
    id: 'kandura-classic', name: 'Classic Kandura', category: 'Kandura', price: 3000,
    swatch: '#f4f0e6',
    measurements: [{ id: 'chest', name: 'Chest', available: true }],
    measurementsEnabled: true,
    measurementGuides: [{ id: 'guide-1', title: 'Chest', image: '/guide.jpg', published: true }],
    measurementGuideVideo: { id: 'video-1', url: '/guide.mp4', published: true },
    stock: 12, adminOnly: 'private',
  });
  assert.deepEqual(result.measurements, [{ id: 'chest', name: 'Chest', available: true }]);
  assert.equal(result.swatch, '#f4f0e6');
  assert.deepEqual(result.measurementGuides, [{ id: 'guide-1', title: 'Chest', image: '/guide.jpg', published: true }]);
  assert.equal(result.stock, undefined);
  assert.equal(result.adminOnly, undefined);
});

test('invalid products are not projected', () => {
  assert.equal(projectPublicStoreProduct(null), null);
});
