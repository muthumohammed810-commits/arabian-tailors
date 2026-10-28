import assert from 'node:assert/strict';
import test from 'node:test';
import { isOfficialIndiaPostPinSource, parseDeliveryRulesCsv } from './delivery-rule-csv.mjs';

const headers = 'PIN code,Area name,Delivery fee (INR),Enabled,PIN source,Fee source / owner approval reference';

test('parses owner-supplied PIN and fee sources, including quoted commas', () => {
  const result = parseDeliveryRulesCsv(`${headers}\n676303,"Ullanam North, Malappuram",,false,https://www.indiapost.gov.in/rti/pincodelist,Pending owner fee approval`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows[0], {
    rowNumber: 2,
    prefix: '676303',
    area: 'Ullanam North, Malappuram',
    fee: null,
    requestedEnabled: false,
    pinSource: 'https://www.indiapost.gov.in/rti/pincodelist',
    feeSource: 'Pending owner fee approval',
  });
});

test('does not invent a fee for blank fee cells and parses an approved zero fee distinctly', () => {
  const result = parseDeliveryRulesCsv(`${headers}\n676303,Area A,,false,India Post,Owner decision required\n676304,Area B,0,true,India Post,Owner approved free delivery`);
  assert.equal(result.rows[0].fee, null);
  assert.equal(result.rows[1].fee, 0);
  assert.equal(result.rows[1].requestedEnabled, true);
});

test('rejects invalid PINs, missing area names, invalid enabled values, and malformed quotes', () => {
  const result = parseDeliveryRulesCsv(`${headers}\n1234567,Too long,50,false,source,approval\n676303,,50,false,source,approval\n676304,Area,50,maybe,source,approval`);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 3);
  assert.match(parseDeliveryRulesCsv(`${headers}\n676303,"unfinished`).errors[0], /unfinished quoted field/);
});

test('requires the source and approval-reference columns and bounds CSV size', () => {
  assert.match(parseDeliveryRulesCsv('PIN code,Area name,Delivery fee,Enabled\n').errors[0], /Missing CSV columns/);
  assert.match(parseDeliveryRulesCsv('x'.repeat(1_000_001)).errors[0], /too large/);
});

test('does not accept fractional fees that checkout would otherwise round', () => {
  const result = parseDeliveryRulesCsv(`${headers}\n676303,Area,12.5,false,India Post,Owner approved`);
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0], /whole-rupee amount/);
});

test('PIN source references must use the official India Post HTTPS domain', () => {
  assert.equal(isOfficialIndiaPostPinSource('https://www.indiapost.gov.in/rti/pincodelist'), true);
  assert.equal(isOfficialIndiaPostPinSource('http://www.indiapost.gov.in/rti/pincodelist'), false);
  assert.equal(isOfficialIndiaPostPinSource('https://indiapost.gov.in.example.org/pincode'), false);
});
