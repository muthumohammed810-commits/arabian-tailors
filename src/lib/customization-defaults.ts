export type CustomizationDefaultOption = { name: string; priceAdjustment: number; available: boolean };
export type CustomizationDefaultStep = { title: string; required: boolean; options: CustomizationDefaultOption[] };

const options = (names: string[]): CustomizationDefaultOption[] => names.map(name => ({ name, priceAdjustment: 0, available: true }));
const productionOptions = (): CustomizationDefaultOption[] => [
  { name: 'Standard', priceAdjustment: 0, available: true },
  { name: 'Express', priceAdjustment: 350, available: true },
  { name: 'Premium Express', priceAdjustment: 0, available: true },
];

export const customizationDefaults: Record<'kandura' | 'abaya', CustomizationDefaultStep[]> = {
  kandura: [
    { title: 'Kandura Style', required: true, options: options(['Emirati', 'Saudi', 'Omani', 'Kuwaiti', 'Qatari', 'Bahraini', 'Indian', 'Moroccan', 'Custom']) },
    { title: 'Fabric', required: true, options: options(['Cotton', 'Premium Cotton', 'Linen', 'Polyester', 'Wool Blend', 'Silk Blend', 'Premium Fabric', 'Custom Fabric']) },
    { title: 'Color', required: true, options: options(['White', 'Off White', 'Cream', 'Ivory', 'Beige', 'Black', 'Navy', 'Grey', 'Brown', 'Custom Color']) },
    { title: 'Collar Style', required: true, options: options(['Standard', 'Emirati', 'Mandarin', 'Round', 'Hidden', 'Custom']) },
    { title: 'Cuff Style', required: true, options: options(['Standard', 'Button Cuff', 'French Cuff', 'Folded Cuff', 'Custom']) },
    { title: 'Front / Placket Style', required: true, options: options(['Standard', 'Hidden', 'Button', 'Zip', 'Premium', 'Custom']) },
    { title: 'Pocket Style', required: true, options: options(['No Pocket', 'Side Pocket', 'Chest Pocket', 'Double Pocket', 'Hidden Pocket', 'Custom']) },
    { title: 'Buttons', required: true, options: options(['Standard', 'Premium', 'Pearl', 'Metal', 'Gold', 'Silver', 'Custom']) },
    { title: 'Embroidery', required: true, options: options(['None', 'Simple', 'Premium', 'Royal', 'Custom']) },
    { title: 'Stitching', required: true, options: options(['Standard', 'Premium', 'Hand Finish', 'Luxury Finish', 'Custom']) },
    { title: 'Fit', required: true, options: options(['Regular', 'Slim', 'Relaxed', 'Loose', 'Custom']) },
    { title: 'Length', required: true, options: options(['Standard', 'Short', 'Long', 'Custom Measurement']) },
    { title: 'Sleeve', required: true, options: options(['Standard', 'Long', 'Short', 'Custom']) },
    { title: 'Name / Personalization', required: true, options: options(['No Personalization', 'Name Embroidery', 'Initials', 'Custom Text']) },
    { title: 'Size', required: true, options: options(['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Custom Measurements']) },
    { title: 'Delivery / Production', required: true, options: productionOptions() },
  ],
  abaya: [
    { title: 'Abaya Style', required: true, options: options(['Classic', 'Open Front', 'Closed Front', 'Kimono', 'Butterfly', 'A-Line', 'Dubai', 'Saudi', 'Emirati', 'Custom']) },
    { title: 'Fabric', required: true, options: options(['Nida', 'Crepe', 'Chiffon', 'Linen', 'Cotton', 'Satin', 'Jersey', 'Premium Fabric', 'Custom Fabric']) },
    { title: 'Color', required: true, options: options(['Black', 'Navy', 'Charcoal', 'Brown', 'Beige', 'Taupe', 'Grey', 'Cream', 'Ivory', 'Custom Color']) },
    { title: 'Sleeve Style', required: true, options: options(['Standard', 'Bell', 'Flared', 'Bishop', 'Batwing', 'Cuffed', 'Custom']) },
    { title: 'Front Style', required: true, options: options(['Open Front', 'Closed Front', 'Wrap', 'Button Front', 'Zip Front', 'Custom']) },
    { title: 'Closure', required: true, options: options(['None', 'Hidden Hooks', 'Buttons', 'Zipper', 'Tie Belt', 'Snaps', 'Custom']) },
    { title: 'Embroidery', required: true, options: options(['None', 'Minimal', 'Floral', 'Geometric', 'Premium', 'Royal', 'Custom']) },
    { title: 'Border', required: true, options: options(['Plain', 'Piping', 'Embroidered Border', 'Beaded Border', 'Lace', 'Contrast Trim', 'Custom']) },
    { title: 'Cuff', required: true, options: options(['Standard', 'Button Cuff', 'Embroidered Cuff', 'Flared Cuff', 'Folded Cuff', 'Custom']) },
    { title: 'Pocket', required: true, options: options(['No Pocket', 'Side Pockets', 'Hidden Pocket', 'Patch Pocket', 'Custom']) },
    { title: 'Hijab Option', required: true, options: options(['None', 'Matching Hijab', 'Matching Sheyla', 'Custom']) },
    { title: 'Length', required: true, options: options(['Standard', 'Petite', 'Tall', 'Custom Measurement']) },
    { title: 'Fit', required: true, options: options(['Regular', 'Relaxed', 'Loose', 'Custom']) },
    { title: 'Size', required: true, options: options(['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Custom Measurements']) },
    { title: 'Personalization', required: true, options: options(['None', 'Name Embroidery', 'Initials', 'Custom Text']) },
    { title: 'Custom Measurements', required: true, options: options(['Standard Measurements', 'Enter Custom Measurements']) },
    { title: 'Production & Delivery', required: true, options: productionOptions() },
  ],
};

