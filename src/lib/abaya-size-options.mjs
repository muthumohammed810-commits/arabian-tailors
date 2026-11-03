import { abayaModelPhotoUrls, hasAbayaModelPhoto, isAbayaModelStep } from './abaya-model-management.mjs';

export const ABAYA_STANDARD_SIZES = Object.freeze(['S', 'M', 'L', 'XL', 'XXL']);

/** Customization option descriptions are plain text bounded for safe persistence. */
export function isValidCustomizationOptionDescription(value) {
  return value === undefined || (typeof value === 'string' && value.length <= 500);
}

/** Return displayable size text, treating missing, empty, and whitespace-only descriptions as blank. */
export function getAbayaSizeDescription(option) {
  if (typeof option?.description !== 'string') return undefined;
  return option.description.trim() || undefined;
}

/** Update one standard Abaya size description without changing its price or other option settings. */
export function updateAbayaSizeDescription(steps, stepId, optionId, description) {
  if (!Array.isArray(steps) || typeof description !== 'string' || description.length > 500) return steps;
  return steps.map((step) => {
    if (step?.id !== stepId || getAbayaManagementStepKind(step.title) !== 'sizes' || !Array.isArray(step.options)) return step;
    return {
      ...step,
      options: step.options.map((option) => {
        if (option?.id !== optionId || !isStandardAbayaSize(option)) return option;
        return { ...option, description };
      }),
    };
  });
}

const isAbaya = (product) => String(product?.category || '').trim().toLowerCase() === 'abaya';

/** Assign each saved Abaya customization step to one Admin section only. */
export function getAbayaManagementStepKind(title) {
  const normalized = String(title || '').trim();
  if (/model/i.test(normalized) || /^abaya\s*style$/i.test(normalized)) return 'models';
  if (/colou?r/i.test(normalized)) return 'colors';
  if (/size/i.test(normalized)) return 'sizes';
  if (/fabric|cloth/i.test(normalized)) return 'fabrics';
  if (/measurement/i.test(normalized)) return 'measurements';
  if (/stitch|style/i.test(normalized)) return 'stitching';
  if (/custom|embroid|button|priority|extra|personal|collar|cuff|pocket|option/i.test(normalized)) return 'customization';
  return 'other';
}

/** Bulk product visibility is scoped to Abayas and leaves every other category untouched. */
export function setAbayaProductsVisibility(products, visible) {
  return products.map((product) => isAbaya(product) ? { ...product, available: visible } : product);
}

/** Bulk option visibility updates only the explicitly selected Abaya steps. */
export function setAbayaStepOptionsVisibility(steps, stepIds, visible) {
  const selected = new Set(stepIds);
  return steps.map((step) => selected.has(step.id)
    ? { ...step, ...(visible ? { available: true } : {}), options: step.options.map((option) => ({ ...option, visible })) }
    : step);
}

/** Reorder only Abaya products while keeping non-Abaya records in their original slots. */
export function reorderAbayaProducts(products, productId, direction) {
  const abayas = products.filter(isAbaya);
  const index = abayas.findIndex((product) => product.id === productId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= abayas.length) return products;
  [abayas[index], abayas[target]] = [abayas[target], abayas[index]];
  let nextIndex = 0;
  return products.map((product) => isAbaya(product) ? abayas[nextIndex++] : product);
}

function isStandardAbayaSize(option) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) return false;
  const name = option.name;
  return typeof name === 'string' && ABAYA_STANDARD_SIZES.includes(name.trim().toUpperCase());
}

/** @template {{id:string,title:string,options:unknown[],required?:boolean}} Step
 * @param {Step[]} steps
 * @returns {(Step & {title:string,required?:boolean,options:unknown[]})[]}
 */
export function getAbayaCustomerSteps(steps, abayaStoreId) {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    if (!step || step.available === false || step.visible === false) return [];
    const title = String(step.title || '').trim();
    const lower = title.toLowerCase();
    if (/fabric|cloth|measurement/.test(lower)) return [];
    const isModel = isAbayaModelStep(step);
    const isColor = /colou?r/.test(lower);
    const isSize = /^(?:(?:choose|select)\s+)?(?:abaya\s+)?size(?:\s+selection)?$/i.test(title);
    const isStitchingOrStyle = /stitch|style/.test(lower) && !isModel;
    const isCustomization = /custom|embroid|button|priority|extra|personal|collar|cuff|pocket|option/.test(lower);
    if (!isModel && !isColor && !isSize && !isStitchingOrStyle && !isCustomization) return [];
    const options = (Array.isArray(step.options) ? step.options : [])
      .filter((option) => option && typeof option === 'object' && option.visible !== false)
      .filter((option) => !isModel || hasAbayaModelPhoto(option, abayaStoreId))
      .filter((option) => !isSize || isStandardAbayaSize(option))
      .map((option) => isModel
        ? (() => {
          const images = abayaModelPhotoUrls(option, abayaStoreId);
          return { ...option, image: images[0] || '', images };
        })()
        : option);
    if (!options.length && !isSize && !isModel) return [];
    return [{
      ...step,
      title: isModel ? 'Select Abaya Model' : isColor ? 'Select Colour' : isSize ? 'Select Size' : title,
      ...(isModel ? { required: false } : {}),
      ...(isColor ? { required: step.required === true } : {}),
      options,
    }];
  });
}

/** Public Abaya data contains visible model, colour, standard-size, stitching and custom choices only. */
export function publicAbayaProductProjection(product, abayaStoreId) {
  if (!product || String(product.category || '').trim().toLowerCase() !== 'abaya') return product;
  const { measurements, measurementsEnabled, measurementGuides, measurementGuideVideo, ...publicProduct } = product;
  void measurements;
  void measurementsEnabled;
  void measurementGuides;
  void measurementGuideVideo;
  const sourceSteps = Array.isArray(product.customizationSteps) ? product.customizationSteps : [];
  const customizationSteps = getAbayaCustomerSteps(sourceSteps, abayaStoreId);
  if (!sourceSteps.some(isAbayaModelStep)) {
    customizationSteps.unshift({
      id: `${product.id}-customer-model-selection`,
      title: 'Select Abaya Model',
      description: 'Models will be available soon. You can also provide a reference photo.',
      required: false,
      options: [],
    });
  }
  return { ...publicProduct, customizationSteps };
}
