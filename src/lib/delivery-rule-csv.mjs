const MAX_CSV_LENGTH = 1_000_000;
const MAX_ROWS = 2_000;
const MAX_POSTAL_CSV_LENGTH = 25_000_000;
const MAX_POSTAL_ROWS = 250_000;
const MAX_KERALA_POSTAL_OFFICES = 100_000;
const MAX_KERALA_PINS = 10_000;

function parseRecords(source) {
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) records.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('The CSV contains an unfinished quoted field.');
  row.push(cell.trim());
  if (row.some(value => value !== '')) records.push(row);
  return records;
}

const normalizeHeader = value => value.replace(/^\uFEFF/, '').trim().toLowerCase();

/** PIN source URLs must use India Post or the Government of India's postal directory record. */
export function isOfficialIndiaPostPinSource(value) {
  try {
    const url = new URL(value.trim());
    const indiaPost = url.hostname === 'indiapost.gov.in' || url.hostname.endsWith('.indiapost.gov.in');
    const governmentPostalDirectory = (url.hostname === 'data.gov.in' || url.hostname === 'www.data.gov.in')
      && /^\/(resource|catalog)\/all-india-pincode-directory(?:-through-webservice|-till-last-month)?\/?$/.test(url.pathname);
    return url.protocol === 'https:' && (indiaPost || governmentPostalDirectory);
  } catch {
    return false;
  }
}

const normalizeDirectoryHeader = value => normalizeHeader(value).replace(/[^a-z0-9]/g, '');

/**
 * Parse an owner-downloaded official all-India PIN directory into a Kerala-only
 * postal reference. This never creates or enables delivery prices.
 */
export function parseKeralaPinDirectoryCsv(source, sourceUrl) {
  if (typeof source !== 'string' || source.length > MAX_POSTAL_CSV_LENGTH) return { pins: [], errors: ['Postal directory CSV is too large (maximum 25 MB).'] };
  if (!isOfficialIndiaPostPinSource(String(sourceUrl || ''))) return { pins: [], errors: ['Use the HTTPS URL of the official India Post or Government of India PIN directory.'] };
  let records;
  try { records = parseRecords(source.replace(/^\uFEFF/, '')); }
  catch (error) { return { pins: [], errors: [error instanceof Error ? error.message : 'Could not parse postal directory CSV.'] }; }
  if (!records.length) return { pins: [], errors: ['Postal directory CSV is empty.'] };
  if (records.length - 1 > MAX_POSTAL_ROWS) return { pins: [], errors: [`Postal directory contains more than ${MAX_POSTAL_ROWS} rows.`] };
  const headers = records[0].map(normalizeDirectoryHeader);
  const findColumn = aliases => headers.findIndex(header => aliases.includes(header));
  const columns = {
    pin: findColumn(['pincode', 'pincode6', 'pin', 'pincodecode']),
    office: findColumn(['officename', 'postofficename', 'postoffice', 'office']),
    state: findColumn(['statename', 'state']),
    district: findColumn(['districtname', 'district']),
    delivery: findColumn(['delivery', 'deliverystatus', 'deliverytype']),
  };
  const missing = Object.entries(columns).filter(([key, index]) => index < 0 && ['pin', 'office', 'state'].includes(key)).map(([key]) => key);
  if (missing.length) return { pins: [], errors: [`Missing required postal directory columns: ${missing.join(', ')}. Required fields are PIN code, post-office name, and state.`] };

  const grouped = new Map();
  let keralaRows = 0;
  let officeCount = 0;
  const invalidRows = [];
  records.slice(1).forEach((record, index) => {
    const cell = key => record[columns[key]] || '';
    if (cell('state').trim().toLowerCase() !== 'kerala') return;
    keralaRows += 1;
    const pin = cell('pin').replace(/\s/g, '');
    const name = cell('office').trim();
    if (!/^[1-9]\d{5}$/.test(pin) || !name || name.length > 120) { invalidRows.push(index + 2); return; }
    const district = columns.district < 0 ? '' : cell('district').trim().slice(0, 100);
    const deliveryStatus = columns.delivery < 0 ? '' : cell('delivery').trim().slice(0, 60);
    const offices = grouped.get(pin) || [];
    const signature = `${name.toLowerCase()}\u0000${district.toLowerCase()}\u0000${deliveryStatus.toLowerCase()}`;
    if (offices.some(office => `${office.name.toLowerCase()}\u0000${(office.district || '').toLowerCase()}\u0000${(office.deliveryStatus || '').toLowerCase()}` === signature)) return;
    if (officeCount >= MAX_KERALA_POSTAL_OFFICES) return;
    offices.push({ name, ...(district ? { district } : {}), ...(deliveryStatus ? { deliveryStatus } : {}) });
    grouped.set(pin, offices);
    officeCount += 1;
  });
  if (invalidRows.length) return { pins: [], errors: [`${invalidRows.length} Kerala row${invalidRows.length === 1 ? '' : 's'} had an invalid PIN or post-office name (first affected CSV row: ${invalidRows[0]}). Correct or remove malformed rows before importing.`] };
  if (officeCount >= MAX_KERALA_POSTAL_OFFICES || grouped.size > MAX_KERALA_PINS) return { pins: [], errors: ['Filtered Kerala postal directory exceeds the safe storage limit. Use the official Kerala-circle directory or a smaller valid export.'] };
  if (!grouped.size) return { pins: [], errors: ['No Kerala PIN/post-office rows were found. Check that this is the official directory CSV with a State column.'] };
  const pins = [...grouped.entries()].map(([pin, offices]) => ({ pin, offices })).sort((a, b) => a.pin.localeCompare(b.pin));
  return { pins, keralaRows, officeCount, pinCount: pins.length, errors: [] };
}

