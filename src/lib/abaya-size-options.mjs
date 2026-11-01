export const ABAYA_STANDARD_SIZES = Object.freeze(['S', 'M', 'L', 'XL', 'XXL']);

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
  const model = steps.find((step) => /model/i.test(step.title) || /^abaya\s*style$/i.test(step.title.trim()));
  const size = steps.find((step) => /^(?:(?:choose|select)\s+)?(?:abaya\s+)?size(?:\s+selection)?$/i.test(step.title.trim()));
  return [
    ...(model ? [{ ...model, title: 'Select Abaya Model', required: false }] : []),
    ...(size && size.id !== model?.id ? [{ ...size, title: 'Select Size', options: size.options.filter(isStandardAbayaSize) }] : []),
  ];
}
