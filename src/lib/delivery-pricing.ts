import { isOfficialIndiaPostPinSource } from './delivery-rule-csv.mjs';
import { effectiveAbayaPrice } from './abaya-product.mjs';
import { getAbayaCustomerSteps } from './abaya-size-options.mjs';

/** Fixed shop dispatch location shown in Admin; this is not a courier quote. */
export const DELIVERY_PICKUP_ORIGIN = 'Parappanangadi, Malappuram, Kerala, India';
/** Default owner-configured flat delivery fee; Admin can change it centrally. */
export const DEFAULT_FLAT_DELIVERY_FEE = 60;

/** Settings accept only finite INR amounts with cent precision. */
export function isValidFlatDeliveryFee(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && Math.round(value * 100) === value * 100;
}

/** Use the initial fee only when the stored value is absent or invalid. */
export function resolveFlatDeliveryFee(value: unknown): number {
  return isValidFlatDeliveryFee(value) ? value : DEFAULT_FLAT_DELIVERY_FEE;
}

/** Apply a validated fee update while preserving every other saved setting. */
export function withFlatDeliveryFee(settings: Record<string, unknown>, value: unknown): Record<string, unknown> | null {
  return isValidFlatDeliveryFee(value) ? { ...settings, flatDeliveryFee: value } : null;
}

/** Save the optional destination restriction mode without changing other settings. */
export function withDeliveryRestrictionMode(settings: Record<string, unknown>, value: unknown): Record<string, unknown> | null {
  return typeof value === 'boolean' ? { ...settings, restrictDeliveryToConfiguredRules: value } : null;
}

export type DeliveryRule = { id: string; area?: string; prefix: string; fee: number; enabled: boolean; pinSource?: string; feeSource?: string; imported?: boolean; rateProvider?: 'DTDC'; rateVerified?: boolean };
export type KeralaPostalDirectory = { sourceUrl: string; importedAt: string; pins: Array<{ pin: string; offices: Array<{ name: string; district?: string; deliveryStatus?: string }> }> };
type DeliveryLocation = { area?: string; district?: string; deliveryStatus?: string };
export type DeliveryQuote =
  | ({ status: 'invalid'; fee: null; message: string } & DeliveryLocation)
  | ({ status: 'unavailable'; fee: null; message: string } & DeliveryLocation)
  | ({ status: 'available'; fee: number; message: string } & DeliveryLocation);

/** Keep owner approval/source notes in authenticated Admin data only. */
export function publicDeliveryRules(rules: DeliveryRule[] = []): DeliveryRule[] {
  return rules.map(rule => {
    const approvedImported = rule.imported !== true || (Number.isInteger(rule.fee) && Boolean(rule.area?.trim()) && isOfficialIndiaPostPinSource(String(rule.pinSource || '')) && Boolean(rule.feeSource?.trim()));
    return { id: rule.id, area: rule.area, prefix: rule.prefix, fee: rule.fee, enabled: rule.enabled === true && approvedImported, ...(rule.rateProvider === 'DTDC' ? { rateProvider: 'DTDC' as const, rateVerified: Boolean(rule.feeSource?.trim()) } : {}) };
  });
}

/** Server-side payable total after the configured delivery fee and discount. */
export function calculateOrderTotal(subtotal: number, deliveryFee: number, discount = 0): number | null {
  if (![subtotal, deliveryFee, discount].every(Number.isFinite) || subtotal < 0 || deliveryFee < 0 || discount < 0 || discount > subtotal + deliveryFee) return null;
  return Math.round((subtotal + deliveryFee - discount) * 100) / 100;
}

/** Compare browser-claimed totals against the server's freshly calculated values. */
export function matchesOrderBreakdown(order: { subtotal?: unknown; deliveryFee?: unknown; discount?: unknown; total?: unknown }, subtotal: number, deliveryFee: number, discount = 0): boolean {
  const total = calculateOrderTotal(subtotal, deliveryFee, discount);
  return total !== null && Number(order.subtotal) === subtotal && Number(order.deliveryFee) === deliveryFee && Number(order.discount || 0) === discount && Number(order.total) === total;
}

