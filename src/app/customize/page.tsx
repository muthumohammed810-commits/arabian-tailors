'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, ShieldCheck, Scissors, Smartphone, LockKeyhole } from 'lucide-react';
import { fabrics as defaultFabrics, products as defaultProducts, styles as defaultStyles, type Product } from '@/lib/catalog';
import { GarmentVisual } from '@/components/garment-visual';
import { createUpiPaymentUrl } from '@/lib/upi-payment';
import { customizationDefaults, defaultMeasurements } from '@/lib/customization-defaults';
import { productImageSource } from '@/lib/product-image-url';
import { upload, uploadPresigned } from '@vercel/blob/client';
import { MODEL_REFERENCE_PREFIX, getAbayaCustomerSteps, isModelReferenceUrl, validateModelReferenceFile } from '@/lib/abaya-customization';
import { ImageUploadError, withAbortableDeadline } from '@/lib/upload-batch';
import { quoteFlatDelivery, resolveFlatDeliveryFee, type KeralaPostalDirectory, type DeliveryRule } from '@/lib/delivery-pricing';
import { canContinueAbayaReferenceChoice, isRequiredCustomizationSelectionMissing } from '@/lib/custom-reference-order';
import { getAbayaProductOrderSnapshot, getCustomerAbayaProducts } from '@/lib/abaya-product-selection.mjs';
import { isAbayaModelStep } from '@/lib/abaya-model-management.mjs';

type ManagedModelCategory = { visible?: boolean; required?: boolean; options: CustomizationOption[] };
type ManagedModelStep = { id: string; title: string; description?: string; visible?: boolean; required?: boolean; options: CustomizationOption[] };
type ModelCustomization = { colors?: ManagedModelCategory; fabrics?: ManagedModelCategory; stitching?: ManagedModelCategory; steps?: ManagedModelStep[] };
type ModelCategoryKey = 'colors' | 'fabrics' | 'stitching';
type CustomizationOption = { id: string; name: string; description?: string; image?: string; images?: string[]; swatch?: string; priceAdjustment?: number; basePrice?: number; stock?: number; available?: boolean; visible?: boolean; modelCustomization?: ModelCustomization };
type CustomizationStep = { id: string; title: string; description?: string; required?: boolean; available?: boolean; options: CustomizationOption[] };
type MeasurementField = { id: string; name: string; unit: 'cm' | 'inch'; required?: boolean; available?: boolean; photo?: string };
type MeasurementGuide = { id: string; title: string; instructions: string; image: string; published: true };
type MeasurementGuideVideo = { url: string; instructions: string; published: true };
type StoreProduct = Product & { images?: string[]; available?: boolean; options?: string[]; customizationSteps?: CustomizationStep[]; measurements?: MeasurementField[]; measurementsEnabled?: boolean; measurementGuides?: MeasurementGuide[]; measurementGuideVideo?: MeasurementGuideVideo; stitchingType?: string; stock?: number };
type TailoringStyle = { id: string; name: string; desc: string; price: number; image: string };
type Fabric = { name: string; quality: string; price: number; available: boolean; swatch: string };
type ModelReferencePhoto = { url: string; preview: string; name: string };
type ModelReferenceDraft = { file: File; preview: string; pathname: string };
const colors = [{ name: 'Ivory', hex: '#eee9dc' }, { name: 'Pure White', hex: '#f8f7f2' }, { name: 'Sand', hex: '#d1c3a3' }, { name: 'Midnight', hex: '#202326' }, { name: 'Slate', hex: '#777b80' }];
const sizes = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const namedColorSwatches: Record<string, string> = { white: '#f8f7f2', 'off white': '#f3f0e7', 'pure white': '#f8f7f2', cream: '#eee5d1', ivory: '#eee9dc', beige: '#d8c7a5', sand: '#d1c3a3', black: '#171817', navy: '#202b3d', 'navy blue': '#202b3d', midnight: '#202326', grey: '#858585', gray: '#858585', slate: '#777b80', brown: '#76543b', charcoal: '#454545', taupe: '#9a8976' };

