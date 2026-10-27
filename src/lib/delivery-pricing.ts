export type DeliveryRule = { id: string; prefix: string; fee: number; enabled: boolean };
export type DeliveryQuote =
  | { status: 'invalid'; fee: null; message: string }
  | { status: 'unavailable'; fee: null; message: string }
  | { status: 'available'; fee: number; message: string };

/** Resolve the most specific configured PIN prefix. No matching rule is never treated as free. */
export function quoteDelivery(postal: string, rules: DeliveryRule[] = []): DeliveryQuote {
  const pin = String(postal || '').trim();
  if (!/^\d{6}$/.test(pin)) return { status: 'invalid', fee: null, message: 'Enter a valid 6-digit PIN code to check delivery.' };
  const rule = rules
    .filter(item => item?.enabled === true && typeof item.prefix === 'string' && /^\d{3,6}$/.test(item.prefix) && pin.startsWith(item.prefix) && Number.isFinite(item.fee) && item.fee >= 0)
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!rule) return { status: 'unavailable', fee: null, message: 'Delivery is not available for this PIN code. Please contact the atelier.' };
  return { status: 'available', fee: Math.round(rule.fee), message: rule.fee === 0 ? 'Delivery Fee: FREE' : `Delivery Fee: ₹${Math.round(rule.fee).toLocaleString('en-IN')}` };
}

type PriceOption = { id: string; name: string; priceAdjustment?: number; basePrice?: number; available?: boolean; visible?: boolean };
type PriceStep = { id: string; title: string; required?: boolean; available?: boolean; options: PriceOption[] };
type PriceProduct = { id: string; name: string; price: number; category?: string; customizationSteps?: PriceStep[] };

/** Calculate the merchandise subtotal from the current stored product configuration. */
export function calculateConfiguredSubtotal(product: PriceProduct, design: any, fabricProducts: PriceProduct[] = []): { ok: true; subtotal: number; basePrice: number } | { ok: false; error: string } {
  if (!product || !Number.isFinite(product.price) || product.price < 0) return { ok: false, error: 'The configured product price is unavailable.' };
  const steps = Array.isArray(product.customizationSteps) ? product.customizationSteps : [];
  const isAbaya = String(design?.productType || product.category || '').toLowerCase() === 'abaya';
  const activeSteps = isAbaya ? steps.filter(step => /model|abaya\s*style|style/i.test(step.title) || /size|measurement/i.test(step.title)) : steps;
  const selections = Array.isArray(design?.customization) ? design.customization : [];
  const selectedModelId = typeof design?.selectedModel?.id === 'string' ? design.selectedModel.id : '';
  const modelStep = steps.find(step => isAbaya ? /model|abaya\s*style|style/i.test(step.title) : /model/i.test(step.title));
  const model = selectedModelId ? modelStep?.options.find(option => option.id === selectedModelId) : undefined;
  const hasAbayaReference = Boolean(design?.customerReferencePhoto?.url);
  if (modelStep?.required && !model && !(isAbaya && hasAbayaReference)) return { ok: false, error: 'Choose an available model before continuing.' };
  if (selectedModelId && !model) return { ok: false, error: 'The selected model is no longer available. Refresh your choices.' };
  const basePrice = model?.basePrice ?? product.price;
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
      if (effectiveStep.required && !(isAbaya && step.id === modelStep?.id && hasAbayaReference)) return { ok: false, error: `Select an option for ${effectiveStep.title}.` };
      continue;
    }
    const option = effectiveStep.options.find((candidate: PriceOption) => candidate.id === submitted.optionId);
    if (!option || option.available === false || option.visible === false) return { ok: false, error: `The selected ${effectiveStep.title} option is unavailable. Refresh your choices.` };
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
  const subtotal = Math.max(0, Math.round((basePrice + optionAdjustments + legacyFabric + legacyPriority) * 100) / 100);
  return { ok: true, basePrice, subtotal };
}