/** Validate the bounded, public postal reference snapshot before persistence. */
export function isValidKeralaPinDirectory(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isOfficialIndiaPostPinSource(value.sourceUrl) || typeof value.importedAt !== 'string' || !Number.isFinite(Date.parse(value.importedAt)) || !Array.isArray(value.pins) || value.pins.length > MAX_KERALA_PINS) return false;
  const pins = new Set();
  let officesTotal = 0;
  return value.pins.every(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.pin !== 'string' || !/^[1-9]\d{5}$/.test(entry.pin) || pins.has(entry.pin) || !Array.isArray(entry.offices) || !entry.offices.length) return false;
    pins.add(entry.pin);
    officesTotal += entry.offices.length;
    return officesTotal <= MAX_KERALA_POSTAL_OFFICES && entry.offices.every(office => office && typeof office === 'object' && !Array.isArray(office) && typeof office.name === 'string' && office.name.trim().length > 0 && office.name.length <= 120 && (office.district === undefined || typeof office.district === 'string' && office.district.length <= 100) && (office.deliveryStatus === undefined || typeof office.deliveryStatus === 'string' && office.deliveryStatus.length <= 60));
  });
}

const parseEnabled = value => {
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'enabled'].includes(normalized)) return true;
  if (['false', 'no', '0', 'disabled'].includes(normalized)) return false;
  return null;
};

/** Parse an owner-supplied CSV into review rows. Imported records are never activated here. */
export function parseDeliveryRulesCsv(source) {
  if (source.length > MAX_CSV_LENGTH) return { rows: [], errors: ['CSV is too large (maximum 1 MB).'] };
  let records;
  try { records = parseRecords(source.replace(/^\uFEFF/, '')); }
  catch (error) { return { rows: [], errors: [error instanceof Error ? error.message : 'Could not parse CSV.'] }; }
  if (!records.length) return { rows: [], errors: ['CSV is empty. Download the template to see the required columns.'] };
  if (records.length - 1 > MAX_ROWS) return { rows: [], errors: [`CSV contains more than ${MAX_ROWS} data rows.`] };
  const headers = records[0].map(normalizeHeader);
  const column = aliases => headers.findIndex(header => aliases.includes(header));
  const columns = {
    pin: column(['pin code', 'pin code / prefix', 'pin code (6 digits) or prefix (3-5 digits)', 'pincode']),
    area: column(['area name', 'area']),
    fee: column(['delivery fee', 'delivery fee (inr)', 'delivery fee (₹)', 'fee']),
    enabled: column(['enabled', 'enabled status']),
    pinSource: column(['pin source', 'pin data source', 'pin source / official reference']),
    feeSource: column(['fee source / owner approval reference', 'fee source', 'owner approval reference']),
  };
  const missing = Object.entries(columns).filter(([, index]) => index < 0).map(([name]) => name);
  if (missing.length) return { rows: [], errors: [`Missing CSV columns: ${missing.join(', ')}. Download the template for the exact headers.`] };
  const rows = [];
  const errors = [];
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    const value = key => record[columns[key]] || '';
    const prefix = value('pin').replace(/\s/g, '');
    const area = value('area').trim();
    const rawFee = value('fee').trim();
    const enabled = parseEnabled(value('enabled'));
    const fee = rawFee === '' ? null : Number(rawFee);
    const rowErrors = [];
    if (!/^\d{3,6}$/.test(prefix)) rowErrors.push('PIN must be 3–6 digits.');
    if (!area || area.length > 120) rowErrors.push('Area name is required (maximum 120 characters).');
    if (rawFee !== '' && (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000)) rowErrors.push('Fee must be blank or a whole-rupee amount from ₹0 to ₹10,00,000.');
    if (enabled === null) rowErrors.push('Enabled must be true/false, yes/no, 1/0, or enabled/disabled.');
    if (value('pinSource').length > 500) rowErrors.push('PIN source must be at most 500 characters.');
    if (value('feeSource').length > 500) rowErrors.push('Fee approval reference must be at most 500 characters.');
    if (rowErrors.length) { errors.push(`Row ${rowNumber}: ${rowErrors.join(' ')}`); return; }
    rows.push({ rowNumber, prefix, area, fee, requestedEnabled: enabled, pinSource: value('pinSource'), feeSource: value('feeSource') });
  });
  return { rows, errors };
}