function getOptionSwatch(option: CustomizationOption) {
  if (option.swatch && /^#[0-9a-f]{6}$/i.test(option.swatch)) return option.swatch;
  if (option.swatch && /^rgb\(\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*\)$/i.test(option.swatch)) return option.swatch;
  const name = option.name.toLowerCase().trim().replace(/\s+(colour|color)$/i, '');
  if (name === 'custom') return 'conic-gradient(#f45b5b, #f2c94c, #27ae60, #2d9cdb, #9b51e0, #f45b5b)';
  return namedColorSwatches[name];
}

function initialShopProducts(): StoreProduct[] {
  return defaultProducts.map((product) => {
    const category = product.category.toLowerCase();
    const garment = category === 'kandura' || category === 'abaya' ? category : undefined;
    if (!garment) return { ...product, available: true, options: [] };
    const customizationSteps = customizationDefaults[garment].map((step, stepIndex) => ({
      ...step,
      id: `default-${product.id}-step-${stepIndex + 1}`,
      available: step.available !== false,
      options: step.options.map((option, optionIndex) => ({ ...option, id: `default-${product.id}-step-${stepIndex + 1}-option-${optionIndex + 1}` })),
    }));
    const measurements = defaultMeasurements[garment].map((field, index) => ({ ...field, id: `default-${product.id}-measurement-${index + 1}` }));
    return { ...product, available: true, options: [], customizationSteps, measurements, measurementsEnabled: garment === 'kandura' };
  });
}

const legacyAbayaFallbackProducts = initialShopProducts().filter(product => product.category.toLowerCase() === 'abaya');

function AbayaProductChoice({ product, selected, onSelect }: { product: StoreProduct; selected: boolean; onSelect: (product: StoreProduct) => void }) {
  const photos = [...new Set([...(product.image ? [product.image] : []), ...(product.images || [])])];
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const currentPhoto = photos[Math.min(photoIndex, Math.max(photos.length - 1, 0))];
  return <article className={`abaya-product-choice ${selected ? 'selected' : ''}`}>
    <button type="button" className="abaya-product-choice-image" onClick={() => onSelect(product)} aria-pressed={selected} aria-label={`Select ${product.name}`}>
      {currentPhoto && failedPhoto !== currentPhoto ? <img src={productImageSource(currentPhoto)} alt={`${product.name} Abaya`} loading="lazy" onError={() => setFailedPhoto(currentPhoto)} /> : <GarmentVisual kind="abaya" />}
      <span className="abaya-product-choice-mark">{selected ? 'Selected' : 'Select this Abaya'}</span>
    </button>
    {photos.length > 1 && <div className="abaya-product-choice-thumbnails" aria-label={`${product.name} gallery`}>
      {photos.map((photo, index) => <button type="button" className={index === photoIndex ? 'active' : ''} key={`${photo}-${index}`} onClick={() => { setPhotoIndex(index); setFailedPhoto(null); }} aria-label={`Show ${product.name} photo ${index + 1}`} aria-pressed={index === photoIndex}><img src={productImageSource(photo)} alt="" loading="lazy" /></button>)}
    </div>}
    <div className="abaya-product-choice-copy">
      <div><span className="eyebrow">ABAYA · MADE TO ORDER</span><h3 className="serif">{product.name}</h3></div>
      <p className="subtle">{product.description || 'A considered silhouette, ready to make personal.'}</p>
      <div className="abaya-product-choice-footer"><b>₹{product.price.toLocaleString('en-IN')}</b><button type="button" className="text-link" onClick={() => onSelect(product)} aria-pressed={selected}>{selected ? 'Selected' : 'Choose model'} <span aria-hidden="true">→</span></button></div>
    </div>
  </article>;
}

function CustomOptionImage({ src, name, fallbackColor, modelCard = false }: { src?: string; name: string; fallbackColor?: string; modelCard?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    if (modelCard) return <span className="dynamic-option-fallback model-photo-fallback" role="img" aria-label={`${name} photo not uploaded`}><span>Model photo not uploaded</span></span>;
    return fallbackColor ? <span className="dynamic-option-color-swatch" style={{ backgroundColor: fallbackColor }} aria-label={`${name} swatch`} /> : null;
  }
  return <img className="dynamic-option-image" src={productImageSource(src)} alt={`${name}`} onError={() => setFailed(true)} />;
}

function CustomerMeasurementField({field,value,onChange}:{field:MeasurementField;value:string;onChange:(value:string)=>void}) {
  return <div className="customer-measurement-field" key={field.id}>
    {field.photo&&<img className="customer-measurement-reference-photo" src={productImageSource(field.photo)} alt={`${field.name} measurement reference`} loading="lazy"/>}
    <label className="subtle">{field.name}{field.required===true?' *':''}<div className="measurement-input"><input type="number" min="0" required={field.required===true} value={value} onChange={event=>onChange(event.target.value)} placeholder={field.unit}/><span>{field.unit}</span></div></label>
  </div>;
}

function ModelReferencePhotoSection({
  draft, photo, uploading, progress, error, onSelectPhoto, onRetry, onRemove,
}: {
  draft: ModelReferenceDraft | null;
  photo: ModelReferencePhoto | null;
  uploading: boolean;
  progress: number;
  error: string;
  onSelectPhoto: (file: File | undefined) => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return <section className="abaya-reference-upload" aria-label="Model reference photo">
    <div><h3 className="serif">Upload a model reference photo</h3><p className="subtle">Optional. JPG, PNG or WebP · up to 10 MB. The photo is stored privately and attached to your order.</p></div>
    {(draft || photo) && <img className="abaya-reference-preview" src={draft?.preview || photo?.preview} alt="Full model reference photo preview" />}
    <div className="abaya-reference-actions">
      <label className="btn btn-outline">{photo ? 'Replace photo' : 'Choose photo'}<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={uploading} onChange={event => { onSelectPhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
      {draft && !uploading && <button type="button" className="btn btn-outline" onClick={onRetry}>Retry upload</button>}
      {(draft || photo) && !uploading && <button type="button" className="btn btn-outline" onClick={onRemove}>Remove photo</button>}
      {uploading && <span role="status" className="subtle">Uploading securely · {progress}%</span>}
      {!draft && photo && <span role="status" className="subtle">Photo uploaded securely; it will be attached when you submit the order.</span>}
    </div>
    {error && <p role="alert" className="checkout-error">{error}</p>}
  </section>;
}

export default function Customize() {
  const [step, setStep] = useState(0);
  const [style, setStyle] = useState(defaultProducts.find((product) => product.category.toLowerCase() === 'kandura')?.id || defaultStyles[0].id);
  const [fabric, setFabric] = useState(0);
  const [color, setColor] = useState('Ivory');
  const [sizing, setSizing] = useState('standard');
  const [size, setSize] = useState('M');
  const [unit, setUnit] = useState('cm');
  const [measurements, setMeasurements] = useState<Record<string, string>>({ chest: '', shoulder: '', sleeve: '', length: '' });
  const [speed, setSpeed] = useState('normal');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappUpdatesConsent, setWhatsappUpdatesConsent] = useState(false);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [orderId, setOrderId] = useState('');
  const [upiFallback, setUpiFallback] = useState(false);
  const [paymentAppRequested, setPaymentAppRequested] = useState(false);
  const [orderReferenceCopied, setOrderReferenceCopied] = useState(false);
  const [orderReferenceCopyError, setOrderReferenceCopyError] = useState('');
  const [paySettings, setPaySettings] = useState<Record<string, any>>({});
  const [serviceStyles, setServiceStyles] = useState<TailoringStyle[]>(defaultStyles);
  const [serviceFabrics, setServiceFabrics] = useState<Fabric[]>(defaultFabrics);
  const [shopProducts, setShopProducts] = useState<StoreProduct[]>(initialShopProducts);
  const [abayaManagedProducts, setAbayaManagedProducts] = useState<StoreProduct[]>([]);
  const [legacyAbayaProducts, setLegacyAbayaProducts] = useState<StoreProduct[]>([]);
  const [requestedProductId, setRequestedProductId] = useState<string | null>(null);
  const [requestedProductType, setRequestedProductType] = useState<string | null>(null);
  const [abayaCatalogManaged, setAbayaCatalogManaged] = useState(false);
  const [storeDataStatus, setStoreDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedProductOption, setSelectedProductOption] = useState('');
  const [customSelections, setCustomSelections] = useState<Record<string, CustomizationOption>>({});
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [customSizeExpanded, setCustomSizeExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const whatsappPhoneValid = /^\+[1-9]\d{7,14}$/.test(phone.trim());
  const [paymentStatus, setPaymentStatus] = useState('Pending verification');
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const [confirmedEstimate, setConfirmedEstimate] = useState<number | null>(null);
  const [confirmedPaymentAmount, setConfirmedPaymentAmount] = useState<number | null>(null);
  const [confirmedFinalPrice, setConfirmedFinalPrice] = useState<number | null>(null);
  const [confirmedRemainingBalance, setConfirmedRemainingBalance] = useState<number | null>(null);
  const [confirmedAdvanceStatus, setConfirmedAdvanceStatus] = useState('Pending verification');
  const [confirmedBreakdown, setConfirmedBreakdown] = useState<{subtotal:number;deliveryFee:number;discount:number;total:number}|null>(null);
  const [modelReferencePhoto, setModelReferencePhoto] = useState<ModelReferencePhoto | null>(null);
  const [modelReferenceDraft, setModelReferenceDraft] = useState<ModelReferenceDraft | null>(null);
  const [modelReferenceUploading, setModelReferenceUploading] = useState(false);
  const [modelReferenceProgress, setModelReferenceProgress] = useState(0);
  const [modelReferenceError, setModelReferenceError] = useState('');
  const referencePreviewUrls = useRef<string[]>([]);
  const modelReferenceUploadLock = useRef(false);
  const pendingOrderRef = useRef<any>(null);
  const checkoutReferenceRef = useRef('');

  useEffect(() => () => referencePreviewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('product');
    const productType = params.get('productType');
    if (productId) setRequestedProductId(productId);
    if (productType) setRequestedProductType(productType);

    fetch('/api/store-data', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Store data unavailable');
        return response.json();
      })
      .then((data) => {
        if (!Array.isArray(data?.products)) throw new Error('Store product list unavailable');
        if (data?.settings) {
          setPaySettings(data.settings);
          if (data.settings.gold) document.documentElement.style.setProperty('--gold', data.settings.gold);
          if (data.settings.background) document.documentElement.style.setProperty('--ink', data.settings.background);
        }
        setShopProducts(data.products);
        setAbayaManagedProducts(Array.isArray(data.abayaProducts) ? data.abayaProducts : []);
        setLegacyAbayaProducts(Array.isArray(data.legacyAbayaProducts) ? data.legacyAbayaProducts : []);
        setAbayaCatalogManaged(data.abayaCatalogManaged === true);
        setStoreDataStatus('ready');
        const kanduras = data.products.filter((product: StoreProduct) => product.available !== false && product.category.toLowerCase() === 'kandura');
        if (kanduras.length) {
          const nextStyles = kanduras.map((product: StoreProduct) => ({ id: product.id, name: product.name, desc: product.description || '', price: product.price, image: product.image }));
          setServiceStyles(nextStyles);
          setStyle(nextStyles[0].id);
        }
        const fabrics = data.products.filter((product: StoreProduct) => product.available !== false && product.category.toLowerCase() === 'fabric');
        if (fabrics.length) setServiceFabrics(fabrics.map((product: StoreProduct) => ({ name: product.name, quality: product.description || '', price: product.price, available: true, swatch: (product as StoreProduct & { swatch?: string }).swatch || '#eee9dc' })));
      })
      .catch(() => setStoreDataStatus('error'));
  }, []);

  const abayaProductChoices = useMemo(() => storeDataStatus === 'ready' ? getCustomerAbayaProducts([...abayaManagedProducts, ...legacyAbayaProducts], { managed: abayaCatalogManaged, fallbackProducts: legacyAbayaFallbackProducts.filter(fallback => !shopProducts.some(product => product.id === fallback.id)) }) : [], [abayaManagedProducts, legacyAbayaProducts, shopProducts, abayaCatalogManaged, storeDataStatus]);
  const requestedCatalogProduct = requestedProductId ? shopProducts.find((product) => product.id === requestedProductId) || abayaProductChoices.find((product) => product.id === requestedProductId) : undefined;
  const isAbaya = requestedCatalogProduct?.category.toLowerCase() === 'abaya' || requestedProductType?.toLowerCase() === 'abaya';
  const selectedProduct = requestedProductId && (storeDataStatus === 'ready' || !isAbaya) ? requestedCatalogProduct : undefined;
  const configuredProduct = selectedProduct || (!isAbaya ? shopProducts.find((product) => product.id === style && product.category.toLowerCase() === 'kandura') : undefined);
  const activeProductOption = selectedProductOption || configuredProduct?.options?.[0] || '';
  const isKandura = configuredProduct?.category.toLowerCase() === 'kandura' || (!selectedProduct && !isAbaya);
  const hasAbayaProductSelectionStep = isAbaya;
  const baseCustomSteps = configuredProduct?.customizationSteps || [];
  const firstModelSelectionStep = baseCustomSteps.find(item => isAbaya ? isAbayaModelStep(item) : /model/i.test(item.title));
  const selectedAbayaModelEntry = isAbaya ? baseCustomSteps.map(step => ({ step, option: customSelections[step.id] })).find(entry => isAbayaModelStep(entry.step) && entry.option) : undefined;
  const modelSelectionStep = selectedAbayaModelEntry?.step || firstModelSelectionStep;
  const selectedModelOption = selectedAbayaModelEntry?.option || (modelSelectionStep ? customSelections[modelSelectionStep.id] : undefined);
  const modelCustomization = selectedModelOption?.modelCustomization;
  const categoryForTitle = (title: string): ModelCategoryKey | undefined => /model/i.test(title) ? undefined : /colou?r/i.test(title) ? 'colors' : /fabric|cloth/i.test(title) ? 'fabrics' : /stitch/i.test(title) ? 'stitching' : undefined;
  const customStepsWithModel: CustomizationStep[] = baseCustomSteps.map(item => {
    const category = categoryForTitle(item.title);
    const configured = category ? modelCustomization?.[category] : undefined;
    const modelStep = modelCustomization?.steps?.find(step => step.id === item.id);
    if (modelStep) return { ...item, title: modelStep.title, description: modelStep.description, available: modelStep.visible !== false, required: modelStep.required ?? item.required, options: modelStep.options };
    return configured ? { ...item, available: configured.visible !== false, required: configured.required ?? item.required, options: configured.options } : item;
  });
  if (modelCustomization) {
    for (const [key, title] of [['colors', 'Choose a Colour'], ['fabrics', 'Choose a Fabric'], ['stitching', 'Choose Stitching / Style']] as const) {
      const configured = modelCustomization[key];
      if (configured && !baseCustomSteps.some(item => categoryForTitle(item.title) === key)) customStepsWithModel.push({ id: `model-${selectedModelOption?.id}-${key}`, title, required: configured.required, available: configured.visible !== false, options: configured.options });
    }
    for (const configured of modelCustomization.steps || []) {
      if (!baseCustomSteps.some(item => item.id === configured.id)) customStepsWithModel.push({ id: configured.id, title: configured.title, description: configured.description, required: configured.required, available: configured.visible !== false, options: configured.options });
    }
  }
  const customSteps = (isAbaya
    ? getAbayaCustomerSteps(customStepsWithModel.filter(item => item.available !== false))
    : customStepsWithModel.filter(item => item.available !== false)).map(item => isAbaya && item.id === modelSelectionStep?.id ? { ...item, title: 'Choose a style' } : item);
  const hasStoredCustomization = (configuredProduct?.customizationSteps?.length || 0) > 0;
  const hasGarmentDefaults = !isAbaya && (!selectedProduct || isKandura) && !hasStoredCustomization;
  const hasModelStep = isKandura && customSteps[0]?.title.toLowerCase() === 'choose your kandura model';
  const hasAbayaModelStep = isAbaya && baseCustomSteps.some(isAbayaModelStep);
  const hasProductIntro = Boolean(selectedProduct && !isAbaya && !hasModelStep && !hasAbayaModelStep);
  const customStepStart = hasAbayaProductSelectionStep ? 1 : hasGarmentDefaults ? 4 : hasModelStep || hasAbayaModelStep ? 0 : hasProductIntro ? 1 : 0;
  const measurementFields = (configuredProduct?.measurements || []).filter(field => field.available !== false);
  const measurementsEnabled = configuredProduct?.measurementsEnabled !== false;
  const showMeasurements = !isKandura && measurementsEnabled && measurementFields.length > 0;
  const measurementStep = customStepStart + customSteps.length;
  const hasTimingStep = hasGarmentDefaults && !showMeasurements;
  const timingStep = measurementStep + (showMeasurements ? 1 : 0);
  const reviewStep = timingStep + (hasTimingStep ? 1 : 0);
  const deliveryStep = reviewStep + 1;
  const paymentStep = deliveryStep + 1;
  const activeCustomStep = step >= customStepStart && step < measurementStep ? customSteps[step - customStepStart] : undefined;
  const isActiveModelSelectionStep = Boolean(activeCustomStep && activeCustomStep.id === modelSelectionStep?.id);
  const referencePhotoNotSaved = Boolean(modelReferenceUploading || modelReferenceDraft);
  const photoOnlyAbayaRequest = Boolean(isAbaya && !selectedProduct && modelReferencePhoto?.url);
  const requiredSelectionMissing = Boolean((hasAbayaProductSelectionStep && step === 0 && !canContinueAbayaReferenceChoice(Boolean(selectedProduct), Boolean(modelReferencePhoto?.url), referencePhotoNotSaved)) || (activeCustomStep && isRequiredCustomizationSelectionMissing(activeCustomStep.required === true, Boolean(customSelections[activeCustomStep.id]), isActiveModelSelectionStep, referencePhotoNotSaved)));
  const activeCustomOption = activeCustomStep ? customSelections[activeCustomStep.id] : undefined;
  const measurementTitle = activeCustomStep?.title.toLowerCase() || '';
  const needsCustomMeasurements = Boolean(activeCustomStep && /custom/i.test(activeCustomOption?.name || '') && /fit|size|length|sleeve|measurement/.test(measurementTitle));
  const customOptionMeasurements = needsCustomMeasurements
    ? configuredProduct ? (measurementsEnabled ? measurementFields : []) : (['chest', 'shoulder', 'sleeve', 'length'] as const).map(name => ({ id: name, name, unit: unit as 'cm'|'inch', required: true }))
    : [];
  const measurementGuides = (configuredProduct?.measurementGuides || []).filter(guide => guide.published === true && Boolean(guide.image));
  const measurementGuideVideo = configuredProduct?.measurementGuideVideo?.published === true ? configuredProduct.measurementGuideVideo : undefined;
  const missingCustomMeasurements = customOptionMeasurements.some(field => field.required === true && !measurements[field.id]?.trim()) || (showMeasurements && step === measurementStep && measurementFields.some(field => field.required === true && !measurements[field.id]?.trim()));
  const modelStep = customSteps.find(item => /model/i.test(item.title));
  const colorStep = customSteps.find(item => /colou?r/i.test(item.title));
  const fabricStep = customSteps.find(item => /fabric|cloth/i.test(item.title));
  const stitchingStep = customSteps.find(item => /stitch/i.test(item.title));
  const selectedColorOption = colorStep ? customSelections[colorStep.id] : undefined;
  const selectedOptionTotal = customSteps.reduce((total, item) => total + (customSelections[item.id]?.priceAdjustment || 0), 0);
  const currentStyle = serviceStyles.find((item) => item.id === style) || serviceStyles[0] || defaultStyles[0];
  const currentFabric = serviceFabrics[fabric] || serviceFabrics[0] || defaultFabrics[0];
  const basePrice = isAbaya ? (selectedProduct?.price ?? 0) : selectedModelOption?.basePrice ?? (selectedProduct ? selectedProduct.price : configuredProduct?.price ?? currentStyle.price);
  const total = useMemo(() => Math.max(0, basePrice + (hasGarmentDefaults ? currentFabric.price : 0) + selectedOptionTotal + (hasGarmentDefaults && speed === 'urgent' ? 350 : 0)), [basePrice, currentFabric.price, selectedOptionTotal, speed, hasGarmentDefaults]);
  const customizationCharges = total - basePrice;
  const deliveryQuote = quoteFlatDelivery(postal, Array.isArray(paySettings.deliveryRules) ? paySettings.deliveryRules as DeliveryRule[] : [], paySettings.keralaPinDirectory as KeralaPostalDirectory|null|undefined, resolveFlatDeliveryFee(paySettings.flatDeliveryFee), paySettings.restrictDeliveryToConfiguredRules === true);
  const finalTotal = deliveryQuote.status === 'available' ? Math.round((total + deliveryQuote.fee) * 100) / 100 : null;
  const isCustomReferenceOrder = Boolean((isAbaya || isKandura) && modelReferencePhoto?.url);
  const checkoutPaymentAmount = isCustomReferenceOrder ? 500 : finalTotal;
  const runningTotal = step === paymentStep && isCustomReferenceOrder ? (confirmedPaymentAmount ?? 500) : confirmedBreakdown?.total ?? finalTotal ?? (step >= deliveryStep ? null : total);
  const titles = [...(hasAbayaProductSelectionStep ? ['Select Abaya Model'] : hasProductIntro ? [`Choose your ${selectedProduct!.category.toLowerCase()}`] : hasGarmentDefaults ? ['Choose your style'] : []), ...(hasGarmentDefaults ? ['Select your fabric', 'Choose a colour', 'Your perfect fit'] : []), ...customSteps.map((item) => item.title), ...(showMeasurements ? ['Custom size / measurements'] : []), ...(hasTimingStep ? ['Tailoring speed'] : []), 'Review your design', 'Delivery details', 'UPI payment'];

  useEffect(() => {
    if (needsCustomMeasurements) setCustomSizeExpanded(true);
  }, [needsCustomMeasurements, activeCustomOption?.id]);

  function ensureCheckoutReference() {
    if (!checkoutReferenceRef.current) {
      checkoutReferenceRef.current = `AT-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    return checkoutReferenceRef.current;
  }

  async function uploadModelReferencePhoto(draft = modelReferenceDraft) {
    if (!draft || modelReferenceUploadLock.current) return;
    modelReferenceUploadLock.current = true;
    const orderId = ensureCheckoutReference();
    setModelReferenceUploading(true);
    setModelReferenceProgress(0);
    setModelReferenceError('');
    try {
      const blob = await withAbortableDeadline(
        async (signal, reportActivity) => {
          const modeResponse = await fetch('/api/customer/abaya-reference-photo', { method: 'GET', cache: 'no-store', signal });
          if (!modeResponse.ok) throw new ImageUploadError('token', 'Reference photo storage is not configured for this deployment.');
          const mode = (await modeResponse.json().catch(() => null))?.mode;
          reportActivity();
          if (mode !== 'presigned' && mode !== 'client-token') throw new ImageUploadError('token', 'Reference photo storage returned an unsupported upload mode.');
          const options = {
            access: 'private' as const,
            handleUploadUrl: '/api/customer/abaya-reference-photo',
            clientPayload: orderId,
            contentType: draft.file.type,
            multipart: false,
            abortSignal: signal,
            onUploadProgress: (event: { percentage?: number }) => {
              reportActivity();
              setModelReferenceProgress(Math.min(99, Math.max(0, event.percentage || 0)));
            },
          };
          return mode === 'presigned'
            ? uploadPresigned(draft.pathname, draft.file, options)
            : upload(draft.pathname, draft.file, options);
        },
        { timeoutMs: 120_000, idleTimeoutMs: 45_000, onTimeout: (kind) => new ImageUploadError(kind === 'idle' ? 'blob' : 'confirmation', kind === 'idle' ? 'The photo upload stopped reporting progress. Retry the photo; your other selections are unchanged.' : 'The photo upload did not finish before its deadline. Retry the photo; your other selections are unchanged.', { fileName: draft.file.name }) },
      );
      if (!isModelReferenceUrl(blob.url, orderId)) throw new ImageUploadError('confirmation', 'Storage returned an invalid private photo reference. Please retry.', { fileName: draft.file.name });
      setModelReferencePhoto({ url: blob.url, preview: draft.preview, name: draft.file.name });
      setModelReferenceDraft(null);
      setModelReferenceProgress(100);
    } catch (error) {
      setModelReferenceProgress(0);
      setModelReferenceError(error instanceof Error ? error.message : 'The photo could not be uploaded. Retry it without losing your selections.');
    } finally {
      modelReferenceUploadLock.current = false;
      setModelReferenceUploading(false);
    }
  }

  function selectModelReferencePhoto(file: File | undefined) {
    if (!file) return;
    const validationError = validateModelReferenceFile(file);
    if (validationError) {
      setModelReferenceError(validationError);
      return;
    }
    const preview = URL.createObjectURL(file);
    referencePreviewUrls.current.push(preview);
    const orderId = ensureCheckoutReference();
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
    const draft = { file, preview, pathname: `${MODEL_REFERENCE_PREFIX}${orderId}/${crypto.randomUUID()}.${extension}` };
    setModelReferenceDraft(draft);
    setModelReferenceError('');
    void uploadModelReferencePhoto(draft);
  }

  function removeModelReferencePhoto() {
    setModelReferenceDraft(null);
    setModelReferencePhoto(null);
    setModelReferenceProgress(0);
    setModelReferenceError('');
  }

  function openUpiApp(orderRef: string, amount: number | null = confirmedPaymentAmount ?? checkoutPaymentAmount) {
    setUpiFallback(false);
    const upiId = typeof paySettings.upiId === 'string' ? paySettings.upiId : '';
    const paymentUrl = amount === null ? null : createUpiPaymentUrl(upiId, amount, orderRef);
    if (!paymentUrl) { setUpiFallback(true); return; }
    setPaymentAppRequested(true);

    let fallbackTimer: number;
    const showFallback = () => {
      window.clearTimeout(fallbackTimer);
      setUpiFallback(true);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(fallbackTimer);
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    fallbackTimer = window.setTimeout(() => { if (document.visibilityState === 'visible') showFallback(); }, 2200);
    try { window.location.assign(paymentUrl); } catch { showFallback(); }
  }

  async function copyOrderReference() {
    try {
      await navigator.clipboard.writeText(orderId);
      setOrderReferenceCopied(true);
      setOrderReferenceCopyError('');
      window.setTimeout(() => setOrderReferenceCopied(false), 2200);
    } catch {
      setOrderReferenceCopied(false);
      setOrderReferenceCopyError('Copy is unavailable here. Select the order reference and copy it manually.');
    }
  }

  async function placeOrder() {
    if (submitting) return;
    setCheckoutError('');
    setSubmitting(true);
    const id = pendingOrderRef.current?.id || ensureCheckoutReference();
    const fit = sizing === 'standard' ? `Standard · ${size}` : `Custom (${unit}): ${Object.entries(measurements).map(([key, value]) => `${key} ${value || '—'}`).join(', ')}`;
    const productName = photoOnlyAbayaRequest ? 'Custom Abaya Reference' : selectedProduct?.name || configuredProduct?.name || `${currentStyle.name} Kandura`;
    const abayaProductSnapshot = isAbaya && selectedProduct ? getAbayaProductOrderSnapshot(selectedProduct) : null;
    const chosenCustomOptions = customSteps.map((item) => { const selected = customSelections[item.id]; return { stepId: item.id, step: item.title, required: item.required === true, optionId: selected?.id || '', option: selected?.name || '', optionDescription: selected?.description || '', optionImage: selected?.image || selected?.images?.[0] || '', optionImages: [...new Set([...(selected?.images || []), ...(selected?.image ? [selected.image] : [])])], optionSwatch: selected?.swatch || '', priceAdjustment: selected?.priceAdjustment || 0, ...(selected?.basePrice !== undefined ? { basePrice: selected.basePrice } : {}), ...(selected?.stock !== undefined ? { stock: selected.stock } : {}) }; });
    const enteredMeasurements = measurementFields.reduce<Record<string, string>>((values, field) => { const value = measurements[field.id]; if (value?.trim()) values[field.name] = `${value} ${field.unit}`; return values; }, {});
    const selectedOptions = {
      ...(activeProductOption ? { productOption: activeProductOption } : {}),
      ...(hasGarmentDefaults ? { fabric: currentFabric.name, color } : {}),
      customization: chosenCustomOptions,
      ...(Object.values(measurements).some(value => value.trim()) ? { measurements: { unit, ...measurements, ...enteredMeasurements } } : {}),
      ...(hasGarmentDefaults ? { fit, speed: hasTimingStep ? (speed === 'normal' ? 'Normal tailoring' : 'Priority tailoring') : 'Configured production options' } : {}),
      note,
    };
    if (deliveryQuote.status !== 'available' || finalTotal === null) {
      setCheckoutError(deliveryQuote.message);
      setSubmitting(false);
      return;
    }
    const order = {
      id,
      customer: name,
      initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      product: photoOnlyAbayaRequest ? 'Abaya · Custom Reference' : hasGarmentDefaults ? `${productName} · ${color}` : isKandura ? [productName, selectedModelOption?.name, selectedColorOption?.name].filter(Boolean).join(' · ') : productName,
      ...(photoOnlyAbayaRequest ? {} : abayaProductSnapshot ? abayaProductSnapshot : selectedProduct ? { productId: selectedProduct.id, productName: selectedProduct.name, productImage: selectedProduct.image, basePrice } : configuredProduct ? { productId: configuredProduct.id, productName, productImage: configuredProduct.image, basePrice } : {}),
      date: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      subtotal: total,
      deliveryFee: deliveryQuote.fee,
      discount: 0,
      total: finalTotal,
      status: 'New',
      tone: 'sand',
      statusPayment: 'Pending verification',
      paymentMethod: 'upi',
      delivery: { email, phone, address, city, postal },
      whatsappConsent: { customerUpdates: whatsappUpdatesConsent && whatsappPhoneValid },
      createdAt: new Date().toISOString(),
      design: {
        productType: isAbaya ? (selectedProduct?.category || 'Abaya') : selectedProduct?.category || 'Kandura',
        ...(photoOnlyAbayaRequest ? { basePrice: 0, options: [], customization: [], note } : abayaProductSnapshot ? { ...abayaProductSnapshot, options: [...(activeProductOption ? [activeProductOption] : []), ...chosenCustomOptions.map((item) => item.option).filter(Boolean)] } : selectedProduct ? { productId: selectedProduct.id, productName: selectedProduct.name, productImage: selectedProduct.image, basePrice, options: [...(activeProductOption ? [activeProductOption] : []), ...chosenCustomOptions.map((item) => item.option).filter(Boolean)] } : { ...(configuredProduct ? { productId: configuredProduct.id, productName, productImage: configuredProduct.image } : {}), ...(modelSelectionStep ? (selectedModelOption ? { style: selectedModelOption.id, styleName: selectedModelOption.name } : {}) : { style, styleName: customSelections[customSteps[0]?.id]?.name || currentStyle.name }), basePrice, options: [...(activeProductOption ? [activeProductOption] : []), ...chosenCustomOptions.map((item) => item.option).filter(Boolean)] }),
        ...(selectedModelOption ? { selectedModel: { id: selectedModelOption.id, name: selectedModelOption.name, image: selectedModelOption.image || selectedModelOption.images?.[0] || '', images: [...new Set([...(selectedModelOption.images || []), ...(selectedModelOption.image ? [selectedModelOption.image] : [])])], basePrice: isAbaya ? basePrice : selectedModelOption.basePrice ?? basePrice, priceAdjustment: selectedModelOption.priceAdjustment || 0 } } : {}),
        ...((isAbaya || isKandura) && modelReferencePhoto ? { customerReferencePhoto: { url: modelReferencePhoto.url, fileName: modelReferencePhoto.name, uploaded: true } } : {}),
        ...(!photoOnlyAbayaRequest ? selectedOptions : {}),
        ...(hasGarmentDefaults ? { fabricPrice: currentFabric.price, priorityPrice: hasTimingStep && speed === 'urgent' ? 350 : 0 } : {}),
        subtotal: total,
      },
    };
    pendingOrderRef.current = order;

    try {
      const response = await fetch('/api/store-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
      const saved = await response.json().catch(() => null);
      const expectedOrderType = isCustomReferenceOrder ? 'custom_reference_photo' : 'standard';
      const expectedPaymentAmount = isCustomReferenceOrder ? 500 : finalTotal;
      const savedAmountIsConsistent = isCustomReferenceOrder
        ? saved?.estimatedTotal === finalTotal && (saved?.finalPriceConfirmed === true ? saved?.total === saved?.finalPrice : saved?.total === finalTotal)
        : saved?.total === finalTotal;
      if (!response.ok || saved?.ok !== true || saved?.orderId !== id || !['Pending verification', 'Paid', 'Failed', 'Refunded'].includes(saved?.statusPayment) || saved?.subtotal !== total || saved?.deliveryFee !== deliveryQuote.fee || !savedAmountIsConsistent || saved?.orderType !== expectedOrderType || saved?.paymentAmount !== expectedPaymentAmount || (isCustomReferenceOrder && (saved?.advanceAmount !== 500 || !['Pending verification', 'Paid', 'Failed', 'Refunded'].includes(saved?.advanceStatus) || typeof saved?.finalPriceConfirmed !== 'boolean' || (saved.finalPriceConfirmed && (!Number.isFinite(saved.finalPrice) || saved.finalPrice < 500))))) {
        throw new Error(saved?.error || 'The atelier could not confirm the pending order save. Your selections are still here; retry safely.');
      }
      setOrderId(saved.orderId);
      setPaymentStatus(saved.statusPayment);
      setConfirmedTotal(saved.total);
      setConfirmedEstimate(saved.estimatedTotal ?? saved.total);
      setConfirmedPaymentAmount(saved.paymentAmount);
      setConfirmedFinalPrice(saved.finalPriceConfirmed ? saved.finalPrice : null);
      setConfirmedRemainingBalance(saved.finalPriceConfirmed && saved.advanceStatus === 'Paid' && Number.isFinite(saved.remainingBalance) ? saved.remainingBalance : null);
      setConfirmedAdvanceStatus(saved.advanceStatus || saved.statusPayment);
      setConfirmedBreakdown({subtotal:saved.subtotal,deliveryFee:saved.deliveryFee,discount:saved.discount||0,total:saved.total});
      setStep(paymentStep);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'The atelier could not confirm the pending order save. Your selections are still here; retry safely.');
    } finally {
      setSubmitting(false);
    }
  }

  function selectAbayaProduct(product: StoreProduct) {
    setRequestedProductId(product.id);
    setRequestedProductType('Abaya');
    setSelectedProductOption('');
    setCustomSelections({});
    setExpandedOptionId(null);
    setCheckoutError('');
  }

  function next() {
    if (requiredSelectionMissing || missingCustomMeasurements || referencePhotoNotSaved) return;
    if (step === deliveryStep) {
      void placeOrder();
      return;
    }
    if (step === paymentStep && orderId) {
      openUpiApp(orderId);
      return;
    }
    if (step === reviewStep) ensureCheckoutReference();
    if (step < deliveryStep) setStep((value) => value + 1);
  }

  const garmentLabel = isAbaya ? 'Abaya' : selectedProduct?.category || 'Kandura';

  return (
    <main className="customizer-page" style={{ minHeight: '100vh', background: 'var(--ink)' }}>
      <header className="header customizer-header" style={{ position: 'relative', background: 'var(--ink)' }}>
        <div className="wrap customizer-header-inner">
          <Link className="brand" href="/">ARABIAN <span className="gold">{paySettings.storeName?.replace(/^ARABIAN\s*/i, '') || 'TAILORS'}</span></Link>
          <span className="eyebrow">{garmentLabel} Atelier</span>
          <span className="subtle">Made to your measure</span>
        </div>
      </header>

      <div className="wrap customizer-shell">
        <Link href="/" className="subtle"><ArrowLeft size={13} style={{ verticalAlign: 'middle' }} /> Back to collection</Link>
        <div className="customizer-intro"><div className="eyebrow">Your design journey</div><h1 className="serif"><i>Made for you.</i></h1><p className="subtle">A considered process, guided by your choices.</p></div>

        <div className="customizer-progress">
          <div className="customizer-progress-labels">{titles.map((title, index) => <span key={`${index}-${title}`} aria-label={`Step ${index + 1}: ${title}`} style={{ color: index === step ? 'var(--gold)' : '#666' }}>{index < step ? <Check size={13} /> : String(index + 1).padStart(2,'0')}</span>)}</div>
          <div className="customizer-progress-track"><div style={{ width: `${Math.min((step + 1) / (paymentStep + 1) * 100, 100)}%` }} /></div>
          <div className="eyebrow customizer-current-step">{step === paymentStep && orderId ? paymentStatus === 'Pending verification' ? 'PENDING PAYMENT' : `PAYMENT ${paymentStatus.toUpperCase()}` : `STEP ${String(step + 1).padStart(2,'0')} — ${titles[step]}`}</div>
        </div>

        <section className="customize-layout">
          <div className="customizer-panel">
            {step === 0 && hasAbayaProductSelectionStep ? (
              <>
                <h2 className="serif customizer-step-title">Select Abaya Model</h2>
                <p className="subtle">Choose a piece from the current Abaya collection, or upload a reference photo to request a custom design without selecting a model. A selected model’s saved price, images and customization options follow your choice.</p>
                <ModelReferencePhotoSection draft={modelReferenceDraft} photo={modelReferencePhoto} uploading={modelReferenceUploading} progress={modelReferenceProgress} error={modelReferenceError} onSelectPhoto={selectModelReferencePhoto} onRetry={() => void uploadModelReferencePhoto()} onRemove={removeModelReferencePhoto} />
                {storeDataStatus === 'loading' ? <div className="empty-state abaya-empty-state" role="status">Loading the current Abaya collection…</div> : storeDataStatus === 'error' ? <div className="empty-state abaya-empty-state" role="alert">Abaya products could not be loaded. Refresh this page to try again.</div> : abayaProductChoices.length ? <div className="abaya-product-choice-grid">{abayaProductChoices.map(product => <AbayaProductChoice key={product.id} product={product} selected={selectedProduct?.id === product.id} onSelect={selectAbayaProduct} />)}</div> : <div className="empty-state abaya-empty-state">No Abaya models are currently available. Please contact the atelier.</div>}
                {selectedProduct?.options?.length ? <label className="subtle abaya-option-select">Available option<select value={activeProductOption} onChange={event => setSelectedProductOption(event.target.value)}>{selectedProduct.options.map(option => <option key={option}>{option}</option>)}</select></label> : null}
              </>
            ) : step === 0 && hasProductIntro ? (
              <>
                <h2 className="serif customizer-step-title">Select your {selectedProduct!.category}</h2>
                <p className="subtle">Your chosen piece, ready to make personal. Continue through the same made-to-measure checkout used for Kanduras.</p>
                <div className="selected-garment-card">
                  <div className="selected-garment-visual">{selectedProduct!.images?.length?<div className="product-image-gallery">{selectedProduct!.images.map((image,index)=><img key={`${image}-${index}`} src={productImageSource(image)} alt={`${selectedProduct!.name} image ${index+1}`}/>)}</div>:selectedProduct!.image?<img src={productImageSource(selectedProduct!.image)} alt={selectedProduct!.name}/>:isAbaya?<GarmentVisual kind="abaya"/>:null}</div>
                  <div><span className="eyebrow">{selectedProduct!.category}</span><h3 className="serif">{selectedProduct!.name}</h3><p className="subtle">{selectedProduct!.description}</p><span className="gold">Base price · ₹{selectedProduct!.price.toLocaleString('en-IN')}</span>{selectedProduct!.options?.length ? <label className="subtle abaya-option-select">Available option<select value={activeProductOption} onChange={(event) => setSelectedProductOption(event.target.value)}>{selectedProduct!.options.map((option) => <option key={option}>{option}</option>)}</select></label> : null}</div>
                </div>
                {(isAbaya || isKandura) && !modelSelectionStep && <section className="abaya-reference-upload" aria-label="Custom reference photo">
                  <div><h3 className="serif">Upload a reference photo (optional)</h3><p className="subtle">A photo is enough to request a custom design; no model or style card is required. JPG, PNG or WebP · up to 10 MB.</p></div>
                  {(modelReferenceDraft || modelReferencePhoto) && <img className="abaya-reference-preview" src={modelReferenceDraft?.preview || modelReferencePhoto?.preview} alt="Full reference photo preview" />}
                  <div className="abaya-reference-actions"><label className="btn btn-outline">{modelReferencePhoto ? 'Replace photo' : 'Choose photo'}<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={modelReferenceUploading} onChange={event => { selectModelReferencePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>{modelReferenceDraft && !modelReferenceUploading && <button type="button" className="btn btn-outline" onClick={() => void uploadModelReferencePhoto()}>Retry upload</button>}{(modelReferenceDraft || modelReferencePhoto) && !modelReferenceUploading && <button type="button" className="btn btn-outline" onClick={removeModelReferencePhoto}>Remove photo</button>}{modelReferenceUploading && <span role="status" className="subtle">Uploading securely · {modelReferenceProgress}%</span>}{!modelReferenceDraft && modelReferencePhoto && <span role="status" className="subtle">Photo uploaded securely.</span>}</div>{modelReferenceError && <p role="alert" className="checkout-error">{modelReferenceError}</p>}
                </section>}
              </>
            ) : hasGarmentDefaults && step === 0 ? (
              <>
                <h2 className="serif customizer-step-title">Select a silhouette</h2><p className="subtle">Each style carries its own character and tailoring details.</p>
                <div className="product-grid customize-style-grid">{serviceStyles.map((item) => <button key={item.id} className={`customizer-choice ${style === item.id ? 'selected' : ''}`} onClick={() => { setStyle(item.id); setSelectedProductOption(''); setCustomSelections({}); }}><div className="customizer-choice-image" style={{ backgroundImage: `url('${productImageSource(item.image)}')` }} /><div className="customizer-choice-copy"><span className="serif">{item.name}</span><span className="subtle">{item.desc}</span><b className="gold">Tailoring ₹{item.price.toLocaleString('en-IN')}</b></div></button>)}</div>{configuredProduct?.options?.length ? <label className="subtle abaya-option-select">Available option<select value={activeProductOption} onChange={(event) => setSelectedProductOption(event.target.value)}>{configuredProduct.options.map((option) => <option key={option}>{option}</option>)}</select></label> : null}
              </>
            ) : null}

            {showMeasurements && step === measurementStep && <div className="customer-measurement-panel"><h2 className="serif customizer-step-title">Custom size / measurements</h2><p className="subtle">Enter the measurements requested by the atelier. Your tailor will review them with the order.</p><div className="measurement-grid">{measurementFields.map(field=><CustomerMeasurementField key={field.id} field={field} value={measurements[field.id]||''} onChange={value=>setMeasurements(previous=>({...previous,[field.id]:value}))}/>)}</div>{measurementGuides.length > 0 && <section className="customer-measurement-guides" aria-label={`${garmentLabel} measurement guides`}><h4 className="serif">Measurement guide</h4><p className="subtle">Follow the atelier’s reference photos while entering your measurements.</p><div className="customer-measurement-guide-grid">{measurementGuides.map(guide => <figure key={guide.id}><img src={productImageSource(guide.image)} alt={guide.title} loading="lazy"/><figcaption><b>{guide.title}</b>{guide.instructions&&<p className="subtle">{guide.instructions}</p>}</figcaption></figure>)}</div></section>}{measurementGuideVideo&&<section className="customer-measurement-video" aria-label={`${garmentLabel} measurement guide video`}><h4 className="serif">Measurement Guide Video</h4>{measurementGuideVideo.instructions&&<p className="subtle">{measurementGuideVideo.instructions}</p>}<video src={productImageSource(measurementGuideVideo.url)} controls playsInline preload="metadata" aria-label={`${garmentLabel} measurement guide`}/></section>}</div>}

            {hasGarmentDefaults && step === 1 && <><h2 className="serif customizer-step-title">Choose the cloth</h2><p className="subtle">Consider the hand, weight and way it falls.</p>{serviceFabrics.map((item, index) => <button key={item.name} disabled={!item.available} className={`fabric-choice ${index === fabric ? 'selected' : ''}`} onClick={() => setFabric(index)}><span className="fabric-swatch" style={{ background: item.swatch }} /><span className="fabric-choice-copy"><b className="serif">{item.name}</b><span className="subtle">{item.quality} · {item.available ? 'Available' : 'Unavailable'}</span></span><span>₹{item.price.toLocaleString('en-IN')}</span></button>)}</>}

            {activeCustomStep && (() => {
              const item = activeCustomStep;
              const chosen = customSelections[item.id];
                  const visibleOptions = item.options.filter(option => option.visible !== false && option.available !== false && (option.stock === undefined || option.stock > 0));
              const isModelStep = isAbaya ? isAbayaModelStep(baseCustomSteps.find(configuredStep => configuredStep.id === item.id)) : /model/i.test(item.title);
              const supportsModelReference = isModelStep || Boolean(isAbaya && item.id === modelSelectionStep?.id);
              const showCustomMeasurements = needsCustomMeasurements && (customOptionMeasurements.length > 0 || (isKandura && (measurementGuides.length > 0 || Boolean(measurementGuideVideo))));
              return <>
                {hasModelStep && step === 0 && configuredProduct?.images?.length ? <div className="product-image-gallery">{configuredProduct.images.map((image, index) => <img key={`${image}-${index}`} src={productImageSource(image)} alt={`${configuredProduct.name} image ${index + 1}`} />)}</div> : null}
                <h2 className="serif customizer-step-title">{item.title}</h2>
                <p className="subtle">{isModelStep ? 'Optional selection — a reference photo alone is also accepted' : item.required === true ? 'Required selection' : 'Optional selection'}{item.description ? ` · ${item.description}` : ''}</p>
                <div className="dynamic-option-list">
                  {visibleOptions.map(option => {
                    const photos = [...new Set([...(option.images || []), ...(option.image ? [option.image] : [])])];
                    const expanded = expandedOptionId === option.id;
                    const hasOptionDetails = Boolean(option.description || photos.length > 0);
                    const isColorStep = /colou?r/i.test(item.title);
                    const hasVisual = isModelStep || photos.length > 0 || (isColorStep && Boolean(getOptionSwatch(option)));
                    return <article className={`dynamic-option-item ${isModelStep ? 'model-option-item' : ''} ${/fabric|cloth/i.test(item.title) ? 'fabric-option-item' : ''}`} key={option.id}>
                      <button type="button" className={`dynamic-option-choice ${hasVisual ? 'has-visual' : ''} ${isModelStep ? 'model-option-card' : ''} ${/fabric|cloth/i.test(item.title) && photos.length ? 'fabric-option-card' : ''} ${isColorStep && hasVisual ? 'color-option-card' : ''} ${isColorStep && photos.length ? 'color-option-photo-card' : ''} ${chosen?.id === option.id ? 'selected' : ''}`} aria-pressed={chosen?.id === option.id} onClick={() => { setCustomSelections(previous => isModelStep ? { [item.id]: option } : ({ ...previous, [item.id]: option })); if (hasOptionDetails) setExpandedOptionId(expanded ? null : option.id); }}>
                        {isColorStep && getOptionSwatch(option) ? <span className="dynamic-option-color-swatch" style={{ backgroundColor: getOptionSwatch(option) }} aria-label={`${option.name} swatch`} /> : null}
                        {isModelStep ? <CustomOptionImage src={photos[0]} name={option.name} modelCard /> : photos.length > 0 ? <CustomOptionImage src={photos[0]} name={option.name} fallbackColor={isColorStep ? getOptionSwatch(option) : undefined} /> : null}
                        <span className="dynamic-option-copy"><b>{option.name}</b>{option.description && <small className="subtle">{option.description}</small>}{option.available === false && <small className="subtle">Currently unavailable</small>}</span>
                        <b>{isModelStep && !isAbaya && option.basePrice !== undefined ? `₹${option.basePrice.toLocaleString('en-IN')} base` : (option.priceAdjustment || 0) > 0 ? `+ ₹${option.priceAdjustment!.toLocaleString('en-IN')}` : (option.priceAdjustment || 0) < 0 ? `− ₹${Math.abs(option.priceAdjustment!).toLocaleString('en-IN')}` : 'Included'}</b>
                      </button>
                      {hasOptionDetails && <button type="button" className="option-details-toggle" aria-expanded={expanded} onClick={() => setExpandedOptionId(expanded ? null : option.id)}>{expanded ? 'Hide details' : `View details${photos.length > 1 ? ` · ${photos.length} photos` : ''}`}</button>}
                      {expanded && hasOptionDetails && <div className="model-option-details">{option.description && <p className="subtle">{option.description}</p>}{photos.length > 0 && <div className="model-option-gallery">{photos.map((photo, index) => <img key={`${photo}-${index}`} src={productImageSource(photo)} alt={`${option.name} photo ${index + 1}`} />)}</div>}</div>}
                    </article>;
                  })}
                  {!visibleOptions.length && <p className="subtle">No options are currently shown. Please contact the atelier.</p>}
                </div>
                {!isAbaya && supportsModelReference && <ModelReferencePhotoSection draft={modelReferenceDraft} photo={modelReferencePhoto} uploading={modelReferenceUploading} progress={modelReferenceProgress} error={modelReferenceError} onSelectPhoto={selectModelReferencePhoto} onRetry={() => void uploadModelReferencePhoto()} onRemove={removeModelReferencePhoto} />}
                {supportsModelReference && isCustomReferenceOrder && <div className="custom-reference-payment-highlights"><section className="custom-reference-advance"><span className="eyebrow">₹500 ADVANCE PAYMENT</span><strong>Pay ₹500 to confirm your custom order.</strong><p>₹500 is an advance, not the full stitching price. The final stitching price will be communicated through WhatsApp after our team reviews your uploaded reference photo.</p></section><section className="custom-reference-refund"><span className="eyebrow">100% REFUND GUARANTEE</span><strong>₹500 FULL REFUND</strong><p>If we are unable to create your requested design, your ₹500 advance will be fully refunded.</p></section></div>}
                {showCustomMeasurements && <section className="inline-custom-measurements">
                  <button type="button" className="inline-custom-measurements-toggle" aria-expanded={customSizeExpanded} onClick={() => setCustomSizeExpanded(value => !value)}><span><b>Custom measurements</b><small className="subtle">Enter the fields requested by the atelier</small></span><span aria-hidden="true">{customSizeExpanded ? '−' : '+'}</span></button>
                  {customSizeExpanded && <>{customOptionMeasurements.length > 0 && <div className="measurement-grid">{customOptionMeasurements.map(field => <CustomerMeasurementField key={field.id} field={field} value={measurements[field.id]||''} onChange={value=>setMeasurements(previous=>({...previous,[field.id]:value}))}/>)}<label className="subtle">Unit<select value={unit} onChange={event => setUnit(event.target.value)}><option>cm</option><option>inch</option></select></label></div>}{isKandura && measurementGuides.length > 0 && <section className="customer-measurement-guides" aria-label="Kandura measurement guides"><h4 className="serif">Measurement guide</h4><p className="subtle">Follow the atelier’s reference photos while entering your measurements.</p><div className="customer-measurement-guide-grid">{measurementGuides.map(guide => <figure key={guide.id}><img src={productImageSource(guide.image)} alt={guide.title} loading="lazy"/><figcaption><b>{guide.title}</b>{guide.instructions&&<p className="subtle">{guide.instructions}</p>}</figcaption></figure>)}</div></section>}{measurementGuideVideo&&<section className="customer-measurement-video" aria-label="Kandura measurement guide video"><h4 className="serif">Measurement Guide Video</h4>{measurementGuideVideo.instructions&&<p className="subtle">{measurementGuideVideo.instructions}</p>}<video src={productImageSource(measurementGuideVideo.url)} controls playsInline preload="metadata" aria-label="Kandura measurement guide"/></section>}</>}
                </section>}
              </>;
            })()}

            {hasGarmentDefaults && step === 2 && <><h2 className="serif customizer-step-title">Choose your colour</h2><p className="subtle">A considered palette, chosen to wear beautifully.</p><div className="color-choices">{colors.map((item) => <button key={item.name} onClick={() => setColor(item.name)} aria-label={item.name} aria-pressed={color === item.name} title={item.name}><span style={{ background: item.hex, borderColor: color === item.name ? 'var(--gold)' : '#555' }} /><small className="subtle">{item.name}</small></button>)}</div></>}

            {hasGarmentDefaults && step === 3 && <><h2 className="serif customizer-step-title">How do you like it to fit?</h2><div className="fit-mode-choices">{['standard', 'custom'].map((value) => <button key={value} className={`btn ${sizing === value ? '' : 'btn-outline'}`} onClick={() => setSizing(value)}>{value === 'standard' ? 'Standard size' : 'Custom measurements'}</button>)}</div>{sizing === 'standard' ? <div className="size-choices">{sizes.map((value) => <button key={value} className={`btn ${size === value ? '' : 'btn-outline'}`} onClick={() => setSize(value)} aria-pressed={size === value}>{value}</button>)}</div> : <><p className="subtle">Enter measurements for your {garmentLabel.toLowerCase()}. Your tailor will review them with the order.</p><div className="measurement-grid">{(['chest', 'shoulder', 'sleeve', 'length'] as const).map((key) => <label className="subtle" key={key}>{key}<div className="measurement-input"><input type="number" min="1" value={measurements[key]} onChange={(event) => setMeasurements({ ...measurements, [key]: event.target.value })} placeholder="Measurement" /><select value={unit} onChange={(event) => setUnit(event.target.value)}><option>cm</option><option>inch</option></select></div></label>)}</div></>}</>}

            {hasTimingStep && step === timingStep && <><h2 className="serif customizer-step-title">Choose your timing</h2><p className="subtle">We’ll confirm an estimated completion date before payment.</p><div className="timing-choices">{[{ id: 'normal', name: 'Normal tailoring', desc: 'Our considered standard schedule', fee: 0 }, { id: 'urgent', name: 'Priority tailoring', desc: 'Subject to atelier availability', fee: 350 }].map((item) => <button key={item.id} className={speed === item.id ? 'selected' : ''} onClick={() => setSpeed(item.id)}><span className="eyebrow">{item.fee ? 'Priority' : 'Standard'}</span><b className="serif">{item.name}</b><span className="subtle">{item.desc}</span><span>{item.fee ? `+ ₹${item.fee}` : 'Included'}</span></button>)}</div><label className="subtle customizer-note">A note for your tailor<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Share a fit preference or helpful detail…" rows={3} /></label></>}

            {step === reviewStep && <><h2 className="serif customizer-step-title">Your design, at a glance.</h2><p className="subtle">Review your choices before continuing.</p>{isCustomReferenceOrder && <div className="custom-reference-payment-highlights"><section className="custom-reference-advance"><span className="eyebrow">₹500 ADVANCE PAYMENT</span><strong>Pay ₹500 to confirm your custom order.</strong><p>₹500 is an advance, not the full stitching price. The final stitching price will be communicated through WhatsApp after our team reviews your uploaded reference photo.</p></section><section className="custom-reference-refund"><span className="eyebrow">100% REFUND GUARANTEE</span><strong>₹500 FULL REFUND</strong><p>If we are unable to create your requested design, your ₹500 advance will be fully refunded.</p></section></div>}<div className="design-review">{[['Garment', photoOnlyAbayaRequest ? 'Custom Abaya Reference' : selectedProduct?.name || configuredProduct?.name || `${currentStyle.name} Kandura`], ...(isCustomReferenceOrder ? [['Order type', 'Custom Reference Photo Order']] : []), ...(selectedProductOption ? [['Option', selectedProductOption]] : []), ...customSteps.map(item => [item.title, customSelections[item.id]?.name || (item.id === modelSelectionStep?.id ? 'Not selected (optional)' : item.required===true?'Not selected':'Not selected (optional)')]), ...((isAbaya || isKandura) && modelReferencePhoto ? [['Reference photo', modelReferencePhoto.name]] : []), ...(measurementsEnabled && measurementFields.length ? [['Custom measurements', measurementFields.filter(field=>measurements[field.id]?.trim()).map(field=>`${field.name}: ${measurements[field.id]} ${field.unit}`).join(', ') || 'Not entered']] : []), ...(hasGarmentDefaults ? [['Fabric', currentFabric.name], ['Colour', color], ['Fit', sizing === 'standard' ? `Standard · ${size}` : `Custom measurements (${unit})`], ['Timing', speed === 'normal' ? 'Standard tailoring' : 'Priority tailoring']] : [])].map(([label, value]) => <div key={label}><span className="subtle">{label}</span><span>{value}</span></div>)}</div><label className="subtle customizer-note">A note for your tailor<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Share a fit preference or helpful detail…" rows={3} /></label><div className="price-estimate"><div className="eyebrow">{photoOnlyAbayaRequest ? 'Abaya reference · price after review' : isCustomReferenceOrder ? 'Estimated price · INR' : 'Price estimate · INR'}</div>{selectedProduct && <div className="price-estimate-row"><span className="subtle">{selectedProduct.name} · base</span><span>₹{basePrice.toLocaleString('en-IN')}</span></div>}{hasGarmentDefaults&&<div className="price-estimate-row"><span className="subtle">Fabric · {currentFabric.name}</span><span>₹{currentFabric.price.toLocaleString('en-IN')}</span></div>}{isKandura && !selectedProduct && <div className="price-estimate-row"><span className="subtle">{currentStyle.name} tailoring</span><span>₹{currentStyle.price.toLocaleString('en-IN')}</span></div>}{customSteps.map(item => customSelections[item.id]?.priceAdjustment ? <div className="price-estimate-row" key={item.id}><span className="subtle">{item.title} · {customSelections[item.id].name}</span><span>{customSelections[item.id].priceAdjustment! > 0 ? ' + ' : ' − '}₹{Math.abs(customSelections[item.id].priceAdjustment!).toLocaleString('en-IN')}</span></div> : null)}{hasGarmentDefaults && speed === 'urgent' && <div className="price-estimate-row"><span className="subtle">Priority tailoring estimate</span><span>₹350</span></div>}<div className="price-estimate-total"><span>{photoOnlyAbayaRequest ? 'Tailoring price' : isCustomReferenceOrder ? 'Estimated price (not final)' : 'Total estimate'}</span><b className="gold">{photoOnlyAbayaRequest ? 'To be confirmed after review' : `₹${total.toLocaleString('en-IN')}`}</b></div>{isCustomReferenceOrder && <div className="price-estimate-row"><span>Required advance · Pending</span><b>₹500</b></div>}<p className="subtle">Delivery fee is calculated from your PIN code on the next step. Final total is confirmed before UPI.</p></div><div className="customizer-notice"><ShieldCheck size={15} className="gold" />After placing a custom {garmentLabel} order, the design cannot be changed or cancelled.</div></>}

            {step === deliveryStep && <>
              <h2 className="serif customizer-step-title">Delivery details</h2>
              {isCustomReferenceOrder && <div className="custom-reference-payment-highlights"><section className="custom-reference-advance"><span className="eyebrow">₹500 ADVANCE PAYMENT</span><strong>Pay ₹500 to confirm your custom order.</strong><p>₹500 is an advance, not the full stitching price. The final stitching price will be communicated through WhatsApp after our team reviews your uploaded reference photo.</p>{!photoOnlyAbayaRequest && <div className="price-estimate-row"><span>Estimated order price · not final</span><b>₹{total.toLocaleString('en-IN')}</b></div>}</section><section className="custom-reference-refund"><span className="eyebrow">100% REFUND GUARANTEE</span><strong>₹500 FULL REFUND</strong><p>If we are unable to create your requested design, your ₹500 advance will be fully refunded.</p></section></div>}
              <p className="subtle">Enter delivery details first. A valid-format Indian PIN uses the global flat shop fee. The shop does not verify courier serviceability through this estimate.</p>
              <div className="delivery-fields">{[['Full name', name, setName, 'text'], ['Email address', email, setEmail, 'email'], ['Mobile number', phone, setPhone, 'tel'], ['Postal code', postal, setPostal, 'text'], ['City', city, setCity, 'text'], ['Delivery address', address, setAddress, 'text']].map(([label, value, setter, inputType]: any) => <label key={label} className="subtle">{label}<input required type={inputType} inputMode={label==='Postal code'?'numeric':undefined} maxLength={label==='Postal code'?6:undefined} value={value} onChange={(event) => {const next=label==='Postal code'?event.target.value.replace(/\D/g,'').slice(0,6):event.target.value;setter(next);if(label==='Mobile number'&&!/^\+[1-9]\d{7,14}$/.test(next.trim()))setWhatsappUpdatesConsent(false)}} placeholder={label==='Mobile number'?'+919876543210 (country code required for WhatsApp)':label} disabled={submitting} /></label>)}</div>
              <label className="inline-toggle" style={{display:'flex',alignItems:'flex-start',gap:10,marginTop:14,color:'var(--ivory)'}}><input type="checkbox" checked={whatsappUpdatesConsent} disabled={submitting||!whatsappPhoneValid} onChange={event=>setWhatsappUpdatesConsent(event.target.checked)}/><span>I agree to receive order updates on WhatsApp at this number. Use international format, for example +919876543210.<small style={{display:'block',opacity:.72,marginTop:4}}>Optional. This permission is stored with the order. You can proceed without WhatsApp updates.</small></span></label>
              {deliveryQuote.area&&<p className="checkout-postal-area" role="status"><b>PIN area:</b> {deliveryQuote.area}{deliveryQuote.district?` · ${deliveryQuote.district}`:''}{deliveryQuote.deliveryStatus?` · India Post status: ${deliveryQuote.deliveryStatus}`:''}</p>}
              <section className="checkout-price-breakdown" aria-live="polite"><div className="eyebrow">{photoOnlyAbayaRequest ? 'Delivery quote · tailoring price pending' : 'Order total · INR'}</div>{!photoOnlyAbayaRequest && <div className="checkout-price-row"><span>{selectedProduct?.name || configuredProduct?.name || 'Product'} price</span><b>₹{basePrice.toLocaleString('en-IN')}</b></div>}{!photoOnlyAbayaRequest && <div className="checkout-price-row"><span>Customization charges</span><b>{customizationCharges<0?'− ':''}₹{Math.abs(customizationCharges).toLocaleString('en-IN')}</b></div>}<div className="checkout-price-row checkout-delivery-row"><span>Delivery Fee · flat shop rate</span><b>{deliveryQuote.status==='available'?(deliveryQuote.fee===0?'FREE':`₹${deliveryQuote.fee.toLocaleString('en-IN')}`):deliveryQuote.status==='invalid'?'—':'Needs confirmation'}</b></div><div className="checkout-price-row"><span>Discount</span><b>₹0</b></div><div className="checkout-final-total"><span>{photoOnlyAbayaRequest?'Delivery quote · tailoring price pending':isCustomReferenceOrder?'Estimated Total · not final':'Final Total'}</span><b>{finalTotal===null?'—':`₹${finalTotal.toLocaleString('en-IN')}`}</b></div><p className={deliveryQuote.status==='available'?'subtle':'checkout-delivery-error'} role={deliveryQuote.status==='available'?'status':'alert'}>{deliveryQuote.message}</p><small className="subtle">This is the shop’s flat delivery charge, not an official DTDC quote. It applies to valid-format Indian PIN codes unless the owner explicitly enables destination restrictions.</small></section>
              {!paySettings.upiId && !paySettings.qr && <p role="alert" className="checkout-error">UPI payment details are not configured yet. The atelier must add its merchant UPI ID or QR code in Admin before checkout can continue.</p>}
              <div className="payment-security"><LockKeyhole size={14} className="gold" />UPI only. Payment status remains pending until the shop verifies receipt in its merchant UPI app.</div>
            </>}

            {step === paymentStep && orderId && <>
              <section className="order-confirmation" aria-labelledby="order-confirmation-title">
                <div className="confirmation-heading">
                  <span className="confirmation-icon"><CheckCircle2 size={21}/></span>
                  <div><span className="eyebrow">ORDER SAVED · ARABIAN TAILORS</span><h2 id="order-confirmation-title" className="serif">Your order is in good hands.</h2><p>Your order has been received by the atelier. Keep this reference for any questions.</p></div>
                </div>
                <div className="confirmation-reference">
                  <div><span className="eyebrow">YOUR ORDER REFERENCE</span><strong>{orderId}</strong></div>
                  <button type="button" className="confirmation-copy" onClick={() => void copyOrderReference()} aria-label={orderReferenceCopied ? 'Order reference copied' : 'Copy order reference'}>{orderReferenceCopied ? <Check size={15}/> : <Copy size={15}/>}<span>{orderReferenceCopied ? 'Copied' : 'Copy reference'}</span></button>
                </div>
                {orderReferenceCopyError && <p className="confirmation-copy-error" role="status">{orderReferenceCopyError}</p>}
                <div className="confirmation-statuses" aria-label="Order and payment status">
                  <div className="confirmation-status is-complete"><span>01</span><div><b>Order saved</b><small>Confirmed by the atelier system</small></div><Check size={15}/></div>
                  <div className={`confirmation-status ${paymentAppRequested ? 'is-active' : paymentStatus === 'Paid' ? 'is-complete' : ''}`}><span>02</span><div><b>{paymentAppRequested ? 'Payment initiated' : paymentStatus === 'Paid' ? 'Payment verified' : 'Payment not started'}</b><small>{paymentAppRequested ? 'UPI app was opened or requested' : paymentStatus === 'Paid' ? 'Receipt confirmed by the atelier' : 'Choose UPI below when you are ready'}</small></div>{paymentStatus === 'Paid' && <Check size={15}/>}</div>
                  <div className={`confirmation-status ${paymentStatus === 'Paid' ? 'is-complete' : paymentStatus === 'Pending verification' ? 'is-pending' : 'is-active'}`}><span>03</span><div><b>{paymentStatus === 'Paid' ? 'Verified by atelier' : paymentStatus === 'Pending verification' ? 'Payment pending verification' : `Payment ${paymentStatus.toLowerCase()}`}</b><small>{paymentStatus === 'Paid' ? 'The atelier confirmed receipt' : paymentStatus === 'Pending verification' ? 'Only the atelier can confirm receipt' : 'Current status returned by the order service'}</small></div>{paymentStatus === 'Paid' ? <Check size={15}/> : paymentStatus === 'Pending verification' ? <span className="confirmation-pending-badge">PENDING</span> : <span className="confirmation-pending-badge">{paymentStatus.toUpperCase()}</span>}</div>
                </div>
                <div className="confirmation-delivery">
                  <div className="eyebrow">DELIVERY DETAILS</div>
                  <strong>{name}</strong><span>{address}</span><span>{city} · {postal}</span><span>{phone}</span><span>{email}</span>
                </div>
                <p className="confirmation-next-step">Next: complete the UPI payment below, then allow the atelier to verify the receipt. Opening or returning from a UPI app does not mark an order as paid.</p>
              </section>
              <h2 className="serif customizer-step-title confirmation-payment-title">Complete payment with UPI</h2>
              <p className="subtle">Use the shop’s configured UPI ID, QR code or UPI app link. The payment status stays pending until the atelier verifies the receipt.</p>
              <section className="payment-order-summary">
                <div className="eyebrow">Order summary · {isCustomReferenceOrder ? 'Custom Reference Photo Order' : selectedProduct?.category || 'Kandura'}</div>
                <div className="payment-order-product"><span>{photoOnlyAbayaRequest ? 'Custom Abaya Reference' : selectedProduct?.name || configuredProduct?.name || `${currentStyle.name} Kandura`}</span>{!photoOnlyAbayaRequest && <b>₹{basePrice.toLocaleString('en-IN')}</b>}</div>
                {activeProductOption && <div className="subtle">Product option · {activeProductOption}</div>}
                {selectedModelOption && <div className="subtle">Model · {selectedModelOption.name}</div>}
                {customSteps.filter(item => customSelections[item.id]).map(item => <div className="subtle" key={item.id}>{item.title} · {customSelections[item.id].name}{customSelections[item.id].priceAdjustment ? ` · ${customSelections[item.id].priceAdjustment! > 0 ? '+' : '−'}₹${Math.abs(customSelections[item.id].priceAdjustment!).toLocaleString('en-IN')}` : ''}</div>)}
                {hasGarmentDefaults && <><div className="subtle">Fabric · {currentFabric.name} · Colour · {color}</div><div className="subtle">Fit · {sizing === 'standard' ? `Standard · ${size}` : `Custom measurements (${unit})`} · {speed === 'normal' ? 'Standard production' : 'Priority production'}</div></>}
                {Object.entries(measurements).filter(([, value]) => value.trim()).map(([key, value]) => <div className="subtle" key={key}>Measurement · {key} {value} {unit}</div>)}
                {isCustomReferenceOrder ? <>{!photoOnlyAbayaRequest && <div className="checkout-price-row"><span>Estimated order price · not final</span><b>₹{(confirmedEstimate??total).toLocaleString('en-IN')}</b></div>}{confirmedFinalPrice!==null&&<div className="checkout-price-row"><span>Admin-confirmed final order total</span><b>₹{confirmedFinalPrice.toLocaleString('en-IN')}</b></div>}<div className="payment-order-total"><span>UPI advance due · {confirmedAdvanceStatus}</span><b className="gold">₹{(confirmedPaymentAmount??500).toLocaleString('en-IN')}</b></div>{confirmedRemainingBalance!==null&&<div className="payment-order-total"><span>Remaining balance · advance verified</span><b>₹{confirmedRemainingBalance.toLocaleString('en-IN')}</b></div>}<div className="custom-reference-notice"><p>{confirmedFinalPrice!==null?'The final order total has been confirmed by ARABIAN TAILORS.':'ARABIAN TAILORS will review your design and confirm the final price and remaining balance through WhatsApp.'}</p>{orderId && <small>Custom Reference Photo Order · {orderId}</small>}</div></> : <><div className="checkout-price-row"><span>Product price</span><b>₹{basePrice.toLocaleString('en-IN')}</b></div>{!photoOnlyAbayaRequest && <div className="checkout-price-row"><span>Customization charges</span><b>{customizationCharges<0?'− ':''}₹{Math.abs(customizationCharges).toLocaleString('en-IN')}</b></div>}<div className="checkout-price-row checkout-delivery-row"><span>Delivery Fee · flat shop rate</span><b>{confirmedBreakdown?(confirmedBreakdown.deliveryFee===0?'FREE':`₹${confirmedBreakdown.deliveryFee.toLocaleString('en-IN')}`):deliveryQuote.status==='available'?(deliveryQuote.fee===0?'FREE':`₹${deliveryQuote.fee.toLocaleString('en-IN')}`):'Needs confirmation'}</b></div><div className="checkout-price-row"><span>Discount</span><b>₹{(confirmedBreakdown?.discount??0).toLocaleString('en-IN')}</b></div><div className="payment-order-total"><span>Final Total · Amount to pay</span><b className="gold">₹{(confirmedBreakdown?.total??confirmedTotal??finalTotal??total).toLocaleString('en-IN')}</b></div><small className="subtle">The same shop-configured flat delivery charge applies to Abaya and Kandura; it is not an official DTDC quote.</small></>}
                <small className="subtle">{isCustomReferenceOrder ? 'The advance is ₹500. The atelier will review your reference and confirm the final tailoring price.' : 'The order total above is confirmed by the server. Final tailoring details remain subject to atelier review.'}</small>
              </section>
              <section className="payment-upi-panel">
                <div className="payment-upi-title"><Smartphone size={20} className="gold"/><div><div className="eyebrow">UPI only</div><b>Google Pay · PhonePe · Paytm · any UPI app</b></div></div>
                {paymentStatus === 'Pending verification' ? <>
                  {paySettings.upiId && <p className="subtle">Merchant UPI ID · <b>{paySettings.upiId}</b></p>}
                  {paySettings.qr && <div className="payment-qr payment-qr-checkout"><div className="eyebrow">Shop UPI QR code</div><img src={paySettings.qr} alt="Shop UPI QR code"/><p className="subtle">Scan using another device. {isCustomReferenceOrder?'Enter exactly ₹500 as the advance and use the order reference in the payment note.':'Use the order reference above in the payment note if your app permits.'}</p></div>}
                  {paySettings.upiId && <button type="button" className="btn" onClick={() => openUpiApp(orderId, confirmedPaymentAmount)}>{isCustomReferenceOrder ? `Pay ₹${(confirmedPaymentAmount??500).toLocaleString('en-IN')} advance with UPI` : 'Open Google Pay / Pay with UPI'} <ArrowRight size={14}/></button>}
                  {upiFallback && <p role="status" className="subtle">The UPI app did not open. Use the merchant UPI ID or scan the QR above. You can retry without creating another order.</p>}
                  {paymentAppRequested && <p role="status" className="confirmation-payment-pending">Payment app opened or requested. Your payment is still <b>PENDING</b> until the atelier verifies the receipt.</p>}
                  <p className="subtle">The shop must confirm receipt in its merchant UPI app before Admin marks the order paid. Returning from a payment app never marks it paid.</p>
                </> : <p role="status" className="subtle">The saved order is {paymentStatus.toLowerCase()}. This page will not open another payment request. Contact the atelier if you need help.</p>}
              </section>
            </>}
          </div>

        <aside className="customizer-summary"><div className="eyebrow">{step===paymentStep&&isCustomReferenceOrder?'Advance due':step>=deliveryStep?(isCustomReferenceOrder?'Estimated order price':'Final total'):'Your running estimate'}</div><div className="serif customizer-total">{runningTotal===null?'—':`₹${runningTotal.toLocaleString('en-IN')}`}</div><div className="subtle">{selectedProduct ? <>{selectedProduct.name} ₹{selectedProduct.price.toLocaleString('en-IN')}<br /></> : null}{hasGarmentDefaults&&<>Fabric ₹{currentFabric.price.toLocaleString('en-IN')}</>}{isKandura && !selectedProduct && <><br />Tailoring ₹{currentStyle.price.toLocaleString('en-IN')}</>}{hasGarmentDefaults && speed === 'urgent' && <><br />Priority ₹350</>}{step>=deliveryStep&&<><br/>Delivery · {confirmedBreakdown?(confirmedBreakdown.deliveryFee===0?'FREE':`₹${confirmedBreakdown.deliveryFee.toLocaleString('en-IN')}`):deliveryQuote.status==='available'?(deliveryQuote.fee===0?'FREE':`₹${deliveryQuote.fee.toLocaleString('en-IN')}`):'Needs confirmation'}</>}</div><div className="summary-separator"><Scissors size={14} className="gold" />Made to your choices</div><p className="subtle">{step>=deliveryStep?'UPI amount matches the saved order total.':paySettings.restrictDeliveryToConfiguredRules === true ? 'An enabled PIN rule is required because the shop has explicitly restricted destinations.' : 'The global shop delivery fee applies to every format-valid Indian PIN code.'}</p></aside>
        </section>

        {step === deliveryStep && checkoutError && <p role="alert" className="checkout-error">{checkoutError} You can retry; the same order reference is reused to prevent duplicates.</p>}
        {step < paymentStep && <div className="customizer-nav"><button className="btn btn-outline" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || submitting || Boolean(pendingOrderRef.current)}><ArrowLeft size={14} /> Back</button>{step === deliveryStep ? <button className="btn" onClick={next} disabled={!name || !email || !phone || !address || !city || deliveryQuote.status!=='available' || (!paySettings.upiId && !paySettings.qr) || (total <= 0 && !photoOnlyAbayaRequest) || submitting}>{submitting ? 'Saving pending order…' : <>Save order &amp; continue to UPI · {isCustomReferenceOrder?'₹500 advance':finalTotal===null?'Check delivery':`₹${finalTotal.toLocaleString('en-IN')}`} <ArrowRight size={14} /></>}</button> : <button className="btn" onClick={next} disabled={requiredSelectionMissing || missingCustomMeasurements || referencePhotoNotSaved}>{step === 0 && hasAbayaProductSelectionStep ? 'Continue' : step === 0 && selectedProduct ? 'Order Now' : step === reviewStep ? 'Continue to delivery' : 'Continue'} <ArrowRight size={14} /></button>}</div>}
      </div>

      <footer className="footer"><div className="wrap customizer-footer"><span>ARABIAN TAILORS · INDIA</span><span>Elegance, Tailored for You</span></div></footer>
    </main>
  );
}
