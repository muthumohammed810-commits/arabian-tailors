const MAX_CSV_LENGTH = 1_000_000;
const MAX_ROWS = 2_000;

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
