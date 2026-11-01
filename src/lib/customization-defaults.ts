export type CustomizationDefaultOption = { name: string; priceAdjustment: number; available: boolean };
export type CustomizationDefaultStep = { title: string; required: boolean; available?: boolean; options: CustomizationDefaultOption[] };
export type DefaultMeasurement = { name: string; unit: 'cm' | 'inch'; required: boolean; available: boolean };

const options = (names: string[]): CustomizationDefaultOption[] => names.map(name => ({ name, priceAdjustment: 0, available: true }));
const productionOptions = (): CustomizationDefaultOption[] => [
  { name: 'Standard', priceAdjustment: 0, available: true },
  { name: 'Express', priceAdjustment: 350, available: true },
  { name: 'Premium Express', priceAdjustment: 0, available: true },
];
const priorityOptions = (): CustomizationDefaultOption[] => [
  { name: 'Standard tailoring', priceAdjustment: 0, available: true },
  { name: 'Priority tailoring', priceAdjustment: 350, available: true },
];

export const customizationDefaults: Record<'kandura' | 'abaya', CustomizationDefaultStep[]> = {
  kandura: [
    { title: 'Choose Your Kandura Model', required: true, options: options(['Saudi Kandura', 'Emirati Kandura', 'Omani Kandura', 'Kuwaiti Kandura', 'Qatari Kandura', 'Bahraini Kandura', 'Indian Kandura', 'Moroccan Kandura', 'Custom Model']) },
    { title: 'Choose Size', required: true, options: options(['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Custom Size']) },
    { title: 'Choose Color', required: true, options: options(['White', 'Black', 'Cream', 'Beige']) },
    { title: 'Choose Fabric / Cloth Type', required: true, options: options(['Cotton', 'Linen', 'Premium']) },
    { title: 'Priority / Extra customization', required: false, options: priorityOptions() },
  ],
  abaya: [
    { title: 'Abaya Style', required: false, options: options(['Classic', 'Open Front', 'Closed Front', 'Kimono', 'Butterfly', 'A-Line', 'Dubai', 'Saudi', 'Emirati', 'Custom']) },
    { title: 'Size', required: true, options: options(['S', 'M', 'L', 'XL', 'XXL']) },
  ],
};

export const defaultMeasurements: Record<'kandura' | 'abaya', DefaultMeasurement[]> = {
  kandura: ['Chest', 'Shoulder', 'Sleeve Length', 'Length', 'Neck', 'Width'].map(name => ({ name, unit: 'cm', required: false, available: true })),
  abaya: [],
};

type StoreForCustomizationMerge = { products: any[] };
const normalizedChoice = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const stepAliases: Record<string, string[]> = {
  'choose your kandura model': ['kandura style', 'style', 'choose kandura model'], 'kandura style': ['style'], 'abaya style': ['style'], color: ['colour', 'choose colour', 'choose color'], 'choose color': ['color', 'colour', 'choose colour'], 'choose size': ['size', 'sizing', 'size selection'], 'choose fabric cloth type': ['fabric', 'cloth', 'cloth type', 'choose fabric', 'fabric cloth type'], 'priority extra customization': ['priority', 'extra', 'extras', 'priority tailoring', 'delivery production', 'production delivery'], 'collar style': ['collar'], 'cuff style': ['cuff'], cuff: ['cuff style'],
  'front placket style': ['front style', 'placket', 'placket style', 'front placket'], 'front style': ['front placket style', 'placket', 'placket style'], 'pocket style': ['pocket'], pocket: ['pocket style'],
  buttons: ['button style'], 'name personalization': ['personalization', 'name', 'name embroidery'],
  'delivery production': ['production delivery', 'delivery', 'production'], 'production delivery': ['delivery production', 'delivery', 'production'],
  'sleeve style': ['sleeve'], 'hijab option': ['hijab'], 'custom measurements': ['measurements'],
};

const legacyGeneratedKanduraSteps: Record<string, string[]> = {
  'collar style': ['standard', 'emirati', 'mandarin', 'round', 'hidden', 'custom'],
  'cuff style': ['standard', 'button cuff', 'french cuff', 'folded cuff', 'custom'],
  'front placket style': ['standard', 'hidden', 'button', 'zip', 'premium', 'custom'],
  'pocket style': ['no pocket', 'side pocket', 'chest pocket', 'double pocket', 'hidden pocket', 'custom'],
  buttons: ['standard', 'premium', 'pearl', 'metal', 'gold', 'silver', 'custom'],
  embroidery: ['none', 'simple', 'premium', 'royal', 'custom'],
  stitching: ['standard', 'premium', 'hand finish', 'luxury finish', 'custom'],
  fit: ['regular', 'slim', 'relaxed', 'loose', 'custom'],
  length: ['standard', 'short', 'long', 'custom measurement'],
  sleeve: ['standard', 'long', 'short', 'custom'],
  'name personalization': ['no personalization', 'name embroidery', 'initials', 'custom text'],
};

