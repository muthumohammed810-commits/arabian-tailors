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

test('Abaya reference-photo choice is available before model selection while Kandura keeps its existing placement', () => {
  const initialSelection = customizeSource.indexOf('{step === 0 && hasAbayaProductSelectionStep ? (');
  const heading = customizeSource.indexOf('Select Abaya Model', initialSelection);
  const abayaReference = customizeSource.indexOf('<ModelReferencePhotoSection', heading);
  const abayaModels = customizeSource.indexOf('abaya-product-choice-grid', abayaReference);
  const kanduraReference = customizeSource.indexOf('{!isAbaya && supportsModelReference && <ModelReferencePhotoSection');
  assert.notEqual(initialSelection, -1);
  assert.ok(abayaReference > heading && abayaModels > abayaReference, 'Abaya photo choice renders before the initial model cards');
  assert.ok(kanduraReference > abayaModels, 'Kandura keeps the existing model-step placement');
  assert.match(customizeSource, /function ModelReferencePhotoSection\(/);
  assert.match(customizeSource, /productType: isAbaya \? \(selectedProduct\?\.category \|\| 'Abaya'\) : selectedProduct\?\.category \|\| 'Kandura'/);
  assert.match(customizeSource, /customerReferencePhoto: \{ url: modelReferencePhoto\.url, fileName: modelReferencePhoto\.name, uploaded: true \}/);
  assert.match(customizeSource, /const expectedPaymentAmount = isCustomReferenceOrder \? 500 : finalTotal/);
  assert.match(storeRouteSource, /createCustomReferenceOrderFields\(finalTotal\)/);
  assert.match(customizeSource, /If we are unable to create your requested design, your ₹500 advance will be fully refunded\./);
  assert.match(customizeSource, /100% REFUND GUARANTEE/);
});

test('Abaya reference upload renders on the initial selection step before model cards, with no duplicate Abaya uploader', () => {
  const initialStep = customizeSource.indexOf('{step === 0 && hasAbayaProductSelectionStep ? (');
  const heading = customizeSource.indexOf('Select Abaya Model', initialStep);
  const description = customizeSource.indexOf('Choose a piece from the current Abaya collection,', heading);
  const uploader = customizeSource.indexOf('<ModelReferencePhotoSection', description);
  const modelCards = customizeSource.indexOf('abaya-product-choice-grid', uploader);
  assert.ok(initialStep >= 0 && heading > initialStep && description > heading && uploader > description && modelCards > uploader);
  assert.equal((customizeSource.match(/<ModelReferencePhotoSection/g) || []).length, 2, 'one Abaya first-step instance and one shared Kandura instance');
  assert.match(customizeSource, /!isAbaya && supportsModelReference && <ModelReferencePhotoSection/);
  assert.doesNotMatch(customizeSource, /(?<![!])isAbaya && supportsModelReference && <ModelReferencePhotoSection/);
  assert.match(customizeSource, /canContinueAbayaReferenceChoice\(Boolean\(selectedProduct\), Boolean\(modelReferencePhoto\?\.url\), referencePhotoNotSaved\)/);
  assert.match(customizeSource, /productType: isAbaya \? \(selectedProduct\?\.category \|\| 'Abaya'\)/);
  assert.match(customizeSource, /photoOnlyAbayaRequest \? \{\} : abayaProductSnapshot/);
  assert.match(customizeSource, /photoOnlyAbayaRequest \? \{ basePrice: 0, options: \[\], customization: \[\], note \}/);
  assert.match(customizeSource, /!photoOnlyAbayaRequest \? selectedOptions : \{\}/);
  assert.match(storeRouteSource, /isPhotoOnlyAbayaReferenceOrder\(order\)/);
  assert.match(storeRouteSource, /product: photoOnlyAbayaOrder \? 'Abaya · Custom Reference' : order\.product/);
});
