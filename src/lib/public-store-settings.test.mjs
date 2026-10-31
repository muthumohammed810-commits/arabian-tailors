import assert from 'node:assert/strict';
import test from 'node:test';
import { publicStoreSettings } from './public-store-settings.mjs';

test('public settings omit private bank details while retaining storefront UPI configuration', () => {
  const settings = publicStoreSettings({
    storeName: 'Atelier', upiId: 'merchant@example', qr: 'saved-qr', accountName: 'Atelier Ltd',
    accountNumber: 'sensitive-account', ifsc: 'sensitive-ifsc', bankName: 'Configured Bank',
  });
  assert.equal(settings.upiId, 'merchant@example');
  assert.equal(settings.qr, 'saved-qr');
  assert.equal('accountName' in settings, false);
  assert.equal('bankName' in settings, false);
  assert.equal('accountNumber' in settings, false);
  assert.equal('ifsc' in settings, false);
});

test('public settings projection does not mutate the authenticated settings object', () => {
  const adminSettings = { accountName: 'preserved', accountNumber: 'preserved', bankName: 'preserved', ifsc: 'preserved', upiId: 'merchant@example' };
  const publicSettings = publicStoreSettings(adminSettings);
  assert.deepEqual(adminSettings, { accountName: 'preserved', accountNumber: 'preserved', bankName: 'preserved', ifsc: 'preserved', upiId: 'merchant@example' });
  assert.deepEqual(publicSettings, { upiId: 'merchant@example' });
});
