import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicProductImagePath, productImageBlobAccess, productImageSource } from './product-image-url.ts';

test('client upload access matches the connected private Blob store', () => {
  assert.equal(productImageBlobAccess, 'private');
});

test('private product images are rendered through the scoped same-origin proxy', () => {
  const url = 'https://store-id.private.blob.vercel-storage.com/arabian-tailors/product-images/123e4567-e89b-12d3-a456-426614174000.jpg';
  assert.equal(productImageSource(url), '/api/product-image?pathname=arabian-tailors%2Fproduct-images%2F123e4567-e89b-12d3-a456-426614174000.jpg');
});

test('private Abaya gallery images use the same allowlisted proxy and path traversal is rejected', () => {
  const path = 'arabian-tailors/abaya-product-images/123e4567-e89b-12d3-a456-426614174000.jpg';
  const url = `https://store-id.private.blob.vercel-storage.com/${path}`;
  assert.equal(productImageSource(url), `/api/product-image?pathname=${encodeURIComponent(path)}`);
  assert.equal(isPublicProductImagePath(path), true);
  assert.equal(isPublicProductImagePath('arabian-tailors/abaya-product-images/../orders/order.json'), false);
});

test('public Blob images and unrelated private resources retain their original URL', () => {
  const publicUrl = 'https://store-id.public.blob.vercel-storage.com/arabian-tailors/product-images/model.jpg';
  const privateOrderUrl = 'https://store-id.private.blob.vercel-storage.com/arabian-tailors/orders/order-1.json';
  assert.equal(productImageSource(publicUrl), publicUrl);
  assert.equal(productImageSource(privateOrderUrl), privateOrderUrl);
});

test('proxy allowlist only permits image filenames under the product image prefix', () => {
  assert.equal(isPublicProductImagePath('arabian-tailors/product-images/abc-123.jpg'), true);
  assert.equal(isPublicProductImagePath('arabian-tailors/orders/order.json'), false);
  assert.equal(isPublicProductImagePath('arabian-tailors/product-images/../orders/order.json'), false);
  assert.equal(isPublicProductImagePath('arabian-tailors/product-images/not-an-image.txt'), false);
});
