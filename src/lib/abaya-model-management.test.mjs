import assert from 'node:assert/strict';
import test from 'node:test';
import { addAbayaModel, areAbayaProductImagesFromStore, deleteAbayaModel, getAbayaModelSteps, hasAbayaModelPhoto, isAbayaModelStep, reorderAbayaModel, updateAbayaModel } from './abaya-model-management.mjs';
import { getAbayaCustomerSteps, publicAbayaProductProjection } from './abaya-size-options.mjs';
import { requestAdminStoreData } from './admin-store-request.ts';

const photo = (id = '12345678-1234-1234-1234-123456789abc') => `https://store-test.private.blob.vercel-storage.com/arabian-tailors/abaya-product-images/${id}.jpg`;
const storeId = 'store-test';
const baseProduct = () => ({
  id: 'abaya-noor', name: 'Noor Abaya', category: 'Abaya', price: 350, stock: 8, available: true,
  images: ['https://store-test.private.blob.vercel-storage.com/arabian-tailors/abaya-product-images/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg'],
  customizationSteps: [{ id: 'model-step', title: 'Select Abaya Model', required: false, options: [
    { id: 'classic', name: 'Classic', images: [photo()], image: photo(), visible: true, available: true, priceAdjustment: 0 },
    { id: 'open-front', name: 'Open Front', images: [], visible: true, available: true, priceAdjustment: 50 },
  ] }, { id: 'sizes', title: 'Select Size', options: [{ id: 's', name: 'S', description: 'Admin-approved size description' }] }],
});

test('adding an Abaya model adds an option to the selected parent product, not a product record', () => {
  const parent = baseProduct();
  const model = { id: 'kimono', name: 'Kimono', images: [], visible: true, available: true, priceAdjustment: 0 };
  const next = addAbayaModel(parent, model, 'unused-new-step');
  assert.equal(next.id, 'abaya-noor');
  assert.equal(next.customizationSteps[0].options.length, 3);
  assert.equal(next.customizationSteps[0].options[2].name, 'Kimono');
  assert.equal(parent.customizationSteps[0].options.length, 2, 'saved input remains immutable');
  const kandura = { ...parent, category: 'Kandura' };
  assert.strictEqual(addAbayaModel(kandura, model, 'new-step'), kandura, 'non-Abaya records are not changed');
});

test('a model step is created only when Admin adds a model; no example records are seeded', () => {
  const parent = { id: 'abaya-empty', name: 'Empty Abaya', category: 'Abaya', customizationSteps: [] };
  assert.deepEqual(getAbayaModelSteps(parent.customizationSteps), []);
  const next = addAbayaModel(parent, { id: 'draft', name: '', images: [], visible: true, available: true }, 'step-new');
  assert.deepEqual(next.customizationSteps[0].options.map(({ name }) => name), ['']);
  assert.equal(next.customizationSteps[0].title, 'Select Abaya Model');
});

test('model updates, visibility, reordering and deletion are scoped to the selected Abaya model step', () => {
  const parent = baseProduct();
  const edited = updateAbayaModel(parent, 'model-step', 'classic', { name: 'Classic Cut', images: [photo(), photo('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')], image: photo(), visible: false, priceAdjustment: 0, productCode: 'must-not-change-product-code' });
  const classic = edited.customizationSteps[0].options[0];
  assert.equal(classic.name, 'Classic Cut');
  assert.equal(classic.images.length, 2);
  assert.equal(classic.visible, false);
  assert.equal(classic.priceAdjustment, 0);
  assert.equal(edited.productCode, undefined, 'model edits cannot write product-level fields');
  assert.equal(parent.customizationSteps[0].options[0].name, 'Classic');

  const shown = updateAbayaModel(edited, 'model-step', 'classic', { visible: true });
  assert.equal(shown.customizationSteps[0].options[0].visible, true, 'Admin can restore a hidden model');
  const reordered = reorderAbayaModel(shown, 'model-step', 'open-front', -1);
  assert.deepEqual(reordered.customizationSteps[0].options.map(({ id }) => id), ['open-front', 'classic']);
  const removed = deleteAbayaModel(reordered, 'model-step', 'open-front');
  assert.deepEqual(removed.customizationSteps[0].options.map(({ id }) => id), ['classic']);
  assert.equal(removed.id, parent.id, 'deleting a model keeps its parent product');
  assert.equal(removed.price, parent.price);
  assert.equal(removed.stock, parent.stock);
  assert.deepEqual(removed.images, parent.images, 'product gallery remains separate');
  assert.deepEqual(removed.customizationSteps.find(({ id }) => id === 'sizes'), parent.customizationSteps[1], 'sizes and descriptions are preserved');
});

