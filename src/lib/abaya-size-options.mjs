export const ABAYA_STANDARD_SIZES = Object.freeze(['S', 'M', 'L', 'XL', 'XXL']);

function isStandardAbayaSize(option) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) return false;
  const name = option.name;
  return typeof name === 'string' && ABAYA_STANDARD_SIZES.includes(name.trim().toUpperCase());
}

/** Options with hidden, unavailable, or exhausted inventory are never customer choices. */
export function isCustomerVisibleOption(option) {
  return Boolean(option && typeof option === 'object'
    && option.visible !== false
    && option.available !== false
    && (option.stock === undefined || option.stock > 0));
}

/** @template {{id:string,title:string,options:unknown[],required?:boolean}} Step
 * @param {Step[]} steps
 * @returns {(Step & {title:string,required?:boolean,options:unknown[]})[]}
 */
export function getAbayaCustomerSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    if (!step || typeof step.title !== 'string' || step.available === false || step.visible === false) return [];
    const isModel = /model/i.test(step.title) || /^abaya\s*style$/i.test(step.title.trim());
    const isSize = /^(?:(?:choose|select)\s+)?(?:abaya\s+)?size(?:\s+selection)?$/i.test(step.title.trim());
    // Abaya keeps standard clothing sizes; custom measurement steps remain Kandura-only.
    if (/measurement/i.test(step.title) || (!isModel && !isSize && /custom\s*size/i.test(step.title))) return [];
    const options = (Array.isArray(step.options) ? step.options : []).filter((option) =>
      isCustomerVisibleOption(option) && (!isSize || isStandardAbayaSize(option)));
    return [{
      ...step,
      ...(isModel ? { title: 'Choose a style', required: false } : {}),
      ...(isSize ? { title: 'Select Size' } : {}),
      options,
    }];
  });
}
