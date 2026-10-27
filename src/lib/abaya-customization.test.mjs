import assert from 'node:assert/strict';
import test from 'node:test';
import { ABAYA_REFERENCE_MAX_BYTES, ABAYA_REFERENCE_TYPES, getAbayaCustomerSteps, isAbayaReferencePath, isAbayaReferencePhotoForOrder, isAbayaReferenceUrl, isValidOrderReference, referencePhotoFromDesign, validateAbayaReferenceFile } from './abaya-customization.ts';

test('Abaya customer customization keeps only configured model and size steps', () => {
  const steps = [
    { id: 'abaya-style', title: 'Abaya Style', options: [{ id: 'classic', name: 'Classic' }] },
    ...['Fabric', 'Color', 'Sleeve', 'Embroidery'].map((title) => ({ id: title.toLowerCase(), title, options: [{ id: 'x', name: 'X' }] })),
    { id: 'abaya-size', title: 'Size', options: [{ id: 'custom', name: 'Custom Measurements' }] },
  ];
  const visible = getAbayaCustomerSteps(steps);
  assert.deepEqual(visible.map((step) => [step.id, step.title]), [['abaya-style', 'Select Abaya Model'], ['abaya-size', 'Select Size']]);
  assert.equal(visible[0].options[0].name, 'Classic');
  assert.equal(visible[1].options[0].name, 'Custom Measurements');
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
