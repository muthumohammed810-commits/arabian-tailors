import assert from 'node:assert/strict';
import test from 'node:test';
import { getCustomerAbayaProducts } from './abaya-product-selection.mjs';
import {
  findRecordAcrossCatalogs,
  getUniqueCatalogRecordIds,
  keepLegacyAbayaAsProduct,
  moveLegacyAbayaToManagement,
  replaceCatalogCollection,
  replaceProductRecordsPreservingLegacyAbaya,
  splitProductRecords,
} from './abaya-data-separation.mjs';

const oldAbaya = () => ({
  id: 'legacy-abaya-1', category: 'Abaya', name: 'Noor', price: 1800, images: ['cover.jpg', 'detail.jpg'],
  customizationSteps: [{ id: 'model-step', title: 'Select Abaya Model', options: [{ id: 'model-1', name: 'Noor One' }] }],
});

test('Products updates preserve unclassified Abaya records unchanged and in order', () => {
  const legacy = oldAbaya();
  const current = [{ id: 'product-a', category: 'Accessory' }, legacy, { id: 'product-b', category: 'Kandura' }];
  const updatedA = { ...current[0], name: 'Edited product' };
  const updatedB = { ...current[2], name: 'Edited Kandura' };
  const merged = replaceProductRecordsPreservingLegacyAbaya(current, [updatedA, updatedB, { id: 'product-c', category: 'Accessory' }]);
  assert.deepEqual(merged, [updatedA, legacy, updatedB, { id: 'product-c', category: 'Accessory' }]);
  assert.strictEqual(merged[1], legacy);
});

test('Abaya Management receives its own records while legacy Abayas stay unclassified', () => {
  const legacy = oldAbaya();
  const dedicated = { id: 'abaya-new', category: 'Abaya', name: 'New' };
  const split = splitProductRecords([{ id: 'kandura', category: 'Kandura' }, legacy, { ...oldAbaya(), id: 'kept', catalogOwner: 'products' }]);
  assert.deepEqual(split.products.map((product) => product.id), ['kandura', 'kept']);
  assert.deepEqual(split.legacyAbayaProducts, [legacy]);
  assert.equal(dedicated.id, 'abaya-new');
});

test('explicit legacy move preserves the exact record, ID, galleries and nested options without duplication', () => {
  const legacy = oldAbaya();
  const result = moveLegacyAbayaToManagement([{ id: 'kandura', category: 'Kandura' }, legacy], [], legacy.id);
  assert.equal(result.ok, true);
  assert.deepEqual(result.products, [{ id: 'kandura', category: 'Kandura' }]);
  assert.strictEqual(result.abayaProducts[0], legacy);
  assert.equal(result.abayaProducts.filter((record) => record.id === legacy.id).length, 1);
});

test('explicit keep-as-Product classification does not create an Abaya Management duplicate', () => {
  const legacy = oldAbaya();
  const kept = keepLegacyAbayaAsProduct([legacy], legacy.id);
  assert.equal(kept.ok, true);
  assert.equal(kept.products[0].catalogOwner, 'products');
  assert.equal(splitProductRecords(kept.products).legacyAbayaProducts.length, 0);
  assert.equal(splitProductRecords(kept.products).products.length, 1);
  assert.equal(keepLegacyAbayaAsProduct([legacy, { ...legacy, name: 'Collision' }], legacy.id).code, 'PRODUCT_ID_CONFLICT');
});

test('ambiguous cross-catalog IDs fail closed', () => {
  assert.equal(findRecordAcrossCatalogs([{ id: 'same' }], [{ id: 'same' }], 'same'), null);
  const expected = { id: 'unique' };
  assert.strictEqual(findRecordAcrossCatalogs([], [expected], 'unique'), expected);
  assert.equal(moveLegacyAbayaToManagement([oldAbaya()], [{ id: 'legacy-abaya-1' }], 'legacy-abaya-1').code, 'PRODUCT_ID_CONFLICT');
  assert.deepEqual([...getUniqueCatalogRecordIds([{ id: 'same' }, { id: 'same' }, { id: 'unique' }, {}])], ['unique']);
});

test('Product Management updates only its collection and preserves Abaya Management records', () => {
  const products = [{ id: 'product-1', category: 'Kandura', name: 'Old Kandura' }];
  const abayaProducts = [{ id: 'abaya-1', category: 'Abaya', name: 'Noor', images: ['noor.jpg'] }];
  const nextProducts = [{ ...products[0], name: 'Updated Kandura' }];
  const result = replaceCatalogCollection(products, abayaProducts, 'products', nextProducts);
  assert.equal(result.ok, true);
  assert.deepEqual(result.products, nextProducts);
  assert.strictEqual(result.abayaProducts, abayaProducts);
  assert.equal(result.products.some((record) => record.id === 'abaya-1'), false);
});

test('Abaya Management updates only its collection and preserves Product records', () => {
  const products = [{ id: 'product-1', category: 'Kandura', name: 'Signature' }];
  const abayaProducts = [{ id: 'abaya-1', category: 'Abaya', name: 'Noor', images: ['old.jpg'] }];
  const nextAbaya = [{ ...abayaProducts[0], images: ['new.jpg'], price: 2400 }];
  const result = replaceCatalogCollection(products, abayaProducts, 'abaya', nextAbaya);
  assert.equal(result.ok, true);
  assert.strictEqual(result.products, products);
  assert.deepEqual(result.abayaProducts, nextAbaya);
  assert.equal(result.abayaProducts.some((record) => record.id === 'product-1'), false);
});

test('catalog replacement rejects cross-catalog ID reuse and unclassified Abaya in Products', () => {
  const products = [{ id: 'legacy', category: 'Abaya', name: 'Legacy' }];
  const abayaProducts = [{ id: 'abaya-1', category: 'Abaya', name: 'Noor' }];
  assert.equal(replaceCatalogCollection(products, abayaProducts, 'products', [{ id: 'abaya-1', category: 'Kandura' }]).code, 'CROSS_CATALOG_ID_CONFLICT');
  assert.equal(replaceCatalogCollection(products, abayaProducts, 'products', [products[0]]).code, 'UNCLASSIFIED_ABAYA');
  assert.equal(replaceCatalogCollection(products, abayaProducts, 'abaya', [{ id: 'legacy', category: 'Abaya', name: 'Copied' }]).code, 'CROSS_CATALOG_ID_CONFLICT');
});

test('customer Abaya choices read the dedicated and legacy Abaya collections, not Product Management records', () => {
  const dedicated = { id: 'abaya-managed', category: 'Abaya', name: 'Managed Noor', price: 2500, available: true };
  const legacy = oldAbaya();
  const productOwned = { id: 'abaya-product', category: 'Abaya', catalogOwner: 'products', name: 'Standalone Abaya Product', price: 900, available: true };
  const choices = getCustomerAbayaProducts([dedicated, legacy], { managed: true, fallbackProducts: [productOwned] });
  assert.deepEqual(choices.map((record) => record.id), ['abaya-managed', 'legacy-abaya-1']);
  assert.equal(choices.some((record) => record.id === productOwned.id), false);
});