test('customer model choices require visible models with saved Abaya gallery photos', () => {
  const source = baseProduct();
  source.customizationSteps[0].options.push(
    { id: 'hidden', name: 'Hidden model', images: [photo('cccccccc-cccc-cccc-cccc-cccccccccccc')], visible: false },
    { id: 'external', name: 'Not an Abaya Blob photo', images: ['https://example.com/model.jpg'], visible: true },
  );
  const projected = publicAbayaProductProjection(source, storeId);
  const modelStep = projected.customizationSteps.find((step) => isAbayaModelStep(step));
  assert.deepEqual(modelStep.options.map(({ id }) => id), ['classic']);
  assert.equal(hasAbayaModelPhoto(modelStep.options[0], storeId), true);
  assert.equal(hasAbayaModelPhoto(source.customizationSteps[0].options[1], storeId), false);
  assert.equal(source.customizationSteps[0].options[1].visible, true, 'filtering does not alter saved Admin data');
});

test('customer receives an empty model step when all models are hidden or have no uploaded photo', () => {
  const steps = getAbayaCustomerSteps([{ id: 'models', title: 'Select Abaya Model', options: [
    { id: 'no-photo', name: 'No Photo', visible: true, images: [] },
    { id: 'hidden', name: 'Hidden', visible: false, images: [photo()] },
  ] }], storeId);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].options.length, 0, 'the customer can render the Models will be available soon message');
  assert.equal(steps[0].required, false);
});

test('customer projection shows an empty model-selection message state without inventing model records', () => {
  const projected = publicAbayaProductProjection({ id: 'abaya-empty', name: 'Empty Abaya', category: 'Abaya', price: 1000, customizationSteps: [] }, storeId);
  const models = projected.customizationSteps.find((step) => isAbayaModelStep(step));
  assert.ok(models, 'the customer page has a place to show Models will be available soon');
  assert.deepEqual(models.options, [], 'no fake model options are generated');
  assert.equal(projected.customizationSteps.length, 1);
});

