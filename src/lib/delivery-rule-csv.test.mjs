import assert from 'node:assert/strict';
import test from 'node:test';
import { isOfficialIndiaPostPinSource, isValidKeralaPinDirectory, parseDeliveryRulesCsv, parseDtdcRatesCsv, parseKeralaPinDirectoryCsv } from './delivery-rule-csv.mjs';

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
  assert.equal(isOfficialIndiaPostPinSource('https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month'), true);
  assert.equal(isOfficialIndiaPostPinSource('https://data.gov.in/resource/unrelated-dataset'), false);
  assert.equal(isOfficialIndiaPostPinSource('https://data.gov.in.attacker.example/resource/all-india-pincode-directory-till-last-month'), false);
});

test('imports official postal rows for Kerala only and groups offices sharing one PIN', () => {
  const source = 'officename,pincode,officeType,DeliveryStatus,Districtname,statename\nParappanangadi S.O,676303,Sub Office,Delivery,Malappuram,Kerala\nUllanam B.O,676303,Branch Office,Delivery,Malappuram,Kerala\nOther State PO,676304,Branch Office,Delivery,Other District,Tamil Nadu';
  const result = parseKeralaPinDirectoryCsv(source, 'https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month');
  assert.equal(result.errors.length, 0);
  assert.equal(result.pinCount, 1);
  assert.equal(result.officeCount, 2);
  assert.deepEqual(result.pins[0], { pin: '676303', offices: [
    { name: 'Parappanangadi S.O', district: 'Malappuram', deliveryStatus: 'Delivery' },
    { name: 'Ullanam B.O', district: 'Malappuram', deliveryStatus: 'Delivery' },
  ] });
});

test('directory import rejects unverified sources and missing state/office/PIN fields', () => {
  const rows = 'officename,pincode,statename\nExample PO,676303,Kerala';
  assert.match(parseKeralaPinDirectoryCsv(rows, 'https://example.com/pins.csv').errors[0], /official/);
  assert.match(parseKeralaPinDirectoryCsv('pincode,officename\n676303,Example', 'https://www.indiapost.gov.in/rti/pincodelist').errors[0], /state/);
  assert.match(parseKeralaPinDirectoryCsv('x'.repeat(25_000_001), 'https://www.indiapost.gov.in/rti/pincodelist').errors[0], /25 MB/);
});

test('postal directory persisted-shape validation requires unique six-digit pins and official source', () => {
  const directory = { sourceUrl: 'https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month', importedAt: '2026-10-28T00:00:00.000Z', pins: [{ pin: '676303', offices: [{ name: 'Ullanam B.O', district: 'Malappuram', deliveryStatus: 'Delivery' }] }] };
  assert.equal(isValidKeralaPinDirectory(directory), true);
  assert.equal(isValidKeralaPinDirectory(null), true);
  assert.equal(isValidKeralaPinDirectory({ ...directory, sourceUrl: 'https://example.com/pins.csv' }), false);
  assert.equal(isValidKeralaPinDirectory({ ...directory, pins: [{ pin: '67630', offices: [{ name: 'Bad PIN' }] }] }), false);
  assert.equal(isValidKeralaPinDirectory({ ...directory, pins: [directory.pins[0], directory.pins[0]] }), false);
});

test('DTDC charge CSV accepts verified exact-PIN rates and references, without activating them', () => {
  const csv = 'PIN code,Area name,Verified DTDC charge (INR),DTDC quote/reference\n676303,"Ullanam North, Malappuram",82.50,Quote DT-2026-01';
  const result = parseDtdcRatesCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [{ rowNumber: 2, pin: '676303', area: 'Ullanam North, Malappuram', fee: 82.5, reference: 'Quote DT-2026-01' }]);
});

test('DTDC charge CSV rejects missing references, invalid PINs, duplicate PINs, and unsupported precision', () => {
  const result = parseDtdcRatesCsv('PIN code,Area name,Verified DTDC charge (INR),DTDC quote/reference\n676303,Area,82.555,ref\n676303,Duplicate,80,ref\n123,Invalid,40,ref\n676304,No reference,50,');
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 4);
  assert.match(result.errors.join(' '), /two decimal places/);
  assert.match(result.errors.join(' '), /duplicated/);
  assert.match(result.errors.join(' '), /six-digit/);
  assert.match(result.errors.join(' '), /reference is required/);
});
