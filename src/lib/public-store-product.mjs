import { getAbayaCustomerSteps, isCustomerVisibleOption } from './abaya-size-options.mjs';
import { publishedMeasurementFields, publishedMeasurementGuideVideo, publishedMeasurementGuides } from './measurement-guides.mjs';

const optionFields = ['id', 'name', 'description', 'image', 'images', 'swatch', 'priceAdjustment', 'basePrice'];

function publicOption(option, { includeBasePrice = true } = {}) {
  if (!isCustomerVisibleOption(option)) return null;
  const fields = includeBasePrice ? optionFields : optionFields.filter((key) => key !== 'basePrice');
  const result = Object.fromEntries(fields
    .filter((key) => option[key] !== undefined)
    .map((key) => [key, option[key]]));
  const modelCustomization = publicModelCustomization(option.modelCustomization, { includeBasePrice });
  if (modelCustomization) result.modelCustomization = modelCustomization;
  return result;
}

function publicModelCustomization(value, options) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const key of ['colors', 'fabrics', 'stitching']) {
    const category = value[key];
    if (!category || typeof category !== 'object' || Array.isArray(category) || category.visible === false) continue;
    result[key] = {
      ...(typeof category.required === 'boolean' ? { required: category.required } : {}),
      options: (Array.isArray(category.options) ? category.options : []).map((option) => publicOption(option, options)).filter(Boolean),
    };
  }
  if (Array.isArray(value.steps)) {
    result.steps = value.steps.filter((step) => step && typeof step === 'object' && step.visible !== false)
      .map((step) => ({
        id: step.id,
        title: step.title,
        ...(typeof step.description === 'string' ? { description: step.description } : {}),
        ...(typeof step.required === 'boolean' ? { required: step.required } : {}),
        options: (Array.isArray(step.options) ? step.options : []).map((option) => publicOption(option, options)).filter(Boolean),
      }));
  }
  return Object.keys(result).length ? result : undefined;
}

function publicStep(step, options) {
  if (!step || typeof step !== 'object' || step.available === false || step.visible === false) return null;
  return {
    id: step.id,
    title: step.title,
    ...(typeof step.description === 'string' ? { description: step.description } : {}),
    ...(typeof step.required === 'boolean' ? { required: step.required } : {}),
    ...(typeof step.available === 'boolean' ? { available: step.available } : {}),
    options: (Array.isArray(step.options) ? step.options : []).map((option) => publicOption(option, options)).filter(Boolean),
  };
}

/** Whitelist the storefront contract; never spread private Admin product records publicly. */
export function projectPublicStoreProduct(product, { managedAbayaCatalog = false } = {}) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) return null;
  const category = String(product.category || '');
  const isAbaya = category.trim().toLowerCase() === 'abaya';
  const steps = Array.isArray(product.customizationSteps) ? product.customizationSteps : [];
  const customerSteps = isAbaya
    ? getAbayaCustomerSteps(steps, { managedCatalog: managedAbayaCatalog })
    : steps.filter((step) => step && step.available !== false && step.visible !== false);
  const abayaMeasurementsEnabled = isAbaya && product.measurementsEnabled !== false;
  const abayaMeasurements = abayaMeasurementsEnabled && Array.isArray(product.measurements)
    ? publishedMeasurementFields(product.measurements, product.id, true).filter((field) => field.available !== false)
    : undefined;
  const abayaMeasurementGuides = abayaMeasurementsEnabled && Array.isArray(product.measurementGuides)
    ? publishedMeasurementGuides(product.measurementGuides, product.id)
    : undefined;
  const abayaMeasurementGuideVideo = abayaMeasurementsEnabled
    ? publishedMeasurementGuideVideo(product.measurementGuideVideo, product.id, true)
    : undefined;
  const images = Array.isArray(product.images)
    ? [...new Set(product.images.filter((image) => typeof image === 'string' && image.length <= 2000))]
    : undefined;
  return {
    id: product.id,
    name: product.name,
    category,
    price: product.price,
    available: product.available !== false,
    ...(typeof product.description === 'string' ? { description: product.description } : {}),
    ...(typeof product.image === 'string' ? { image: product.image } : {}),
    ...(typeof product.swatch === 'string' ? { swatch: product.swatch } : {}),
    ...(images ? { images } : {}),
    ...(Array.isArray(product.options) ? { options: product.options.filter((option) => typeof option === 'string') } : {}),
    ...(typeof product.stitchingType === 'string' ? { stitchingType: product.stitchingType } : {}),
    customizationSteps: customerSteps.map((step) => publicStep(step, { includeBasePrice: !isAbaya })).filter(Boolean),
    ...(isAbaya && abayaMeasurements ? { measurements: abayaMeasurements } : {}),
    ...(isAbaya && abayaMeasurementGuideVideo ? { measurementGuideVideo: abayaMeasurementGuideVideo } : {}),
    ...(isAbaya && abayaMeasurementGuides ? { measurementGuides: abayaMeasurementGuides } : {}),
    ...(!isAbaya && Array.isArray(product.measurements) ? { measurements: product.measurements } : {}),
    ...(!isAbaya && typeof product.measurementsEnabled === 'boolean' ? { measurementsEnabled: product.measurementsEnabled } : {}),
    ...(!isAbaya && product.measurementGuideVideo ? { measurementGuideVideo: product.measurementGuideVideo } : {}),
    ...(!isAbaya && Array.isArray(product.measurementGuides) ? { measurementGuides: product.measurementGuides } : {}),
  };
}