function isUntouchedGeneratedStep(step: any, names: string[]) {
  if (!Array.isArray(step.options) || step.options.length !== names.length || step.description || step.required !== true) return false;
  return step.options.every((option: any, index: number) => {
    if (!option || normalizedChoice(String(option.name || '')) !== normalizedChoice(names[index])) return false;
    return !option.description && !option.image && Number(option.priceAdjustment || 0) === 0 && option.available !== false && option.visible !== false;
  });
}

function customizationStepMatches(existingTitle: string, defaultTitle: string) {
  const existing = normalizedChoice(existingTitle), target = normalizedChoice(defaultTitle);
  return existing === target || (stepAliases[target] || []).some(alias => normalizedChoice(alias) === existing);
}

const normalizedModel = (value: string) => {
  const normalized = normalizedChoice(value);
  return normalized === 'custom' || normalized === 'custom model' ? 'custom model' : normalized.replace(/ kandura$/, '');
};

function migrateKanduraMainSteps(product: any) {
  const steps: any[] = product.customizationSteps;
  let changed = false;
  const mainSteps = customizationDefaults.kandura;
  const ordered: any[] = [];

  for (const template of mainSteps) {
    let step = steps.find((candidate: any) => candidate && typeof candidate.title === 'string' && customizationStepMatches(candidate.title, template.title));
    if (!step) {
      const slug = normalizedChoice(template.title).replaceAll(' ', '-');
      const baseId = `custom-${String(product.id).slice(-32)}-${slug.slice(0, 32)}`;
      let id = baseId, suffix = 2;
      while (steps.some((candidate: any) => candidate?.id === id)) id = `${baseId}-${suffix++}`;
      step = { id, title: template.title, description: '', required: template.required, available: true,
        options: template.options.map((option, index) => ({ id: `opt-${slug.slice(0, 22)}-${index + 1}`, ...option })) };
      steps.push(step);
      changed = true;
    } else {
      if (step.title !== template.title) { step.title = template.title; changed = true; }
      if (step.available === undefined) { step.available = true; changed = true; }
      if (template.title === 'Priority / Extra customization' && step.required !== false) { step.required = false; changed = true; }
    }
    ordered.push(step);
  }

  for (const step of steps) {
    if (ordered.includes(step)) continue;
    const oldOptions = legacyGeneratedKanduraSteps[normalizedChoice(String(step.title || ''))];
    if (step.available !== false && oldOptions && isUntouchedGeneratedStep(step, oldOptions)) {
      step.available = false;
      changed = true;
    }
  }

  const next = [...ordered, ...steps.filter((step: any) => !ordered.includes(step))];
  if (next.some((step, index) => step !== steps[index])) changed = true;
  product.customizationSteps = next;
  return changed;
}

