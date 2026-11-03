import assert from 'node:assert/strict';
import test from 'node:test';
import { getAbayaCustomerSteps, getAbayaManagementStepKind, getAbayaSizeDescription, isValidCustomizationOptionDescription, publicAbayaProductProjection, reorderAbayaProducts, setAbayaProductsVisibility, setAbayaStepOptionsVisibility, updateAbayaSizeDescription } from './abaya-size-options.mjs';
import { requestAdminStoreData } from './admin-store-request.ts';

test('each Abaya customization step has one Admin section, including miscellaneous options', () => {
  const cases = [
    ['Select Abaya Model', 'models'],
    ['Choose Abaya Colour', 'colors'],
    ['Select Size', 'sizes'],
    ['Fabric', 'fabrics'],
    ['Custom measurements', 'measurements'],
    ['Stitching / Style', 'stitching'],
    ['Embroidery', 'customization'],
    ['Buttons', 'customization'],
    ['Lining', 'other'],
  ];
  for (const [title, expected] of cases) assert.equal(getAbayaManagementStepKind(title), expected, title);
});

test('bulk model visibility changes Abaya products only and preserves non-Abaya records', () => {
  const products = [
    { id: 'a1', category: 'Abaya', available: true },
    { id: 'k1', category: 'Kandura', available: true },
    { id: 'a2', category: 'abaya', available: false },
  ];
  assert.deepEqual(setAbayaProductsVisibility(products, false), [
    { id: 'a1', category: 'Abaya', available: false },
    products[1],
    { id: 'a2', category: 'abaya', available: false },
  ]);
  assert.equal(products[0].available, true, 'bulk helper does not mutate stored state');
  assert.deepEqual(setAbayaProductsVisibility(products, true).map((product) => product.available), [true, true, true], 'Show All restores hidden Abaya products without touching Kandura');
});

test('bulk option visibility is limited to selected steps and leaves availability and other groups unchanged', () => {
  const steps = [
    { id: 'colors', options: [{ id: 'black', visible: true, available: true }, { id: 'beige', visible: true, available: false }] },
    { id: 'sizes', options: [{ id: 'm', visible: true, available: true }] },
    { id: 'stitching', options: [{ id: 'plain', visible: true, available: true }] },
    { id: 'custom', options: [{ id: 'embroidery', visible: true, available: true }] },
  ];
  const hidden = setAbayaStepOptionsVisibility(steps, ['colors'], false);
  assert.deepEqual(hidden[0].options.map((option) => option.visible), [false, false]);
  assert.deepEqual(hidden[0].options.map((option) => option.available), [true, false]);
  assert.deepEqual(hidden[1], steps[1]);
  assert.deepEqual(hidden[2], steps[2]);
  assert.deepEqual(hidden[3], steps[3]);
  const shown = setAbayaStepOptionsVisibility([{ id: 'colors', available: false, options: hidden[0].options }], ['colors'], true);
  assert.deepEqual(shown[0].options.map((option) => option.visible), [true, true]);
  assert.equal(shown[0].available, true, 'Show All restores the selected step as well as its options');
  const shownAllCategories = setAbayaStepOptionsVisibility(steps, ['colors', 'sizes', 'stitching', 'custom'], true);
  assert.ok(shownAllCategories.every((step) => step.options.every((option) => option.visible === true)), 'each scoped bulk category can restore all of its options');
});

test('Abaya product reordering keeps Kandura records in place and rejects out-of-range moves', () => {
  const products = [
    { id: 'a1', category: 'Abaya' },
    { id: 'k1', category: 'Kandura' },
    { id: 'a2', category: 'Abaya' },
    { id: 'a3', category: 'Abaya' },
  ];
  const reordered = reorderAbayaProducts(products, 'a2', 1);
  assert.deepEqual(reordered.map((product) => product.id), ['a1', 'k1', 'a3', 'a2']);
  assert.equal(reorderAbayaProducts(products, 'a1', -1), products);
  assert.deepEqual(products.map((product) => product.id), ['a1', 'k1', 'a2', 'a3']);
});

test('customer Abaya filtering excludes hidden steps, hidden options, fabrics, measurements and nonstandard sizes', () => {
  const steps = getAbayaCustomerSteps([
    { id: 'hidden', title: 'Stitching style', available: false, options: [{ id: 'hidden-step-option', name: 'A' }] },
    { id: 'color', title: 'Colour', options: [{ id: 'visible', name: 'Ivory', visible: true }, { id: 'hidden-option', name: 'Black', visible: false }, { id: 'sold-out', name: 'Navy', available: false, visible: true }] },
    { id: 'sizes', title: 'Size', options: [{ id: 'm', name: 'M' }, { id: 'xxxl', name: 'XXXL' }, { id: 'hidden-size', name: 'L', visible: false }] },
    { id: 'fabric', title: 'Fabric', options: [{ id: 'fabric-choice', name: 'Nida' }] },
    { id: 'measurements', title: 'Custom measurements', options: [{ id: 'chest', name: 'Chest' }] },
    { id: 'empty-style', title: 'Stitching Style', options: [{ id: 'hidden-style', name: 'Hidden', visible: false }] },
  ]);
  assert.deepEqual(steps.map((step) => step.id), ['color', 'sizes']);
  assert.deepEqual(steps[0].options.map((option) => option.id), ['visible', 'sold-out']);
  assert.deepEqual(steps[1].options.map((option) => option.id), ['m']);
});

