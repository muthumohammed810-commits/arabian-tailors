import test from 'node:test';
import assert from 'node:assert/strict';
import { productImageSource } from './product-image-url.ts';
import {
  hasPublishedMeasurementGuideImage,
  isMeasurementGuideImagePath,
  isValidMeasurementGuideList,
  isValidMeasurementGuideUpload,
  measurementGuideImagePath,
  measurementGuideMimeTypeForPath,
  deleteMeasurementGuide,
  moveMeasurementGuide,
  publishedMeasurementGuides,
  removeMeasurementGuidePhoto,
  replaceMeasurementGuidePhoto,
} from './measurement-guides.mjs';

const productId = 'product-kandura-signature';
const guideId = 'guide-size-chart';
const filename = '123e4567-e89b-12d3-a456-426614174000.jpg';
const pathname = measurementGuideImagePath(productId, guideId, filename);
const image = `https://store.private.blob.vercel-storage.com/${pathname}`;
const guide = { id: guideId, title: 'Taking your measurements', instructions: 'Measure over light clothing.', image, published: true };

test('measurement uploads accept JPG, PNG and WebP within the 10 MB bound only', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(isValidMeasurementGuideUpload({ type, size: 10 * 1024 * 1024 }), true);
  assert.equal(isValidMeasurementGuideUpload({ type: 'image/gif', size: 1 }), false);
  assert.equal(isValidMeasurementGuideUpload({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }), false);
  assert.equal(isValidMeasurementGuideUpload({ type: 'image/jpeg', size: 0 }), false);
});

test('guide image paths are scoped to product and guide IDs', () => {
  assert.equal(isMeasurementGuideImagePath(pathname), true);
  assert.equal(productImageSource(image), `/api/product-image?pathname=${encodeURIComponent(pathname)}`);
  assert.equal(measurementGuideMimeTypeForPath(pathname), 'image/jpeg');
  assert.equal(measurementGuideMimeTypeForPath(pathname.replace('.jpg', '.webp')), 'image/webp');
  assert.equal(isMeasurementGuideImagePath(pathname.replace(productId, '../orders')), false);
  assert.equal(isMeasurementGuideImagePath('arabian-tailors/measurement-guides/product-a/guide-a/not-an-image.txt'), false);
});

test('guide list validation requires safe IDs, title, description, and image for published guides', () => {
  assert.equal(isValidMeasurementGuideList([guide], productId), true);
  assert.equal(isValidMeasurementGuideList([{ ...guide, image: '' }], productId), false);
  assert.equal(isValidMeasurementGuideList([{ ...guide, image: 'blob:temporary-preview' }], productId), false);
  assert.equal(isValidMeasurementGuideList([{ ...guide, id: guideId, image: '' , published: false }], productId), true);
  assert.equal(isValidMeasurementGuideList([{ ...guide, id: 'bad/id' }], productId), false);
  assert.equal(isValidMeasurementGuideList([{ ...guide }, { ...guide }], productId), false);
});

test('customer data and image proxy allow only published Kandura guide photos', () => {
  assert.deepEqual(publishedMeasurementGuides([guide, { ...guide, id: 'draft-guide', published: false }], productId), [guide]);
  assert.deepEqual(publishedMeasurementGuides([guide], 'another-kandura'), []);
  assert.equal(hasPublishedMeasurementGuideImage([{ id: productId, category: 'Kandura', measurementGuides: [guide] }], pathname), true);
  assert.equal(hasPublishedMeasurementGuideImage([{ id: productId, category: 'Kandura', measurementGuides: [{ ...guide, published: false }] }], pathname), false);
  assert.equal(hasPublishedMeasurementGuideImage([{ category: 'Abaya', measurementGuides: [guide] }], pathname), false);
});

test('Admin photo replacement, removal, deletion, and reordering stay attached to the selected guide', () => {
  const nextPath = measurementGuideImagePath(productId, guideId, '223e4567-e89b-12d3-a456-426614174000.webp');
  const nextUrl = `https://store.private.blob.vercel-storage.com/${nextPath}`;
  const second = { ...guide, id: 'guide-another', title: 'Sleeve measurement', image: `https://store.private.blob.vercel-storage.com/${measurementGuideImagePath(productId, 'guide-another', filename)}` };
  const replaced = replaceMeasurementGuidePhoto([guide, second], guideId, nextUrl, productId);
  assert.equal(replaced[0].image, nextUrl);
  assert.equal(replaced[1].image, second.image);
  assert.equal(replaceMeasurementGuidePhoto([guide], guideId, second.image, productId), null);
  const removedPhoto = removeMeasurementGuidePhoto([guide, second], guideId);
  assert.equal('image' in removedPhoto[0], false);
  assert.equal(removedPhoto[0].published, false);
  assert.equal(removedPhoto[1].image, second.image);
  assert.deepEqual(deleteMeasurementGuide([guide, second], guideId), [second]);
  assert.deepEqual(moveMeasurementGuide([guide, second], guideId, 1), [second, guide]);
});
