import assert from 'node:assert/strict';
import test from 'node:test';
import { getAbayaCustomerSteps, getAbayaManagementStepKind, reorderAbayaProducts, setAbayaProductsVisibility, setAbayaStepOptionsVisibility } from './abaya-size-options.mjs';

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
