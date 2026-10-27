export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  image?: string;
  images?: string[];
  swatch?: string;
  priceAdjustment?: number;
  available?: boolean;
  visible?: boolean;
};

export type ModelOptionCategory = {
  visible?: boolean;
  required?: boolean;
  options: ModelOption[];
};

export type ModelOptionKey = 'colors' | 'fabrics' | 'stitching';

export function patchModelCategory<T extends { modelCustomization?: unknown }>(model: T, key: ModelOptionKey, category: ModelOptionCategory): T {
  const current = model.modelCustomization && typeof model.modelCustomization === 'object'
    ? model.modelCustomization as Record<string, unknown>
    : {};
  return { ...model, modelCustomization: { ...current, [key]: category } } as T;
}

export function addModelOption(category: ModelOptionCategory, option: ModelOption): ModelOptionCategory {
  return { ...category, options: [...category.options, option] };
}

export function updateModelOption(
  category: ModelOptionCategory,
  optionId: string,
  patch: Partial<ModelOption>,
): ModelOptionCategory {
  return {
    ...category,
    options: category.options.map(option => option.id === optionId ? { ...option, ...patch } : option),
  };
}

export function moveModelOption(
  category: ModelOptionCategory,
  optionId: string,
  direction: -1 | 1,
): ModelOptionCategory {
  const options = [...category.options];
  const index = options.findIndex(option => option.id === optionId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= options.length) return category;
  [options[index], options[target]] = [options[target], options[index]];
  return { ...category, options };
}

export function removeModelOption(category: ModelOptionCategory, optionId: string): ModelOptionCategory {
  return { ...category, options: category.options.filter(option => option.id !== optionId) };
}

export function summarizeModelOptions(category: ModelOptionCategory) {
  return {
    total: category.options.length,
    withPhotos: category.options.filter(option => Boolean(option.image || option.images?.length)).length,
    available: category.options.filter(option => option.available !== false).length,
    visible: category.options.filter(option => option.visible !== false).length,
  };
}
