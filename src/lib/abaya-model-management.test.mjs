import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { addAbayaModel, deleteAbayaModel, findAbayaModelStep, getAbayaModelSteps, normalizeAbayaModelCode, reorderAbayaModel, seedAbayaModelCustomization, updateAbayaModel, validateAbayaModelCodes } from './abaya-model-management.mjs';

const fixture = () => ({ id: 'abaya-parent', category: 'Abaya', customizationSteps: [
  { id: 'model-a', title: 'Select Abaya Model', options: [{ id: 'one', name: 'One', modelCode: 'ONE-1' }] },
  { id: 'model-b', title: 'Abaya Style', options: [{ id: 'two', name: 'Two', modelCode: 'TWO-2' }] },
] });
const dashboardSource = readFileSync(new URL('../app/admin/dashboard.tsx', import.meta.url), 'utf8');
const storeRouteSource = readFileSync(new URL('../app/api/store-data/route.ts', import.meta.url), 'utf8');
const customizeSource = readFileSync(new URL('../app/customize/page.tsx', import.meta.url), 'utf8');

test('Abaya models stay nested in their Abaya parent and Kandura is untouched', () => {
  const parent = fixture();
  const next = addAbayaModel(parent, { id: 'three', name: 'Three', modelCode: 'THREE-3' }, 'unused');
  assert.equal(next.id, parent.id);
  assert.equal(getAbayaModelSteps(next.customizationSteps)[0].options.length, 2);
  assert.equal(parent.customizationSteps[0].options.length, 1);
  const kandura = { ...parent, category: 'Kandura' };
  assert.strictEqual(addAbayaModel(kandura, { id: 'x' }, 'new-step'), kandura);
});

test('models from every Abaya model step resolve and edit in place', () => {
  const product = fixture();
  assert.equal(findAbayaModelStep(product.customizationSteps, 'two', 'model-b').id, 'model-b');
  const updated = updateAbayaModel(product, 'model-b', 'two', { name: 'Two updated', description: 'Details' });
  assert.equal(updated.customizationSteps[1].options[0].name, 'Two updated');
  assert.equal(product.customizationSteps[1].options[0].name, 'Two');
});

test('Abaya model ordering and deletion are scoped to the owning step', () => {
  const product = fixture();
  product.customizationSteps[0].options.push({ id: 'three', name: 'Three', modelCode: 'THREE-3' });
  const moved = reorderAbayaModel(product, 'model-a', 'three', -1);
  assert.deepEqual(moved.customizationSteps[0].options.map(({ id }) => id), ['three', 'one']);
  const deleted = deleteAbayaModel(moved, 'model-a', 'three');
  assert.deepEqual(deleted.customizationSteps[0].options.map(({ id }) => id), ['one']);
  assert.equal(deleted.customizationSteps[1].options[0].id, 'two');
});

test('model code validation requires unique safe codes while preserving legacy code-less models', () => {
  const product = fixture();
  assert.equal(normalizeAbayaModelCode(' noor-1 '), 'NOOR-1');
  assert.equal(validateAbayaModelCodes([product]).ok, true);
  const duplicate = structuredClone(product);
  duplicate.customizationSteps[1].options[0].modelCode = 'one-1';
  duplicate.customizationSteps[0].options[0].modelCode = 'ONE-1';
  assert.equal(validateAbayaModelCodes([duplicate]).code, 'ABAYA_MODEL_CODE_NOT_UNIQUE');
  const legacy = { id: 'legacy', category: 'Abaya', customizationSteps: [{ id: 'm', title: 'Model', options: [{ id: 'old', name: 'Old' }] }] };
  assert.equal(validateAbayaModelCodes([legacy], [legacy]).ok, true);
  const newModel = addAbayaModel(legacy, { id: 'new', name: 'New' }, '');
  assert.equal(validateAbayaModelCodes([newModel], [legacy]).ok, false);
});