test('Admin model edits survive a fresh request through isolated test storage and preserve size descriptions', async () => {
  const adminSessionFixture = Object.freeze({ authenticated: true, id: 'test-admin-fixture' });
  const temporaryStorage = (() => {
    let products = [baseProduct()];
    return {
      async read() { return structuredClone(products); },
      async write(nextProducts) { products = structuredClone(nextProducts); },
    };
  })();
  const fetcher = async (_url, init) => {
    assert.equal(adminSessionFixture.authenticated, true, 'the fixture represents an authenticated Admin session');
    assert.equal(init.credentials, 'same-origin');
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      assert.equal(body.resource, 'products');
      await temporaryStorage.write(body.products);
      return new Response(JSON.stringify({ ok: true, products: await temporaryStorage.read() }), { status: 200 });
    }
    return new Response(JSON.stringify({ products: await temporaryStorage.read() }), { status: 200 });
  };
  const parent = (await temporaryStorage.read())[0];
  const added = addAbayaModel(parent, { id: 'saved-model', name: 'Front View', image: photo('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), images: [photo('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')], visible: true, available: true, priceAdjustment: 0 }, 'unused-step');
  const edited = updateAbayaModel(added, 'model-step', 'saved-model', { description: 'Front view', images: [photo('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), photo('cccccccc-cccc-cccc-cccc-cccccccccccc')] });
  const saved = await requestAdminStoreData({
    method: 'PUT', body: { resource: 'products', products: [edited] }, timeoutMs: 100, fetcher,
    validate: (response) => JSON.stringify(response.products) === JSON.stringify([edited]),
  });
  assert.equal(saved.products.length, 1, 'the model remains an option on the parent product');

  const fresh = await requestAdminStoreData({ method: 'GET', timeoutMs: 100, fetcher, validate: (response) => Array.isArray(response.products) });
  const customerProduct = publicAbayaProductProjection(fresh.products[0], storeId);
  const modelStep = customerProduct.customizationSteps.find(isAbayaModelStep);
  assert.deepEqual(modelStep.options.map((model) => model.id), ['classic', 'saved-model'], 'only saved models with photos are projected');
  assert.equal(modelStep.options[1].images.length, 2, 'the saved model gallery survives the fresh read');
  assert.equal(customerProduct.customizationSteps.find((step) => step.id === 'sizes').options[0].description, 'Admin-approved size description');
  await temporaryStorage.write([]);
  assert.deepEqual(await temporaryStorage.read(), [], 'the isolated test storage is cleared');
});

test('model photos must match the configured store ID, private hostname, and Abaya UUID image path', () => {
  const valid = photo();
  const wrongStore = valid.replace('store-test.', 'store-other.');
  const staleStore = valid.replace('store-test.', 'store-old.');
  const invalidHost = valid.replace('store-test.private.blob.vercel-storage.com', 'example.com');
  const invalidPath = valid.replace('arabian-tailors/abaya-product-images/12345678-1234-1234-1234-123456789abc.jpg', 'arabian-tailors/orders/order.json');

  assert.equal(hasAbayaModelPhoto({ images: [valid] }, storeId), true, 'the configured store URL is accepted');
  for (const url of [wrongStore, staleStore, invalidHost, invalidPath]) {
    assert.equal(hasAbayaModelPhoto({ images: [url] }, storeId), false, `rejects ${url}`);
    const product = { ...baseProduct(), customizationSteps: [{ id: 'models', title: 'Select Abaya Model', options: [{ id: 'bad-model', name: 'Bad', image: url, images: [url] }] }] };
    assert.equal(areAbayaProductImagesFromStore(product, storeId), false, 'full product updates reject invalid model photo URLs');
    assert.deepEqual(publicAbayaProductProjection(product, storeId).customizationSteps[0].options, [], 'invalid model photos never enter customer options');
  }
  const mixedGallery = publicAbayaProductProjection({ ...baseProduct(), customizationSteps: [{ id: 'models', title: 'Select Abaya Model', options: [{ id: 'mixed', name: 'Mixed gallery', images: [valid, staleStore] }] }] }, storeId);
  assert.deepEqual(mixedGallery.customizationSteps[0].options[0].images, [valid], 'the customer projection strips every wrong-store gallery URL');
  assert.equal(areAbayaProductImagesFromStore({ ...baseProduct(), customizationSteps: [{ id: 'models', title: 'Select Abaya Model', options: [{ id: 'mixed', name: 'Mixed gallery', images: [valid, staleStore] }] }] }, storeId), false, 'a full product save rejects a mixed-store gallery');
  assert.equal(areAbayaProductImagesFromStore({ ...baseProduct(), customizationSteps: [{ id: 'models', title: 'Select Abaya Model', options: [{ id: 'ok', name: 'Valid', images: [valid] }] }] }, storeId), true);
  assert.equal(areAbayaProductImagesFromStore({ ...baseProduct(), images: [valid] }, storeId), true, 'the parent product gallery uses the same store identity');
  assert.equal(areAbayaProductImagesFromStore({ ...baseProduct(), images: [wrongStore] }, storeId), false, 'full Abaya updates validate the parent gallery too');
  assert.equal(areAbayaProductImagesFromStore({ ...baseProduct(), customizationSteps: [{ id: 'colors', title: 'Colour', options: [{ id: 'black', name: 'Black', images: [wrongStore] }] }] }, storeId), false, 'full Abaya updates validate option galleries too');
  assert.deepEqual(areAbayaProductImagesFromStore({ category: 'Kandura', customizationSteps: [{ title: 'Choose Your Kandura Model', options: [{ images: [wrongStore] }] }] }, storeId), true, 'the Abaya update validator does not change Kandura records');
});
