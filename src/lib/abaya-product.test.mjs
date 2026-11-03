import assert from 'node:assert/strict';
import test from 'node:test';
import { abayaProductImagePath, abayaProductImagePathFromUrl, effectiveAbayaPrice, getAbayaGalleryImages, getProductImageBlobStore, getUnreferencedAbayaProductImagePaths, isAbayaProductImagePath, isAbayaProductImageUrlForStore, isCustomerProductAvailable, isValidAbayaSalePrice, isValidAbayaProductCode, validateAbayaImageFile, validateAbayaProductCode } from './abaya-product.mjs';

test('explicitly unpublished products are hidden while legacy products remain visible', () => {
  assert.equal(isCustomerProductAvailable({ id: 'published', available: true }), true);
  assert.equal(isCustomerProductAvailable({ id: 'legacy' }), true);
  assert.equal(isCustomerProductAvailable({ id: 'unpublished', available: false }), false);
  assert.equal(isCustomerProductAvailable(null), false);
});

test('Abaya product codes are normalized and unique among Abayas', () => {
  const existing = [{ id: 'a', category: 'Abaya', productCode: 'NOOR-01' }, { id: 'k', category: 'Kandura', productCode: 'NOOR-02' }];
  assert.equal(isValidAbayaProductCode(' NOOR-03 '), true);
  assert.equal(isValidAbayaProductCode('A'), false);
  assert.equal(validateAbayaProductCode({ id: 'b', productCode: 'noor-01' }, existing), 'That Abaya product code is already in use.');
  assert.equal(validateAbayaProductCode({ id: 'a', productCode: 'noor-01' }, existing), null);
  assert.equal(validateAbayaProductCode({ id: 'b', productCode: 'noor-02' }, existing), null);
});

test('sale price is optional and cannot exceed the regular price', () => {
  assert.equal(isValidAbayaSalePrice({ price: 5000 }), true);
  assert.equal(isValidAbayaSalePrice({ price: 5000, salePrice: 4200 }), true);
  assert.equal(isValidAbayaSalePrice({ price: 5000, salePrice: 5001 }), false);
  assert.equal(isValidAbayaSalePrice({ price: 5000, salePrice: -1 }), false);
  assert.equal(effectiveAbayaPrice({ category: 'Abaya', price: 5000, salePrice: 4200 }), 4200);
  assert.equal(effectiveAbayaPrice({ category: 'Kandura', price: 5000, salePrice: 4200 }), 5000);
});

test('Abaya gallery accepts JPG, PNG, WebP only and enforces the upload size cap', () => {
  assert.equal(validateAbayaImageFile({ type: 'image/jpeg', size: 1024 }), null);
  assert.equal(validateAbayaImageFile({ type: 'image/png', size: 1024 }), null);
  assert.equal(validateAbayaImageFile({ type: 'image/webp', size: 1024 }), null);
  assert.match(validateAbayaImageFile({ type: 'image/gif', size: 1024 }), /JPG, PNG, or WebP/);
  assert.match(validateAbayaImageFile({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }), /10 MB/);
});

test('customer gallery follows selected Abaya colour photos and falls back to product photos', () => {
  const product = { image: 'cover.jpg', images: ['cover.jpg', 'back.jpg'] };
  assert.deepEqual(getAbayaGalleryImages(product, { image: 'navy.jpg', images: ['navy.jpg', 'navy-side.jpg'] }), ['navy.jpg', 'navy-side.jpg']);
  assert.deepEqual(getAbayaGalleryImages(product, { images: [] }), ['cover.jpg', 'back.jpg']);
  assert.deepEqual(getAbayaGalleryImages({ images: ['cover.jpg', 'cover.jpg'] }), ['cover.jpg']);
});

test('Abaya upload paths are scoped and identify files eligible for server size and MIME limits', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const path = abayaProductImagePath(id, 'image/webp');
  assert.equal(path, `arabian-tailors/abaya-product-images/${id}.webp`);
  assert.equal(isAbayaProductImagePath(path), true);
  assert.equal(isAbayaProductImagePath(path.replace('/abaya-product-images/', '/product-images/')), false);
  assert.equal(abayaProductImagePath('not-a-uuid', 'image/jpeg'), null);
  assert.equal(abayaProductImagePath(id, 'image/gif'), null);
});

