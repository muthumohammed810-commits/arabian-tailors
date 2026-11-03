import { isAbayaProductImageUrlForStore } from './abaya-product.mjs';

const isAbayaProduct = (product) => String(product?.category || '').trim().toLowerCase() === 'abaya';

export function isAbayaModelStep(step) {
  const title = String(step?.title || '').trim();
  return /model/i.test(title) || /^abaya\s*style$/i.test(title);
}

export function getAbayaModelSteps(steps) {
  return Array.isArray(steps) ? steps.filter(isAbayaModelStep) : [];
}

export function abayaModelPhotoUrls(model, storeId) {
  const urls = [model?.image, ...(Array.isArray(model?.images) ? model.images : [])];
  return [...new Set(urls.filter((url) => isAbayaProductImageUrlForStore(url, storeId)))];
}

/** A model is eligible only when at least one gallery image belongs to the configured Abaya store. */
export function hasAbayaModelPhoto(model, storeId) {
  return abayaModelPhotoUrls(model, storeId).length > 0;
}

/** Validate every non-empty Abaya product and option gallery URL before a whole-product save. */
export function areAbayaProductImagesFromStore(product, storeId) {
  if (!isAbayaProduct(product)) return true;
  const galleryIsFromStore = (record) => {
    const urls = [record?.image, ...(Array.isArray(record?.images) ? record.images : [])]
      .filter((url) => typeof url === 'string' && url.trim());
    return urls.every((url) => isAbayaProductImageUrlForStore(url, storeId));
  };
  return galleryIsFromStore(product) && (Array.isArray(product.customizationSteps) ? product.customizationSteps : []).every((step) =>
    (Array.isArray(step?.options) ? step.options : []).every(galleryIsFromStore),
  );
}

/** Add one model option inside its parent Abaya product; never creates a product record. */
export function addAbayaModel(product, model, newStepId) {
  if (!isAbayaProduct(product) || !model || typeof model.id !== 'string' || !model.id.trim()) return product;
  const steps = Array.isArray(product.customizationSteps) ? product.customizationSteps : [];
  const index = steps.findIndex(isAbayaModelStep);
  if (index >= 0) {
    const nextSteps = steps.map((step, stepIndex) => stepIndex === index
      ? { ...step, options: [...step.options, { ...model }] }
      : step);
    return { ...product, customizationSteps: nextSteps };
  }
  if (typeof newStepId !== 'string' || !newStepId.trim()) return product;
  return {
    ...product,
    customizationSteps: [...steps, {
      id: newStepId,
      title: 'Select Abaya Model',
      description: 'Choose a model with an uploaded photo, or provide a reference photo.',
      required: false,
      available: true,
      options: [{ ...model }],
    }],
  };
}

const editableModelFields = new Set(['name', 'description', 'image', 'images', 'visible', 'available', 'priceAdjustment', 'basePrice', 'stock']);

export function updateAbayaModel(product, stepId, modelId, patch) {
  if (!isAbayaProduct(product) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return product;
  const updates = Object.fromEntries(Object.entries(patch).filter(([key]) => editableModelFields.has(key)));
  return {
    ...product,
    customizationSteps: (product.customizationSteps || []).map((step) => step.id !== stepId || !isAbayaModelStep(step)
      ? step
      : { ...step, options: step.options.map((model) => model.id === modelId ? { ...model, ...updates } : model) }),
  };
}

export function deleteAbayaModel(product, stepId, modelId) {
  if (!isAbayaProduct(product)) return product;
  return {
    ...product,
    customizationSteps: (product.customizationSteps || []).map((step) => step.id !== stepId || !isAbayaModelStep(step)
      ? step
      : { ...step, options: step.options.filter((model) => model.id !== modelId) }),
  };
}

export function reorderAbayaModel(product, stepId, modelId, direction) {
  if (!isAbayaProduct(product) || ![-1, 1].includes(direction)) return product;
  return {
    ...product,
    customizationSteps: (product.customizationSteps || []).map((step) => {
      if (step.id !== stepId || !isAbayaModelStep(step)) return step;
      const options = [...step.options];
      const index = options.findIndex((model) => model.id === modelId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= options.length) return step;
      [options[index], options[target]] = [options[target], options[index]];
      return { ...step, options };
    }),
  };
}
