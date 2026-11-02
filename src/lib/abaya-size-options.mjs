export const ABAYA_STANDARD_SIZES = Object.freeze(['S', 'M', 'L', 'XL', 'XXL']);

const isAbaya = (product) => String(product?.category || '').trim().toLowerCase() === 'abaya';

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
export function getAbayaCustomerSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    if (!step || step.available === false || step.visible === false) return [];
    const title = String(step.title || '').trim();
    const lower = title.toLowerCase();
    if (/fabric|cloth|measurement/.test(lower)) return [];
    const isModel = /model/.test(lower) || /^abaya\s*style$/i.test(title);
    const isColor = /colou?r/.test(lower);
    const isSize = /^(?:(?:choose|select)\s+)?(?:abaya\s+)?size(?:\s+selection)?$/i.test(title);
    const isStitchingOrStyle = /stitch|style/.test(lower) && !isModel;
    const isCustomization = /custom|embroid|button|priority|extra|personal|collar|cuff|pocket|option/.test(lower);
    if (!isModel && !isColor && !isSize && !isStitchingOrStyle && !isCustomization) return [];
    const options = (Array.isArray(step.options) ? step.options : [])
      .filter((option) => option && typeof option === 'object' && option.visible !== false)
      .filter((option) => !isSize || isStandardAbayaSize(option));
    if (!options.length && !isSize) return [];
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
export function publicAbayaProductProjection(product) {
  if (!product || String(product.category || '').trim().toLowerCase() !== 'abaya') return product;
  const { measurements, measurementsEnabled, measurementGuides, measurementGuideVideo, ...publicProduct } = product;
  void measurements;
  void measurementsEnabled;
  void measurementGuides;
  void measurementGuideVideo;
  return { ...publicProduct, customizationSteps: getAbayaCustomerSteps(Array.isArray(product.customizationSteps) ? product.customizationSteps : []) };
}