test('Abaya media uses its explicit store and never falls back to shared storage', () => {
  const path = abayaProductImagePath('0f3dcb4a-a9ae-4b5e-9b1e-94b99355a250', 'image/jpeg');
  const both = getProductImageBlobStore(path, { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_sharedtest_sharedsecret', BLOB_STORE_ID: 'store_sharedtest', ABAYA_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abatest_abayasecret', ABAYA_BLOB_STORE_ID: 'store_abatest' });
  assert.deepEqual({ kind: both.kind, token: both.token, storeId: both.storeId }, { kind: 'abaya', token: 'vercel_blob_rw_abatest_abayasecret', storeId: 'store_abatest' });
  const oidcPreview = getProductImageBlobStore(path, { VERCEL_ENV: 'preview', ABAYA_BLOB_STORE_ID: 'store_vkimfAjFJW0suvFN' });
  assert.deepEqual({ kind: oidcPreview.kind, token: oidcPreview.token, storeId: oidcPreview.storeId }, { kind: 'abaya', token: null, storeId: 'store_vkimfAjFJW0suvFN' });
  const noAbayaToken = getProductImageBlobStore(path, { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_sharedtest_sharedsecret', ABAYA_BLOB_STORE_ID: 'store_abatest' });
  assert.deepEqual({ kind: noAbayaToken.kind, token: noAbayaToken.token, storeId: noAbayaToken.storeId }, { kind: 'abaya', token: null, storeId: 'store_abatest' });
  const noAbayaStore = getProductImageBlobStore(path, { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_sharedtest_sharedsecret', ABAYA_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abatest_abayasecret' });
  assert.deepEqual({ kind: noAbayaStore.kind, token: noAbayaStore.token, storeId: noAbayaStore.storeId }, { kind: 'abaya', token: null, storeId: null });
  const invalidPath = getProductImageBlobStore('arabian-tailors/abaya-product-images/not-a-uuid.jpg', { BLOB_READ_WRITE_TOKEN: 'shared' });
  assert.equal(invalidPath.kind, 'abaya');
  const shared = getProductImageBlobStore('arabian-tailors/product-images/item.jpg', { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_sharedtest_sharedsecret', BLOB_STORE_ID: 'store_sharedtest', ABAYA_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abatest_abayasecret', ABAYA_BLOB_STORE_ID: 'store_abatest' });
  assert.deepEqual({ kind: shared.kind, token: shared.token, storeId: shared.storeId }, { kind: 'shared', token: 'vercel_blob_rw_sharedtest_sharedsecret', storeId: 'store_sharedtest' });
});

test('Abaya deletion accepts only namespaced private image paths', () => {
  const path = abayaProductImagePath('0f3dcb4a-a9ae-4b5e-9b1e-94b99355a250', 'image/jpeg');
  assert.equal(abayaProductImagePathFromUrl(path), path);
  assert.equal(abayaProductImagePathFromUrl(`https://store.private.blob.vercel-storage.com/${path}`), path);
  assert.equal(abayaProductImagePathFromUrl('https://other.private.blob.vercel-storage.com/arabian-tailors/product-images/photo.jpg'), null);
  assert.equal(abayaProductImagePathFromUrl('https://store.public.blob.vercel-storage.com/arabian-tailors/abaya-product-images/photo.jpg'), null);
  assert.equal(abayaProductImagePathFromUrl('arabian-tailors/abaya-product-images/../store.json'), null);
  assert.equal(isAbayaProductImageUrlForStore(`https://abaya-test.private.blob.vercel-storage.com/${path}`, 'abaya-test'), true);
  assert.equal(isAbayaProductImageUrlForStore(`https://shared.private.blob.vercel-storage.com/${path}`, 'abaya-test'), false);
  assert.equal(isAbayaProductImageUrlForStore(`https://abaya-test.private.blob.vercel-storage.com/${path}`, ''), false);
});

test('Abaya cleanup selects only removed Abaya images and preserves paths still referenced elsewhere', () => {
  const first = abayaProductImagePath('0f3dcb4a-a9ae-4b5e-9b1e-94b99355a250', 'image/jpeg');
  const second = abayaProductImagePath('1f3dcb4a-a9ae-4b5e-9b1e-94b99355a251', 'image/png');
  const other = 'arabian-tailors/product-images/kandura.jpg';
  const previous = { image: `https://store.private.blob.vercel-storage.com/${first}`, images: [`https://store.private.blob.vercel-storage.com/${first}`, `https://store.private.blob.vercel-storage.com/${second}`, other] };
  assert.deepEqual(getUnreferencedAbayaProductImagePaths(previous, [{ images: [`https://store.private.blob.vercel-storage.com/${first}`] }]), [second]);
  assert.deepEqual(getUnreferencedAbayaProductImagePaths(previous, [{ images: [other] }]), [first, second]);
});
