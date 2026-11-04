import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminStoreResponse } from './admin-store-response.mjs';

test('authenticated Admin response preserves the complete private product records', () => {
  const product = {
    id: 'abaya-admin-full', name: 'Admin Abaya', category: 'Abaya', price: 5200,
    stock: 7, supplierCode: 'SUPPLIER-PRIVATE', adminNote: 'internal note',
    customizationSteps: [{ id: 'colour', title: 'Colour', visible: false, options: [{ id: 'draft', name: 'Draft', visible: false }] }],
  };
  const store = { products: [product], settings: { accountNumber: 'admin-only' }, abayaCatalogManaged: true };
  const response = buildAdminStoreResponse(store, [], [], { paid: 0, unpaid: 0, pending: 0 });
  assert.equal(response.products[0], product);
  assert.equal(response.products[0].supplierCode, 'SUPPLIER-PRIVATE');
  assert.equal(response.products[0].customizationSteps[0].options[0].visible, false);
  assert.equal(response.settings.accountNumber, 'admin-only');
  assert.equal(response.abayaCatalogManaged, true);
});
