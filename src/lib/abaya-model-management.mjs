const isAbaya = (product) => String(product?.category || '').trim().toLowerCase() === 'abaya';

export function normalizeAbayaModelCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isAbayaModelStep(step) {
  return /model/i.test(String(step?.title || '').trim()) || /^abaya\s*style$/i.test(String(step?.title || '').trim());
}

export function getAbayaModelSteps(steps) {
  return Array.isArray(steps) ? steps.filter(isAbayaModelStep) : [];
}

export function seedAbayaModelCustomization(product, model, createId = () => `option-${crypto.randomUUID()}`) {
  if (!isAbaya(product) || !model || typeof createId !== 'function') return model?.modelCustomization || {};
  const prior = model.modelCustomization || {};
  const steps = Array.isArray(product.customizationSteps) ? product.customizationSteps : [];
  const sourceFor = (pattern) => steps.find((step) => pattern.test(String(step.title || '')));
  const copyOptions = (options = []) => options.map((option) => ({ ...option, id: createId(), images: [...(option.images || [])], image: option.image || '' }));
  const categories = {};
  for (const [key, pattern] of [['colors', /colou?r/i], ['fabrics', /fabric|cloth/i], ['stitching', /stitch/i]]) {
    const saved = prior[key];
    const source = sourceFor(pattern);
    categories[key] = saved || { visible: Boolean(source && source.available !== false), required: source?.required === true, options: copyOptions(source?.options) };
  }
  const extraSteps = prior.steps ?? steps
    .filter((step) => !isAbayaModelStep(step) && !/colou?r|fabric|cloth|stitch|size|measurement/i.test(String(step.title || '')))
    .map((step) => ({ id: createId(), title: step.title, description: step.description, visible: step.available !== false, required: step.required === true, options: copyOptions(step.options) }));
  return { ...categories, steps: extraSteps };
}

export function findAbayaModelStep(steps, modelId, preferredStepId) {
  if (typeof modelId !== 'string' || !modelId) return null;
  const matching = getAbayaModelSteps(steps).filter((step) => step.options?.some((model) => model?.id === modelId));
  return matching.find((step) => step.id === preferredStepId) || matching[0] || null;
}

export function addAbayaModel(product, model, fallbackStepId) {
  if (!isAbaya(product) || !model || typeof model.id !== 'string' || !model.id.trim()) return product;
  const steps = Array.isArray(product.customizationSteps) ? product.customizationSteps : [];
  const modelStep = steps.find(isAbayaModelStep);
  if (modelStep) return { ...product, customizationSteps: steps.map((step) => step.id === modelStep.id ? { ...step, options: [...(step.options || []), { ...model }] } : step) };
  if (typeof fallbackStepId !== 'string' || !fallbackStepId.trim()) return product;
  return { ...product, customizationSteps: [...steps, { id: fallbackStepId, title: 'Select Abaya Model', description: 'Choose an Abaya model.', required: false, available: true, options: [{ ...model }] }] };
}

export function updateAbayaModel(product, stepId, modelId, patch) {
  if (!isAbaya(product) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return product;
  const allowed = new Set(['name', 'modelCode', 'description', 'image', 'images', 'visible', 'available', 'priceAdjustment', 'basePrice', 'stock', 'modelCustomization']);
  const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
  return { ...product, customizationSteps: (product.customizationSteps || []).map((step) => step.id !== stepId || !isAbayaModelStep(step) ? step : { ...step, options: (step.options || []).map((model) => model.id === modelId ? { ...model, ...safePatch } : model) }) };
}

export function deleteAbayaModel(product, stepId, modelId) {
  if (!isAbaya(product)) return product;
  return { ...product, customizationSteps: (product.customizationSteps || []).map((step) => step.id === stepId && isAbayaModelStep(step) ? { ...step, options: (step.options || []).filter((model) => model.id !== modelId) } : step) };
}

export function reorderAbayaModel(product, stepId, modelId, direction) {
  if (!isAbaya(product) || ![-1, 1].includes(direction)) return product;
  return { ...product, customizationSteps: (product.customizationSteps || []).map((step) => {
    if (step.id !== stepId || !isAbayaModelStep(step)) return step;
    const options = [...(step.options || [])];
    const index = options.findIndex((model) => model.id === modelId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= options.length) return step;
    [options[index], options[target]] = [options[target], options[index]];
    return { ...step, options };
  }) };
}

/** New codes must be unique. Legacy models which already lack a code can still be edited. */
export function validateAbayaModelCodes(products, previousProducts = []) {
  const before = new Map((Array.isArray(previousProducts) ? previousProducts : []).map((product) => [product?.id, product]));
  const seen = new Set();
  for (const product of Array.isArray(products) ? products : []) {
    if (!isAbaya(product)) continue;
    const priorModels = new Map(getAbayaModelSteps(before.get(product.id)?.customizationSteps).flatMap((step) => step.options || []).map((model) => [model.id, model]));
    for (const model of getAbayaModelSteps(product.customizationSteps).flatMap((step) => step.options || [])) {
      const code = normalizeAbayaModelCode(model?.modelCode);
      const prior = priorModels.get(model.id);
      if (!code && prior && !normalizeAbayaModelCode(prior.modelCode)) continue;
      if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) return { ok: false, code: 'ABAYA_MODEL_CODE_INVALID', error: 'Each new Abaya model needs a 2–32 character code using letters, numbers, hyphens or underscores.' };
      if (seen.has(code)) return { ok: false, code: 'ABAYA_MODEL_CODE_NOT_UNIQUE', error: 'Each Abaya model code must be unique.' };
      seen.add(code);
    }
  }
  return { ok: true };
}