/** Adds missing defaults in place while retaining existing step/option records and prices. */
export function addDefaultCustomization(store: StoreForCustomizationMerge) {
  let changed = false;
  for (const product of store.products) {
    const category = String(product.category || '').toLowerCase();
    const garment = category === 'kandura' || category === 'abaya' ? category : undefined;
    const templates = garment ? customizationDefaults[garment] : undefined;
    if (!templates) continue;
    if (garment === 'abaya' && Array.isArray(product.customizationSteps) && product.customizationSteps.length > 0) {
      const sizeTemplate = customizationDefaults.abaya.find(step => /^size$/i.test(step.title))!;
      let sizeStep = product.customizationSteps.find((candidate: any) => candidate && typeof candidate.title === 'string' && /^(?:(?:choose|select)\s+)?(?:abaya\s+)?size(?:\s+selection)?$/i.test(candidate.title.trim()));
      if (!sizeStep) {
        const baseId = `custom-${String(product.id).slice(-32)}-size`;
        let id = baseId, suffix = 2;
        while (product.customizationSteps.some((candidate: any) => candidate?.id === id)) id = `${baseId}-${suffix++}`;
        sizeStep = { id, title: 'Size', description: '', required: true, available: true, options: [] };
        product.customizationSteps.push(sizeStep);
        changed = true;
      }
      if (!Array.isArray(sizeStep.options)) { sizeStep.options = []; changed = true; }
      if (sizeStep.required !== true) { sizeStep.required = true; changed = true; }
      if (sizeStep.available !== true) { sizeStep.available = true; changed = true; }
      for (const option of sizeTemplate.options) {
        const exists = sizeStep.options.some((candidate: any) => candidate && typeof candidate.name === 'string' && normalizedChoice(candidate.name).toUpperCase() === option.name);
        if (exists) continue;
        const baseId = `opt-abaya-size-${option.name.toLowerCase()}`;
        let id = baseId, suffix = 2;
        while (sizeStep.options.some((candidate: any) => candidate?.id === id)) id = `${baseId}-${suffix++}`;
        sizeStep.options.push({ id, ...option });
        changed = true;
      }
    }
    const needsInitialConfiguration = !Array.isArray(product.customizationSteps) || product.customizationSteps.length === 0;
    if (!needsInitialConfiguration) {
      if (!Array.isArray(product.measurements)) product.measurements = [];
      if (product.measurementsEnabled === undefined) { product.measurementsEnabled = garment !== 'abaya'; changed = true; }
      if (garment === 'abaya') {
        const legacyMeasurementsStep = product.customizationSteps.find((candidate: any) => candidate && typeof candidate.title === 'string' && normalizedChoice(candidate.title) === 'custom measurements');
        if (legacyMeasurementsStep && legacyMeasurementsStep.available === undefined) { legacyMeasurementsStep.available = false; changed = true; }
      }
      for (const field of defaultMeasurements[garment!]) {
        if (product.measurements.some((measurement: any) => measurement && typeof measurement.name === 'string' && normalizedChoice(measurement.name) === normalizedChoice(field.name))) continue;
        const baseId = `measure-${garment}-${normalizedChoice(field.name).replaceAll(' ', '-')}`;
        let id = baseId, suffix = 2;
        while (product.measurements.some((measurement: any) => measurement?.id === id)) id = `${baseId}-${suffix++}`;
        product.measurements.push({ id, ...field });
        changed = true;
      }
      if (garment === 'kandura') changed = migrateKanduraMainSteps(product) || changed;
      continue;
    }
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
      } else if (step.title !== template.title) {
        step.title = template.title;
        changed = true;
      }
      if (step.available === undefined) {
        step.available = template.available !== false;
        changed = true;
      }
      if (template.available === false && step.available !== false && normalizedChoice(template.title) === 'custom measurements') {
        step.available = false;
        changed = true;
      }
      if (!Array.isArray(step.options)) step.options = [];
      const existingFabricOptions = normalizedChoice(template.title) === 'fabric'
        ? store.products.filter((candidate: any) => String(candidate.category || '').toLowerCase() === 'fabric' && typeof candidate.name === 'string').map((candidate: any) => ({ name: candidate.name, priceAdjustment: Number.isFinite(candidate.price) && candidate.price >= 0 && candidate.price <= 1_000_000 ? candidate.price : 0, available: candidate.available !== false }))
        : [];
      for (const templateOption of [...template.options, ...existingFabricOptions]) {
        const existingOption = step.options.find((option: any) => option && typeof option.name === 'string' && (normalizedChoice(option.name) === normalizedChoice(templateOption.name) || (normalizedChoice(template.title) === 'choose your kandura model' && normalizedModel(option.name) === normalizedModel(templateOption.name))));
        if (existingOption) {
          if (normalizedChoice(template.title) === 'choose your kandura model' && existingOption.name !== templateOption.name) {
            existingOption.name = templateOption.name;
            changed = true;
          }
          continue;
        }
        const baseId = `opt-${normalizedChoice(template.title).replaceAll(' ', '-').slice(0, 30)}-${normalizedChoice(templateOption.name).replaceAll(' ', '-').slice(0, 30)}`;
        let id = baseId, suffix = 2;
        while (step.options.some((option: any) => option?.id === id)) id = `${baseId}-${suffix++}`;
        step.options.push({ id, ...templateOption });
        changed = true;
      }
    }
    if (garment === 'kandura') {
      const modelIndex = product.customizationSteps.findIndex((step: any) => normalizedChoice(step.title) === 'choose your kandura model');
      if (modelIndex > 0) {
        const [modelStep] = product.customizationSteps.splice(modelIndex, 1);
        product.customizationSteps.unshift(modelStep);
        changed = true;
      }
    }
    if (!Array.isArray(product.measurements)) product.measurements = [];
    for (const field of defaultMeasurements[garment!]) {
      const existing = product.measurements.find((measurement: any) => measurement && typeof measurement.name === 'string' && normalizedChoice(measurement.name) === normalizedChoice(field.name));
      if (existing) {
        for (const [key, value] of Object.entries(field)) if (existing[key] === undefined) { existing[key] = value; changed = true; }
        if (!existing.id) { existing.id = `measure-${garment}-${normalizedChoice(field.name).replaceAll(' ', '-')}`; changed = true; }
      } else {
        product.measurements.push({ id: `measure-${garment}-${normalizedChoice(field.name).replaceAll(' ', '-')}`, ...field });
        changed = true;
      }
    }
    if (product.measurementsEnabled === undefined) {
      product.measurementsEnabled = garment !== 'abaya';
      changed = true;
    }
  }
  return changed;
}
