import assert from 'node:assert/strict';
import test from 'node:test';
import { ABAYA_REFERENCE_MAX_BYTES, ABAYA_REFERENCE_TYPES, getAbayaCustomerSteps, isAbayaReferencePath, isAbayaReferencePhotoForOrder, isAbayaReferenceUrl, isGarmentReferencePhotoForOrder, isModelReferencePath, isModelReferenceUrl, isValidOrderReference, referencePhotoFromDesign, validateAbayaReferenceFile, validateModelReferenceFile } from './abaya-customization.ts';
import { addDefaultCustomization, customizationDefaults, defaultMeasurements } from './customization-defaults.ts';

test('Abaya customer customization preserves all visible configured steps, makes style optional, and limits sizes to standard clothing sizes', () => {
  const steps = [
    { id: 'abaya-style', title: 'Abaya Style', options: [{ id: 'classic', name: 'Classic' }] },
    ...['Fabric', 'Color', 'Sleeve', 'Embroidery'].map((title) => ({ id: title.toLowerCase(), title, options: [{ id: 'x', name: 'X' }] })),
    { id: 'abaya-size', title: 'Size', options: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Custom Measurements'].map((name) => ({ id: name, name })) },
    { id: 'measurements', title: 'Custom Measurements', options: [{ id: 'chest', name: 'Chest' }] },
  ];
  const visible = getAbayaCustomerSteps(steps);
  assert.deepEqual(visible.map((step) => [step.id, step.title]), [['abaya-style', 'Choose a style'], ['fabric', 'Fabric'], ['color', 'Color'], ['sleeve', 'Sleeve'], ['embroidery', 'Embroidery'], ['abaya-size', 'Select Size']]);
  assert.equal(visible[0].required, false);
  assert.equal(visible[0].options[0].name, 'Classic');
  const sizeStep = visible.find((step) => step.id === 'abaya-size');
  assert.deepEqual(sizeStep.options.map((option) => option.name), ['S', 'M', 'L', 'XL', 'XXL']);
  assert.equal(sizeStep.required, undefined);
  assert.equal(visible.some((step) => step.id === 'measurements'), false);
  assert.deepEqual(getAbayaCustomerSteps([
    { id: 'front-style', title: 'Front Style', options: [{ id: 'open', name: 'Open Front' }] },
    { id: 'size-only', title: 'Size', options: [{ id: 's', name: 'S' }] },
  ]).map((step) => step.id), ['front-style', 'size-only']);
  assert.deepEqual(getAbayaCustomerSteps([
    { id: 'hidden-step', title: 'Hidden', visible: false, options: [{ id: 'a', name: 'A' }] },
    { id: 'unavailable-step', title: 'Unavailable', available: false, options: [{ id: 'b', name: 'B' }] },
    { id: 'visible-step', title: 'Finish', required: true, options: [
      { id: 'hidden-option', name: 'Hidden', visible: false },
      { id: 'sold-out', name: 'Sold out', stock: 0 },
      { id: 'available-option', name: 'Available' },
    ] },
  ]), [{ id: 'visible-step', title: 'Finish', required: true, options: [{ id: 'available-option', name: 'Available' }] }]);
});

test('managed Abaya products omit the seeded legacy style list while preserving intentionally configured customer choices', () => {
  const steps = [
    { id: 'seeded-style', title: 'Abaya Style', required: false, options: customizationDefaults.abaya[0].options.map((option, index) => ({ id: `legacy-${index}`, ...option })) },
    { id: 'custom-style', title: 'Personalized silhouette', required: false, options: [{ id: 'evening', name: 'Evening silhouette' }] },
    { id: 'size', title: 'Size', required: true, options: [{ id: 'm', name: 'M' }] },
  ];
  const visible = getAbayaCustomerSteps(steps, { managedCatalog: true });
  assert.deepEqual(visible.map((step) => step.id), ['custom-style', 'size']);
  assert.equal(visible[0].options[0].name, 'Evening silhouette');
  assert.equal(getAbayaCustomerSteps(steps).some((step) => step.id === 'seeded-style'), true, 'legacy fallback remains unchanged without a managed catalog');
});

test('Abaya defaults contain only optional style and required standard size steps, without measurement fields', () => {
  assert.deepEqual(customizationDefaults.abaya.map((step) => step.title), ['Abaya Style', 'Size']);
  assert.deepEqual(customizationDefaults.abaya[1].options.map((option) => option.name), ['S', 'M', 'L', 'XL', 'XXL']);
  assert.deepEqual(customizationDefaults.abaya[0].required, false);
  assert.deepEqual(customizationDefaults.abaya[1].required, true);
  assert.deepEqual(defaultMeasurements.abaya, []);
});

test('Abaya store migration appends missing standard sizes without deleting legacy data or adding measurements', () => {
  const product = { id: 'abaya-existing', category: 'Abaya', customizationSteps: [
    { id: 'fabric', title: 'Fabric', options: [{ id: 'legacy-fabric', name: 'Nida' }] },
    { id: 'size', title: 'Choose Size', options: [{ id: 'old-m', name: 'M', priceAdjustment: 0 }] },
  ], measurements: [{ id: 'legacy-field', name: 'Legacy field', unit: 'cm' }] };
  const store = { products: [product] };
  assert.equal(addDefaultCustomization(store), true);
  assert.deepEqual(product.customizationSteps[0].options.map((option) => option.name), ['Nida']);
  const sizes = product.customizationSteps.find((step) => /size/i.test(step.title));
  assert.deepEqual(sizes.options.map((option) => option.name), ['M', 'S', 'L', 'XL', 'XXL']);
  assert.equal(sizes.required, true);
  assert.equal(sizes.available, true);
  assert.deepEqual(product.measurements, [{ id: 'legacy-field', name: 'Legacy field', unit: 'cm' }]);
  assert.equal(product.measurementsEnabled, false);
  assert.equal(addDefaultCustomization(store), false);
});

test('Abaya photo path and URL are scoped to one valid order reference', () => {
  const orderId = `AT-${'a'.repeat(32)}`;
  const path = `arabian-tailors/order-reference-photos/${orderId}/123e4567-e89b-12d3-a456-426614174000.jpg`;
  const url = `https://store.blob.vercel-storage.com/${path}`;
  assert.equal(isValidOrderReference(orderId), true);
  assert.equal(isAbayaReferencePath(path, orderId), true);
  assert.equal(isAbayaReferenceUrl(url, orderId), true);
  assert.equal(isAbayaReferenceUrl(url, `AT-${'b'.repeat(32)}`), false);
  assert.equal(isAbayaReferenceUrl(`https://example.com/${path}`, orderId), false);
});

test('reference photo policy accepts common image formats under a bounded size', () => {
  assert.deepEqual([...ABAYA_REFERENCE_TYPES], ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(ABAYA_REFERENCE_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(validateAbayaReferenceFile({ type: 'image/jpeg', size: 5_000 }), null);
  assert.match(validateAbayaReferenceFile({ type: 'image/svg+xml', size: 5_000 }), /JPG, PNG, or WebP/);
  assert.match(validateAbayaReferenceFile({ type: 'image/png', size: ABAYA_REFERENCE_MAX_BYTES + 1 }), /smaller than 10 MB/);
  assert.match(validateAbayaReferenceFile({ type: 'image/png', size: 0 }), /smaller than 10 MB/);
});

test('Admin design helper returns only the saved reference URL', () => {
  const url = 'https://store.blob.vercel-storage.com/private-reference.jpg';
  assert.equal(referencePhotoFromDesign({ customerReferencePhoto: { url, fileName: 'abaya.jpg' } }), url);
  assert.equal(referencePhotoFromDesign({ customerReferencePhoto: 'not-an-object' }), null);
  assert.equal(referencePhotoFromDesign(null), null);
});

test('order association rejects a photo from another order or non-Abaya product', () => {
  const orderId = `AT-${'c'.repeat(32)}`;
  const photo = { url: `https://store.blob.vercel-storage.com/arabian-tailors/order-reference-photos/${orderId}/123e4567-e89b-12d3-a456-426614174000.webp`, fileName: 'reference.webp', uploaded: true };
  assert.equal(isAbayaReferencePhotoForOrder({ productType: 'Abaya', customerReferencePhoto: photo }, orderId), true);
  assert.equal(isAbayaReferencePhotoForOrder({ productType: 'Kandura', customerReferencePhoto: photo }, orderId), false);
  assert.equal(isAbayaReferencePhotoForOrder({ productType: 'Abaya', customerReferencePhoto: photo }, `AT-${'d'.repeat(32)}`), false);
  assert.equal(isAbayaReferencePhotoForOrder({ productType: 'Abaya', customerReferencePhoto: { ...photo, fileName: 'x'.repeat(181) } }, orderId), false);
});

test('a private model reference can be attached to Kandura without choosing a named model', () => {
  const orderId = `AT-${'e'.repeat(32)}`;
  const path = `arabian-tailors/order-reference-photos/${orderId}/123e4567-e89b-12d3-a456-426614174000.png`;
  const url = `https://store.blob.vercel-storage.com/${path}`;
  const design = { productType: 'Kandura', customerReferencePhoto: { url, fileName: 'reference.png', uploaded: true } };
  assert.equal(isModelReferencePath(path, orderId), true);
  assert.equal(isModelReferenceUrl(url, orderId), true);
  assert.equal(isGarmentReferencePhotoForOrder(design, orderId), true);
  assert.equal(isGarmentReferencePhotoForOrder(design, orderId, 'Kandura'), true);
  assert.equal(isGarmentReferencePhotoForOrder(design, orderId, 'Abaya'), false);
  assert.equal(isGarmentReferencePhotoForOrder({ ...design, productType: 'Attar' }, orderId), false);
  assert.equal(validateModelReferenceFile({ type: 'image/webp', size: 1_024 }), null);
  // Existing Abaya paths and associations remain valid.
  assert.equal(isAbayaReferencePath(path, orderId), true);
  assert.equal(isAbayaReferenceUrl(url, orderId), true);
});
