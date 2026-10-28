import type { DeliveryRule, KeralaPostalDirectory } from './delivery-pricing';

export type DtdcShippingQuote =
  | { status: 'invalid'; fee: null; message: string; area?: string; district?: string; deliveryStatus?: string }
  | { status: 'unavailable'; fee: null; message: string; reason: 'rate_not_configured'; area?: string; district?: string; deliveryStatus?: string }
  | { status: 'available'; fee: number; currency: 'INR'; provider: 'DTDC'; rateRuleId: string; message: string; area?: string; district?: string; deliveryStatus?: string };

export function createDisabledDtdcRateRule(row: { pin: string; area: string; fee: number; reference: string }, id: string): DeliveryRule {
  if (!/^[1-9]\d{5}$/.test(row.pin) || !row.area.trim() || !Number.isFinite(row.fee) || row.fee < 0 || row.fee > 1_000_000 || Math.round(row.fee * 100) !== row.fee * 100 || !row.reference.trim()) {
    throw new Error('A DTDC rate needs a valid PIN, area, verified amount, and quote reference.');
  }
  return { id, area: row.area.trim(), prefix: row.pin, fee: Math.round(row.fee * 100) / 100, enabled: false, feeSource: row.reference.trim(), rateProvider: 'DTDC' };
}

/**
 * Resolves an owner-imported DTDC charge table. This is not a live DTDC API
 * quote: the owner is responsible for importing a verified DTDC charge and
 * explicitly enabling it. Generic shop delivery estimates are never eligible.
 */
export function getDtdcShippingQuote(postal: string, directory?: KeralaPostalDirectory | null, rules: DeliveryRule[] = []): DtdcShippingQuote {
  const pin = String(postal || '').trim();
  if (!/^[1-9]\d{5}$/.test(pin)) {
    return { status: 'invalid', fee: null, message: 'Enter a valid 6-digit Indian PIN code to check DTDC delivery charge.' };
  }
  const entry = directory?.pins?.find(item => item.pin === pin);
  const firstOffice = entry?.offices?.[0];
  const location: { area?: string; district?: string; deliveryStatus?: string } = entry ? {
    area: entry.offices.map(office => office.name).slice(0, 3).join(', ') + (entry.offices.length > 3 ? ', …' : ''),
    ...(firstOffice?.district ? { district: firstOffice.district } : {}),
    ...(firstOffice?.deliveryStatus ? { deliveryStatus: firstOffice.deliveryStatus } : {}),
  } : {};
  const eligible = (rule: DeliveryRule) => rule?.rateProvider === 'DTDC'
    && (rule.rateVerified === true || Boolean(rule.feeSource?.trim()))
    && typeof rule.prefix === 'string' && /^\d{3,6}$/.test(rule.prefix)
    && Number.isFinite(rule.fee) && rule.fee >= 0 && rule.fee <= 1_000_000
    && Math.round(rule.fee * 100) === rule.fee * 100;
  const exactCandidate = rules.find(rule => rule?.rateProvider === 'DTDC' && rule.prefix === pin);
  const exact = exactCandidate && eligible(exactCandidate) ? exactCandidate : undefined;
  const rateRule = exactCandidate
    ? exact?.enabled ? exact : undefined
    : rules.filter(rule => eligible(rule) && rule.enabled && rule.prefix.length < 6 && pin.startsWith(rule.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (rateRule) {
    const fee = Math.round(rateRule.fee * 100) / 100;
    return { status: 'available', fee, currency: 'INR', provider: 'DTDC', rateRuleId: rateRule.id, message: fee === 0 ? 'DTDC delivery charge: FREE' : `DTDC delivery charge: ₹${fee.toLocaleString('en-IN')}`, ...location, ...(!location.area && rateRule.area ? { area: rateRule.area } : {}) };
  }
  return {
    status: 'unavailable',
    fee: null,
    reason: 'rate_not_configured',
    message: 'DTDC delivery charge is not configured for this PIN. Import a verified DTDC charge, review it, and enable the rule before checkout.',
    ...location,
  };
}
