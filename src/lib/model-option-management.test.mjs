import assert from 'node:assert/strict';
import test from 'node:test';
import { addModelOption, moveModelOption, patchModelCategory, removeModelOption, summarizeModelOptions, updateModelOption } from './model-option-management.ts';

const category = { visible: true, required: false, options: [{ id: 'ivory', name: 'Ivory', swatch: '#FFFFF0', priceAdjustment: 0 }] };

test('adding and editing custom colour names, swatches, prices, and visibility preserves category settings', () => {
  const added = addModelOption(category, { id: 'royal-blue', name: 'Royal Blue', swatch: '#173A6A', priceAdjustment: 25, available: true, visible: true });
  const edited = updateModelOption(added, 'royal-blue', { name: 'Midnight Blue', swatch: '#101B33', priceAdjustment: 40, available: false, visible: false });
  assert.equal(category.options.length, 1);
  assert.equal(edited.required, false);
  assert.deepEqual(edited.options[1], { id: 'royal-blue', name: 'Midnight Blue', swatch: '#101B33', priceAdjustment: 40, available: false, visible: false });
});

test('reordering and confirmed-delete operation helpers affect only the selected model category', () => {
  const fabrics = { visible: true, required: true, options: [{ id: 'cotton', name: 'Cotton' }, { id: 'linen', name: 'Linen' }] };
  const moved = moveModelOption(fabrics, 'linen', -1);
  assert.deepEqual(moved.options.map(option => option.id), ['linen', 'cotton']);
  assert.deepEqual(fabrics.options.map(option => option.id), ['cotton', 'linen']);
  const deleted = removeModelOption(moved, 'linen');
  assert.deepEqual(deleted.options.map(option => option.id), ['cotton']);
  assert.deepEqual(fabrics.options.map(option => option.id), ['cotton', 'linen']);
});

test('category summaries report option counts, photos, availability, and customer visibility', () => {
  assert.deepEqual(summarizeModelOptions({ options: [
    { id: 'a', name: 'Cotton', image: 'saved-url', available: true, visible: true },
    { id: 'b', name: 'Linen', available: false, visible: false },
    { id: 'c', name: 'Wool', images: ['saved-gallery-url'] },
  ] }), { total: 3, withPhotos: 2, available: 2, visible: 2 });
});

test('colour and fabric CRUD remains model-scoped and persisted selections keep name, image, swatch, and price', () => {
  const saudi = { id: 'saudi', name: 'Saudi Kandura', modelCustomization: { colors: category, fabrics: { visible: true, required: false, options: [] } } };
  const emirati = { id: 'emirati', name: 'Emirati Kandura', modelCustomization: { colors: { visible: true, required: false, options: [] }, fabrics: { visible: true, required: false, options: [] } } };
  let colors = addModelOption(saudi.modelCustomization.colors, { id: 'black', name: 'Black', swatch: '#000000', priceAdjustment: 0, available: true, visible: true });
  colors = updateModelOption(colors, 'black', { name: 'Midnight Black', swatch: '#101010', image: 'https://blob.vercel-storage.com/black.jpg', priceAdjustment: 75, available: false, visible: false });
  colors = updateModelOption(colors, 'black', { available: true, visible: true });
  colors = moveModelOption(colors, 'black', -1);
  const saudiAfterColor = patchModelCategory(saudi, 'colors', colors);

  let fabrics = addModelOption(saudiAfterColor.modelCustomization.fabrics, { id: 'linen', name: 'Linen', priceAdjustment: 100, available: true, visible: true });
  fabrics = updateModelOption(fabrics, 'linen', { image: 'https://blob.vercel-storage.com/linen.jpg', description: 'Lightweight linen', priceAdjustment: 125 });
  fabrics = updateModelOption(fabrics, 'linen', { available: false, visible: false });
  fabrics = updateModelOption(fabrics, 'linen', { available: true, visible: true });
  fabrics = moveModelOption(fabrics, 'linen', -1);
  const saudiAfterFabric = patchModelCategory(saudiAfterColor, 'fabrics', fabrics);
  const cleanColors = removeModelOption(saudiAfterFabric.modelCustomization.colors, 'ivory');
  const saved = JSON.parse(JSON.stringify(patchModelCategory(saudiAfterFabric, 'colors', cleanColors)));

  assert.equal(emirati.modelCustomization.colors.options.length, 0);
  assert.equal(saudi.modelCustomization.colors.options.length, 1);
  assert.equal(saved.modelCustomization.colors.options[0].name, 'Midnight Black');
  assert.equal(saved.modelCustomization.colors.options[0].swatch, '#101010');
  assert.equal(saved.modelCustomization.colors.options[0].image, 'https://blob.vercel-storage.com/black.jpg');
  assert.equal(saved.modelCustomization.colors.options[0].priceAdjustment, 75);
  assert.equal(saved.modelCustomization.fabrics.options[0].name, 'Linen');
  assert.equal(saved.modelCustomization.fabrics.options[0].image, 'https://blob.vercel-storage.com/linen.jpg');
  assert.equal(saved.modelCustomization.fabrics.options[0].priceAdjustment, 125);
  const visibleColorChoices = saved.modelCustomization.colors.options.filter(option => option.available !== false && option.visible !== false);
  const visibleFabricChoices = saved.modelCustomization.fabrics.options.filter(option => option.available !== false && option.visible !== false);
  assert.deepEqual(visibleColorChoices.map(option => [option.name, option.image, option.swatch, option.priceAdjustment]), [['Midnight Black', 'https://blob.vercel-storage.com/black.jpg', '#101010', 75]]);
  assert.deepEqual(visibleFabricChoices.map(option => [option.name, option.image, option.priceAdjustment]), [['Linen', 'https://blob.vercel-storage.com/linen.jpg', 125]]);
});
