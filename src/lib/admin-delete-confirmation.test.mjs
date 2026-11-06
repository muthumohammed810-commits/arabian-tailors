import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isAdminDeleteConfirmed } from './admin-delete-confirmation.mjs';

const dashboard = readFileSync(new URL('../app/admin/dashboard.tsx', import.meta.url), 'utf8');
const storeRoute = readFileSync(new URL('../app/api/store-data/route.ts', import.meta.url), 'utf8');

test('Admin delete dialog offers Cancel and Delete permanently without a typed ID field', () => {
  const dialog = dashboard.match(/\{confirmDelete&&([\s\S]*?)\n \{notice&&/)?.[1];
  assert.ok(dialog, 'shared delete confirmation dialog exists');
  assert.match(dialog, /Cancel<\/button>/);
  assert.match(dialog, /Delete permanently<\/button>/);
  assert.doesNotMatch(dialog, /<input|Type\s+.*(?:ID|identifier).*confirm/i);
  assert.match(dashboard, /action:'delete',confirmed:true/);
});

test('Admin delete confirmation accepts the dialog confirmation flag', () => {
  assert.equal(isAdminDeleteConfirmed({ id: 'order-1', confirmed: true }), true);
  assert.equal(isAdminDeleteConfirmed({ id: 'order-1', confirmed: false }), false);
  assert.equal(isAdminDeleteConfirmed({ id: 'order-1' }), false);
});

test('legacy typed confirmation payloads remain accepted for compatible clients', () => {
  assert.equal(isAdminDeleteConfirmed({ id: 'AT-123456', confirmation: 'AT-123456' }), true);
  assert.equal(isAdminDeleteConfirmed({ id: 'customer@example.com', confirmation: 'CUSTOMER@example.com' }, { caseInsensitiveLegacyMatch: true }), true);
  assert.equal(isAdminDeleteConfirmed({ id: 'AT-123456', confirmation: 'different' }), false);
});

test('order and customer delete routes retain authenticated confirmation validation', () => {
  assert.match(storeRoute, /if \(!await isAdminAuthenticated\(\)\) return json\(\{ error: 'Sign in required\.' \}, 401\)/);
  assert.match(storeRoute, /isAdminDeleteConfirmed\(body\)/);
  assert.match(storeRoute, /isAdminDeleteConfirmed\(body, \{ caseInsensitiveLegacyMatch: true \}\)/);
});