/** Resolve an exact approved PIN fee before any broad zone; no match is never treated as free. */
export function quoteDelivery(postal: string, rules: DeliveryRule[] = [], directory?: KeralaPostalDirectory | null): DeliveryQuote {
  const pin = String(postal || '').trim();
  if (!/^[1-9]\d{5}$/.test(pin)) return { status: 'invalid', fee: null, message: 'Enter a valid 6-digit Indian PIN code to check delivery.' };
  const directoryEntry = directory?.pins?.find(entry => entry.pin === pin);
  const firstOffice = directoryEntry?.offices?.[0];
  const directoryInfo: DeliveryLocation = directoryEntry ? {
    area: directoryEntry.offices.map(office => office.name).slice(0, 3).join(', ') + (directoryEntry.offices.length > 3 ? ', …' : ''),
    ...(firstOffice?.district ? { district: firstOffice.district } : {}),
    ...(firstOffice?.deliveryStatus ? { deliveryStatus: firstOffice.deliveryStatus } : {}),
  } : {};
  const validRule = (item: DeliveryRule) => item?.enabled === true && typeof item.prefix === 'string' && /^\d{3,6}$/.test(item.prefix) && Number.isFinite(item.fee) && item.fee >= 0 && Math.round(item.fee * 100) === item.fee * 100 && (item.imported !== true || (Number.isInteger(item.fee) && typeof item.area === 'string' && Boolean(item.area.trim()) && typeof item.pinSource === 'string' && isOfficialIndiaPostPinSource(item.pinSource) && typeof item.feeSource === 'string' && Boolean(item.feeSource.trim())));
  const exact = rules.find(item => item?.prefix === pin);
  // An explicit exact-PIN rule, even when disabled, overrides a broader zone.
  const rule = exact
    ? validRule(exact) ? exact : undefined
    : rules
    .filter(item => item?.enabled === true && typeof item.prefix === 'string' && /^\d{3,6}$/.test(item.prefix) && pin.startsWith(item.prefix) && Number.isFinite(item.fee) && item.fee >= 0 && Math.round(item.fee * 100) === item.fee * 100 && (item.imported !== true || (Number.isInteger(item.fee) && typeof item.area === 'string' && Boolean(item.area.trim()) && typeof item.pinSource === 'string' && isOfficialIndiaPostPinSource(item.pinSource) && typeof item.feeSource === 'string' && Boolean(item.feeSource.trim()))) )
    .filter(item => item.prefix.length < 6)
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  const location = { ...directoryInfo, ...(rule?.area && !directoryInfo.area ? { area: rule.area } : {}) };
  if (!rule) return { status: 'unavailable', fee: null, message: 'Delivery pricing unavailable for this PIN code. The shop has not approved an enabled fee.', ...location };
  const fee = Math.round(rule.fee * 100) / 100;
  return { status: 'available', fee, message: fee === 0 ? 'Delivery Fee: FREE' : `Delivery Fee: ₹${fee.toLocaleString('en-IN')}`, ...location };
}

/**
 * Apply one global shop-configured fee to any format-valid Indian PIN by default.
 * PIN rules become an opt-in restriction only when the owner explicitly enables
 * restrictToConfiguredRules; their reference amounts never replace the flat fee.
 */
export function quoteFlatDelivery(
  postal: string,
  rules: DeliveryRule[] = [],
  directory?: KeralaPostalDirectory | null,
  configuredFee: unknown = DEFAULT_FLAT_DELIVERY_FEE,
  restrictToConfiguredRules = false,
): DeliveryQuote {
  const pin = String(postal || '').trim();
  if (!/^[1-9]\d{5}$/.test(pin)) return { status: 'invalid', fee: null, message: 'Enter a valid 6-digit Indian PIN code to check delivery.' };
  const coverage = restrictToConfiguredRules ? quoteDelivery(pin, rules, directory) : null;
  if (coverage && coverage.status !== 'available') return coverage;
  const fee = resolveFlatDeliveryFee(configuredFee);
  const directoryEntry = directory?.pins?.find(entry => entry.pin === pin);
  const firstOffice = directoryEntry?.offices?.[0];
  const directoryInfo: DeliveryLocation = directoryEntry ? {
    area: directoryEntry.offices.map(office => office.name).slice(0, 3).join(', ') + (directoryEntry.offices.length > 3 ? ', …' : ''),
    ...(firstOffice?.district ? { district: firstOffice.district } : {}),
    ...(firstOffice?.deliveryStatus ? { deliveryStatus: firstOffice.deliveryStatus } : {}),
  } : {};
  const roundedFee = Math.round(fee * 100) / 100;
  return { status: 'available', ...directoryInfo, ...(coverage?.area && !directoryInfo.area ? { area: coverage.area } : {}), fee: roundedFee, message: roundedFee === 0 ? 'Delivery Fee: FREE' : `Delivery Fee: ₹${roundedFee.toLocaleString('en-IN')}` };
}