test('customer Abaya size projection preserves optional per-size descriptions', () => {
  const steps = getAbayaCustomerSteps([
    { id: 'sizes', title: 'Select Size', options: [
      { id: 's', name: 'S', description: '23 to 45 cm' },
      { id: 'm', name: 'M', description: '26 to 48 cm' },
      { id: 'l', name: 'L' },
    ] },
  ]);

  assert.deepEqual(steps[0].options.map(({ name, description }) => ({ name, description })), [
    { name: 'S', description: '23 to 45 cm' },
    { name: 'M', description: '26 to 48 cm' },
    { name: 'L', description: undefined },
  ]);
});

test('Admin size editing updates, clears and preserves each Abaya size independently', () => {
  const steps = [
    { id: 'sizes', title: 'Select Size', required: true, options: [
      { id: 'size-s', name: 'S', description: 'Old S text', priceAdjustment: 0, visible: true, available: true, stock: 4 },
      { id: 'size-m', name: 'M', description: 'Existing M text', priceAdjustment: 120, visible: false, available: true, stock: 2 },
      { id: 'size-l', name: 'L', priceAdjustment: 0, visible: true, available: true },
    ] },
    { id: 'stitching', title: 'Stitching / Style', options: [{ id: 'plain', name: 'Plain' }] },
  ];

  const edited = updateAbayaSizeDescription(steps, 'sizes', 'size-s', '23 to 45 cm');
  assert.deepEqual(edited[0].options[0], { ...steps[0].options[0], description: '23 to 45 cm' }, 'price, stock and visibility settings are preserved');
  assert.deepEqual(edited[0].options[1], steps[0].options[1], 'other size settings remain untouched');
  assert.deepEqual(edited[1], steps[1], 'other customization sections remain untouched');

  const cleared = updateAbayaSizeDescription(edited, 'sizes', 'size-s', '');
  assert.equal(cleared[0].options[0].description, '', 'clearing saves a blank value');
  assert.equal(getAbayaSizeDescription(cleared[0].options[0]), undefined, 'blank text produces no customer placeholder');
  assert.equal(getAbayaSizeDescription(edited[0].options[0]), '23 to 45 cm', 'the edit does not mutate the prior product draft');
  assert.strictEqual(updateAbayaSizeDescription(steps, 'sizes', 'size-s', 'x'.repeat(501)), steps, 'over-limit text is rejected');
  assert.deepEqual(updateAbayaSizeDescription(steps, 'missing', 'size-s', 'text'), steps, 'an unknown step is ignored');
});

test('Admin-edited Abaya size descriptions save and reload through an isolated test storage adapter', async () => {
  const testAdminSession = Object.freeze({ authenticated: true, id: 'test-admin-fixture' });
  const temporaryStorage = (() => {
    let products = [];
    return {
      async read() { return structuredClone(products); },
      async write(nextProducts) { products = structuredClone(nextProducts); },
    };
  })();
  const testProduct = {
    id: 'test-abaya-size-descriptions',
    name: 'Test Abaya',
    category: 'Abaya',
    price: 1000,
    stock: 1,
    customizationSteps: [{ id: 'test-sizes', title: 'Select Size', options: [
      { id: 'size-s', name: 'S', priceAdjustment: 0, visible: true, available: true },
      { id: 'size-m', name: 'M', description: '' },
      { id: 'size-l', name: 'L' },
    ] }],
  };

  const testOnlyFetch = async (_url, init) => {
    assert.equal(testAdminSession.authenticated, true, 'the fixture represents an authenticated Admin session');
    assert.equal(init.credentials, 'same-origin', 'the existing Admin request helper carries session credentials');
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      assert.equal(body.resource, 'products');
      assert.ok(body.products.every((product) => product.customizationSteps?.every((step) => step.options.every((option) => isValidCustomizationOptionDescription(option.description)))));
      await temporaryStorage.write(body.products);
      return new Response(JSON.stringify({ ok: true, products: await temporaryStorage.read() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ products: await temporaryStorage.read() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const editedProduct = {
    ...testProduct,
    customizationSteps: updateAbayaSizeDescription(testProduct.customizationSteps, 'test-sizes', 'size-s', '23 to 45 cm'),
  };
  const saved = await requestAdminStoreData({
    method: 'PUT', body: { resource: 'products', products: [editedProduct] }, timeoutMs: 100,
    fetcher: testOnlyFetch,
    validate: (response) => JSON.stringify(response.products) === JSON.stringify([editedProduct]),
  });
  assert.equal(saved.products[0].customizationSteps[0].options[0].description, '23 to 45 cm');

  const freshlyLoaded = await requestAdminStoreData({
    method: 'GET', timeoutMs: 100, fetcher: testOnlyFetch,
    validate: (response) => Array.isArray(response.products),
  });
  const publicProduct = publicAbayaProductProjection(freshlyLoaded.products[0]);
  const sizeOptions = publicProduct.customizationSteps.find((step) => step.title === 'Select Size').options;

  assert.equal(sizeOptions.find((option) => option.name === 'S').description, '23 to 45 cm', 'the fresh store read retains the saved description');
  assert.equal(getAbayaSizeDescription(sizeOptions.find((option) => option.name === 'S')), '23 to 45 cm', 'the customer size-card renderer receives the text below the size name');
  assert.equal(getAbayaSizeDescription(sizeOptions.find((option) => option.name === 'M')), undefined, 'an empty description produces no customer placeholder');
  assert.equal(getAbayaSizeDescription(sizeOptions.find((option) => option.name === 'L')), undefined, 'a legacy size without a description remains valid');
  assert.equal(isValidCustomizationOptionDescription('x'.repeat(500)), true);
  assert.equal(isValidCustomizationOptionDescription('x'.repeat(501)), false);
  assert.equal(isValidCustomizationOptionDescription(23), false);
  await temporaryStorage.write([]);
  assert.deepEqual(await temporaryStorage.read(), [], 'the memory-only test storage is cleared after the scenario');
});