type StoreForCustomizationMerge = { products: any[] };
const normalizedChoice = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const stepAliases: Record<string, string[]> = {
  'kandura style': ['style'], 'abaya style': ['style'], color: ['colour'], 'collar style': ['collar'], 'cuff style': ['cuff'], cuff: ['cuff style'],
  'front placket style': ['front style', 'placket', 'placket style', 'front placket'], 'front style': ['front placket style', 'placket', 'placket style'], 'pocket style': ['pocket'], pocket: ['pocket style'],
  buttons: ['button style'], 'name personalization': ['personalization', 'name', 'name embroidery'],
  'delivery production': ['production delivery', 'delivery', 'production'], 'production delivery': ['delivery production', 'delivery', 'production'],
  'sleeve style': ['sleeve'], 'hijab option': ['hijab'], 'custom measurements': ['measurements'],
};

function customizationStepMatches(existingTitle: string, defaultTitle: string) {
  const existing = normalizedChoice(existingTitle), target = normalizedChoice(defaultTitle);
  return existing === target || (stepAliases[target] || []).some(alias => normalizedChoice(alias) === existing);
}

/** Adds missing defaults in place while retaining existing step/option records and prices. */
export function addDefaultCustomization(store: StoreForCustomizationMerge) {
  let changed = false;
  for (const product of store.products) {
    const category = String(product.category || '').toLowerCase();
    const templates = category === 'kandura' ? customizationDefaults.kandura : category === 'abaya' ? customizationDefaults.abaya : undefined;
    if (!templates) continue;
    if (!Array.isArray(product.customizationSteps)) product.customizationSteps = [];
    for (const template of templates) {
      let step = product.customizationSteps.find((candidate: any) => candidate && typeof candidate.title === 'string' && customizationStepMatches(candidate.title, template.title));
      if (!step) {
        const baseId = `custom-${String(product.id).slice(-32)}-${normalizedChoice(template.title).replaceAll(' ', '-').slice(0, 32)}`;
        let id = baseId, suffix = 2;
        while (product.customizationSteps.some((candidate: any) => candidate?.id === id)) id = `${baseId}-${suffix++}`;
        step = { id, title: template.title, required: template.required, options: [] };
        product.customizationSteps.push(step);
        changed = true;
      }
      if (!Array.isArray(step.options)) step.options = [];
      const existingFabricOptions = normalizedChoice(template.title) === 'fabric'
        ? store.products.filter((candidate: any) => String(candidate.category || '').toLowerCase() === 'fabric' && typeof candidate.name === 'string').map((candidate: any) => ({ name: candidate.name, priceAdjustment: Number.isFinite(candidate.price) && candidate.price >= 0 && candidate.price <= 1_000_000 ? candidate.price : 0, available: candidate.available !== false }))
        : [];
      for (const templateOption of [...template.options, ...existingFabricOptions]) {
        const exists = step.options.some((option: any) => option && typeof option.name === 'string' && normalizedChoice(option.name) === normalizedChoice(templateOption.name));
        if (exists) continue;
        const baseId = `opt-${normalizedChoice(template.title).replaceAll(' ', '-').slice(0, 30)}-${normalizedChoice(templateOption.name).replaceAll(' ', '-').slice(0, 30)}`;
        let id = baseId, suffix = 2;
        while (step.options.some((option: any) => option?.id === id)) id = `${baseId}-${suffix++}`;
        step.options.push({ id, ...templateOption });
        changed = true;
      }
    }
  }
  return changed;
}