/** Parse owner-provided DTDC quote rows. Rates are staged, never activated by import. */
export function parseDtdcRatesCsv(source) {
  if (typeof source !== 'string' || source.length > MAX_CSV_LENGTH) return { rows: [], errors: ['DTDC rate CSV is too large (maximum 1 MB).'] };
  let records;
  try { records = parseRecords(source.replace(/^\uFEFF/, '')); }
  catch (error) { return { rows: [], errors: [error instanceof Error ? error.message : 'Could not parse DTDC rate CSV.'] }; }
  if (!records.length) return { rows: [], errors: ['DTDC rate CSV is empty. Download the template to see the required columns.'] };
  if (records.length - 1 > MAX_ROWS) return { rows: [], errors: [`DTDC rate CSV contains more than ${MAX_ROWS} data rows.`] };
  const headers = records[0].map(normalizeDirectoryHeader);
  const column = aliases => headers.findIndex(header => aliases.includes(header));
  const columns = {
    pin: column(['pincode', 'pin', 'destinationpincode']),
    area: column(['areaname', 'area', 'postofficearea']),
    fee: column(['verifieddtdcchargeinr', 'dtdcchargeinr', 'dtdccharge', 'verifiedchargeinr']),
    reference: column(['dtdcquotereference', 'dtdcchargereference', 'quotereference', 'ratereference']),
  };
  const missing = Object.entries(columns).filter(([, index]) => index < 0).map(([name]) => name);
  if (missing.length) return { rows: [], errors: [`Missing DTDC CSV columns: ${missing.join(', ')}. Required: PIN code, area name, verified DTDC charge (INR), and DTDC quote/reference.`] };
  const rows = [];
  const errors = [];
  const seen = new Set();
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    const value = key => record[columns[key]] || '';
    const pin = value('pin').replace(/\s/g, '');
    const area = value('area').trim();
    const rawFee = value('fee').trim();
    const fee = rawFee === '' ? null : Number(rawFee);
    const reference = value('reference').trim();
    const rowErrors = [];
    if (!/^[1-9]\d{5}$/.test(pin)) rowErrors.push('PIN must be an exact six-digit destination PIN.');
    if (seen.has(pin)) rowErrors.push('PIN is duplicated in this CSV.');
    seen.add(pin);
    if (!area || area.length > 120) rowErrors.push('Area name is required (maximum 120 characters).');
    if (!rawFee || !Number.isFinite(fee) || fee < 0 || fee > 1_000_000 || Math.round(fee * 100) !== fee * 100) rowErrors.push('DTDC charge must be a verified amount from ₹0 to ₹10,00,000 with at most two decimal places.');
    if (!reference || reference.length > 500) rowErrors.push('DTDC quote/reference is required (maximum 500 characters).');
    if (rowErrors.length) { errors.push(`Row ${rowNumber}: ${rowErrors.join(' ')}`); return; }
    rows.push({ rowNumber, pin, area, fee, reference });
  });
  return { rows, errors };
}