type PriceOption = { id: string; name: string; priceAdjustment?: number; basePrice?: number; stock?: number; available?: boolean; visible?: boolean };
type PriceStep = { id: string; title: string; required?: boolean; available?: boolean; visible?: boolean; options: PriceOption[] };
type PriceProduct = { id: string; name: string; price: number; salePrice?: number | null; stock?: number; category?: string; customizationSteps?: PriceStep[] };

/** Calculate the merchandise subtotal from the current stored product configuration. */
export function calculateConfiguredSubtotal(product: PriceProduct, design: any, fabricProducts: PriceProduct[] = []): { ok: true; subtotal: number; basePrice: number } | { ok: false; error: string } {
  if (!product || !Number.isFinite(product.price) || product.price < 0) return { ok: false, error: 'The configured product price is unavailable.' };
  const steps = Array.isArray(product.customizationSteps) ? product.customizationSteps : [];
  // Product category comes from private store data; never let a browser-submitted design type disable Abaya validation.
  const isAbaya = String(product.category || '').trim().toLowerCase() === 'abaya';
  const quantity = isAbaya ? (design?.quantity ?? 1) : 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return { ok: false, error: 'Choose a quantity between 1 and 20.' };
  if (isAbaya && Number.isInteger(product.stock) && product.stock! > 0 && quantity > product.stock!) return { ok: false, error: 'The requested quantity exceeds the available product stock.' };
  const activeSteps = isAbaya ? getAbayaCustomerSteps(steps) : steps;
  const selections = Array.isArray(design?.customization) ? design.customization : [];
  const selectedModelId = typeof design?.selectedModel?.id === 'string' ? design.selectedModel.id : '';
  const modelStep = steps.find(step => isAbaya ? /model/i.test(step.title) || /^abaya\s*style$/i.test(step.title.trim()) : /model/i.test(step.title));
  const model = selectedModelId ? modelStep?.options.find(option => option.id === selectedModelId) : undefined;
  // A named model is optional; customers can describe the garment with a private reference photo or proceed without one.
  if (selectedModelId && (!model || modelStep?.available === false || modelStep?.visible === false || model.available === false || model.visible === false)) return { ok: false, error: 'The selected model is no longer available. Refresh your choices.' };
  const basePrice = isAbaya ? effectiveAbayaPrice(product) : model?.basePrice ?? product.price;
  if (!Number.isFinite(basePrice) || basePrice < 0) return { ok: false, error: 'The configured base price is invalid.' };
  let optionAdjustments = 0;
  const verifiedSelections = new Set<string>();
  const selectionKey = (stepId: string, optionId: string) => `${stepId}\u0000${optionId}`;
  const modelConfig = (model as any)?.modelCustomization;
  const categoryForTitle = (title: string) => /colou?r/i.test(title) ? 'colors' : /fabric|cloth/i.test(title) ? 'fabrics' : /stitch/i.test(title) ? 'stitching' : '';

  for (const step of activeSteps) {
    const category = categoryForTitle(step.title) as 'colors' | 'fabrics' | 'stitching' | '';
    const configuredModelStep = modelConfig?.steps?.find((candidate: any) => candidate.id === step.id);
    const categoryConfig = category ? modelConfig?.[category] : undefined;
    const effectiveStep = configuredModelStep
      ? { ...step, ...configuredModelStep, available: configuredModelStep.visible !== false }
      : categoryConfig
        ? { ...step, options: categoryConfig.options, required: categoryConfig.required ?? step.required, available: categoryConfig.visible !== false }
        : step;
    if (effectiveStep.available === false) continue;
    const submitted = selections.find((item: any) => item?.stepId === step.id);
    if (!submitted || !submitted.optionId) {
      if (effectiveStep.required && step.id !== modelStep?.id) return { ok: false, error: `Select an option for ${effectiveStep.title}.` };
      continue;
    }
    const option = effectiveStep.options.find((candidate: PriceOption) => candidate.id === submitted.optionId);
    if (!option || option.available === false || option.visible === false || (isAbaya && option.stock !== undefined && option.stock < quantity)) return { ok: false, error: `The selected ${effectiveStep.title} option does not have enough stock. Refresh your choices.` };
    if (submitted.option !== option.name || Number(submitted.priceAdjustment || 0) !== Number(option.priceAdjustment || 0)) return { ok: false, error: `The saved price for ${effectiveStep.title} changed. Refresh your choices.` };
    verifiedSelections.add(selectionKey(step.id, option.id));
    optionAdjustments += Number(option.priceAdjustment || 0);
  }

  // Per-model categories and extra steps use the same stored option records as product steps.
  if (model) {
    for (const category of ['colors', 'fabrics', 'stitching'] as const) {
      const configured = modelConfig?.[category];
      const categoryPattern = category === 'colors' ? /colou?r/i : category === 'fabrics' ? /fabric|cloth/i : /stitch/i;
      if (steps.some(step => categoryPattern.test(step.title))) continue;
      const stepId = `model-${model.id}-${category}`;
      const submitted = selections.find((item: any) => item?.stepId === stepId);
      if (!configured || configured.visible === false) continue;
      if (!submitted || !submitted.optionId) {
        if (configured.required) return { ok: false, error: `Select an option for ${category}.` };
        continue;
      }
      const option = configured.options?.find((candidate: PriceOption) => candidate.id === submitted.optionId);
      if (!option || option.available === false || option.visible === false || submitted.option !== option.name || Number(submitted.priceAdjustment || 0) !== Number(option.priceAdjustment || 0)) return { ok: false, error: `The selected ${category} option is unavailable or its price changed.` };
      optionAdjustments += Number(option.priceAdjustment || 0);
      verifiedSelections.add(selectionKey(stepId, option.id));
    }
    for (const configured of modelConfig?.steps || []) {
      if (configured.visible === false || steps.some(step => step.id === configured.id)) continue;
      const submitted = selections.find((item: any) => item?.stepId === configured.id);
      if (!submitted || !submitted.optionId) {
        if (configured.required) return { ok: false, error: `Select an option for ${configured.title}.` };
        continue;
      }
      const option = configured.options?.find((candidate: PriceOption) => candidate.id === submitted.optionId);
      if (!option || option.available === false || option.visible === false || submitted.option !== option.name || Number(submitted.priceAdjustment || 0) !== Number(option.priceAdjustment || 0)) return { ok: false, error: `The selected ${configured.title} option is unavailable or its price changed.` };
      optionAdjustments += Number(option.priceAdjustment || 0);
      verifiedSelections.add(selectionKey(configured.id, option.id));
    }
  }

  if (selections.some((selection: any) => selection?.optionId && !verifiedSelections.has(selectionKey(String(selection.stepId), String(selection.optionId))))) return { ok: false, error: 'A selected customization could not be verified. Refresh your choices.' };

  // Legacy configurable-garment UI prices fabric as a standalone Fabric product when no
  // product customization steps have yet been saved.
  let legacyFabric = 0;
  if (!steps.length && typeof design?.fabric === 'string' && design.fabric) {
    const configuredFabric = fabricProducts.find(item => item.name === design.fabric);
    if (configuredFabric) legacyFabric = configuredFabric.price;
    else if (Number(design.fabricPrice || 0) !== 0) return { ok: false, error: 'The selected fabric price could not be verified. Refresh your choices.' };
  }
  const legacyPriority = !steps.length && design?.speed === 'Priority tailoring' ? 350 : 0;
  const subtotal = Math.max(0, Math.round((basePrice + optionAdjustments + legacyFabric + legacyPriority) * quantity * 100) / 100);
  return { ok: true, basePrice, subtotal };
}
