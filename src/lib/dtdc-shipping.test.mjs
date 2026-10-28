import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisabledDtdcRateRule, getDtdcShippingQuote } from './dtdc-shipping.ts';
import { calculateOrderTotal, publicDeliveryRules } from './delivery-pricing.ts';

const directory = {
  sourceUrl: 'https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month',
  importedAt: '2026-10-28T00:00:00.000Z',
  pins: [{ pin: '676303', offices: [{ name: 'Ullanam B.O', district: 'Malappuram', deliveryStatus: 'Delivery' }] }],
};

test('DTDC quote request rejects an invalid destination PIN', () => {
  const quote = getDtdcShippingQuote('67630', directory);
  assert.equal(quote.status, 'invalid');
  assert.equal(quote.fee, null);
});

test('postal directory supplies area metadata but never implies a DTDC charge', () => {
  const quote = getDtdcShippingQuote('676303', directory);
  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.reason, 'rate_not_configured');
  assert.equal(quote.fee, null);
  assert.equal(quote.area, 'Ullanam B.O');
  assert.equal(quote.district, 'Malappuram');
  assert.match(quote.message, /not configured/);
});

test('generic owner delivery estimates cannot be used as DTDC charges', () => {
  const quote = getDtdcShippingQuote('676303', directory, [{ id: 'estimate', prefix: '676303', area: 'Ullanam', fee: 25, enabled: true }]);
  assert.equal(quote.status, 'unavailable');
  assert.equal('fee' in quote && quote.fee !== null, false);
});

test('only enabled DTDC-tagged rules with an owner-supplied quote reference are charged', () => {
  const rules = [
    { id: 'generic', prefix: '676', area: 'Generic area', fee: 40, enabled: true },
    { id: 'dtdc-disabled', prefix: '676303', area: 'Ullanam', fee: 82.5, enabled: false, rateProvider: 'DTDC', feeSource: 'DTDC quote ref' },
  ];
  assert.equal(getDtdcShippingQuote('676303', directory, rules).status, 'unavailable');
  const available = getDtdcShippingQuote('676303', directory, [{ ...rules[1], enabled: true }]);
  assert.equal(available.status, 'available');
  assert.equal(available.fee, 82.5);
  assert.equal(calculateOrderTotal(350, available.fee), 432.5);
  assert.equal(available.rateRuleId, 'dtdc-disabled');
  assert.equal(available.area, 'Ullanam B.O');
  const publicRate = publicDeliveryRules([{ ...rules[1], enabled: true }]);
  assert.equal(getDtdcShippingQuote('676303', directory, publicRate).fee, 82.5);
});

test('CSV-imported DTDC rate rows are converted to disabled, reference-backed exact rules', () => {
  const rule = createDisabledDtdcRateRule({ pin: '676303', area: 'Ullanam North', fee: 82.5, reference: 'DTDC quote 123' }, 'row-1');
  assert.deepEqual(rule, { id: 'row-1', area: 'Ullanam North', prefix: '676303', fee: 82.5, enabled: false, feeSource: 'DTDC quote 123', rateProvider: 'DTDC' });
  assert.equal(getDtdcShippingQuote('676303', directory, [rule]).status, 'unavailable');
  assert.throws(() => createDisabledDtdcRateRule({ pin: '67630', area: 'Area', fee: 10, reference: 'ref' }, 'bad'), /valid PIN/);
});

test('DTDC exact-PIN rates override zones and an exact disabled rate blocks a broader enabled zone', () => {
  const rules = [
    { id: 'zone', prefix: '676', area: 'Zone', fee: 90.25, enabled: true, rateProvider: 'DTDC', feeSource: 'Quote for zone' },
    { id: 'exact', prefix: '676303', area: 'Ullanam', fee: 82.5, enabled: true, rateProvider: 'DTDC', feeSource: 'Exact quote' },
  ];
  assert.equal(getDtdcShippingQuote('676303', directory, rules).fee, 82.5);
  assert.equal(getDtdcShippingQuote('676304', directory, rules).fee, 90.25);
  assert.equal(getDtdcShippingQuote('676303', directory, rules.map(rule => rule.id === 'exact' ? { ...rule, enabled: false } : rule)).status, 'unavailable');
});