test('Abaya model customization seed matches product options without copying size or measurement steps', () => {
  const product = { id: 'parent', category: 'Abaya', customizationSteps: [
    { id: 'model', title: 'Select Abaya Model', options: [] },
    { id: 'colors', title: 'Colour', required: true, options: [{ id: 'black', name: 'Black', swatch: '#000000' }] },
    { id: 'fabric', title: 'Fabric', options: [{ id: 'nida', name: 'Nida' }] },
    { id: 'size', title: 'Size', options: [{ id: 's', name: 'S' }] },
    { id: 'measure', title: 'Measurements', options: [{ id: 'chest', name: 'Chest' }] },
    { id: 'embroidery', title: 'Embroidery', options: [{ id: 'light', name: 'Light' }] },
  ] };
  let id = 0;
  const customization = seedAbayaModelCustomization(product, {}, () => `copy-${++id}`);
  assert.equal(customization.colors.required, true);
  assert.equal(customization.colors.options[0].name, 'Black');
  assert.notEqual(customization.colors.options[0].id, 'black');
  assert.equal(customization.fabrics.options[0].name, 'Nida');
  assert.deepEqual(customization.steps.map((step) => step.title), ['Embroidery']);
});

test('Abaya admin management uses the shared Kandura card and ModelWorkspace patterns', () => {
  assert.match(dashboardSource, /function AbayaManagementPanel[\s\S]*kandura-model-admin-card abaya-model-admin-card/);
  assert.match(dashboardSource, /onEditModel=\{openModelWorkspace\}/);
  assert.match(dashboardSource, /garmentName=\{productEditor\.category\.trim\(\)\.toLowerCase\(\)==='abaya'\?'Abaya':'Kandura'\}/);
  assert.match(dashboardSource, /Unique model code/);
  assert.match(dashboardSource, /Model photos/);
  assert.match(dashboardSource, /\['colors','Colours'\],\['fabrics','Fabrics'\],\['stitching','Stitching \/ Style'\]/);
  assert.match(dashboardSource, /Measurements/);
});

test('Kandura and Abaya use the same vertical customization editor and expandable option controls', () => {
  const editorStart = dashboardSource.indexOf('const renderProductCustomizationEditor=');
  const editorEnd = dashboardSource.indexOf('const renderCustomizationStep=', editorStart);
  const sharedEditor = dashboardSource.slice(editorStart, editorEnd);
  assert.match(sharedEditor, /ModelEditorSection/);
  assert.match(sharedEditor, /product-customization-sections/);
  assert.doesNotMatch(sharedEditor, /custom-category-grid/);
  assert.doesNotMatch(dashboardSource, /renderAbayaCustomizationEditor/);
  assert.match(dashboardSource, /renderProductCustomizationEditor\(\)/);
  assert.match(dashboardSource, /const renderCustomizationStep=[\s\S]*?expandedCustomizationOptionId===`\$\{step\.id\}:\$\{option\.id\}`/);
  assert.match(dashboardSource, /className="model-measurement-toggle" aria-expanded=\{editingMeasurementId===field\.id\}/);
  assert.match(dashboardSource, /function ManagedModelAdditionalSteps[\s\S]*?expandedOptionId===option\.id/);
  assert.match(dashboardSource, /expandedMeasurementFieldId===field\.id/);
  assert.match(dashboardSource, /className="model-option-editor"/);
});

test('Abaya saves validate model codes against existing store records and customer selections use saved model data', () => {
  assert.match(storeRouteSource, /validateAbayaModelCodes\(body\.products, store\.abayaProducts\)/);
  assert.match(storeRouteSource, /body\.resource === 'abayaCatalog'/);
  assert.match(storeRouteSource, /replaceCatalogCollection\(store\.products, store\.abayaProducts, 'products', body\.products\)/);
  assert.match(customizeSource, /selectedModelOption\?\.modelCustomization/);
  assert.match(customizeSource, /selectedAbayaModelEntry/);
  assert.match(customizeSource, /isAbayaModelStep\(baseCustomSteps\.find/);
  assert.match(customizeSource, /selectedModel:\s*\{/);
});
