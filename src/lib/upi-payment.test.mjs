import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpiPaymentUrl } from './upi-payment.ts';

test('uses the configured merchant UPI ID, exact amount, merchant label and unique reference', () => {
  const url = new URL(createUpiPaymentUrl('atelier@upi', 3250.5, 'AT-001122') );
  assert.equal(url.protocol, 'upi:');
  assert.equal(url.hostname, 'pay');
  assert.equal(url.searchParams.get('pa'), 'atelier@upi');
  assert.equal(url.searchParams.get('pn'), 'Arabian Tailors');
  assert.equal(url.searchParams.get('am'), '3250.50');
  assert.equal(url.searchParams.get('cu'), 'INR');
  assert.equal(url.searchParams.get('tr'), 'AT-001122');
  assert.ok(url.search.includes('pa=atelier%40upi'));
  assert.ok(url.search.includes('pn=Arabian+Tailors'));
  assert.ok(url.search.includes('tn=Arabian+Tailors+order+AT-001122'));
});

test('does not create a payment URL without configured merchant details or valid amount', () => {
  assert.equal(createUpiPaymentUrl('', 100, 'AT-001122'), null);
  assert.equal(createUpiPaymentUrl('shop@upi', 0, 'AT-001122'), null);
  assert.equal(createUpiPaymentUrl('shop@upi', 100, ''), null);
});
