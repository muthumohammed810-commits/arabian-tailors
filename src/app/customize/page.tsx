'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Scissors, CreditCard, Smartphone, Wallet, LockKeyhole, CheckCircle2 } from 'lucide-react';
import { fabrics as defaultFabrics, products as defaultProducts, styles as defaultStyles, type Product } from '@/lib/catalog';
import { GarmentVisual } from '@/components/garment-visual';
import { createUpiPaymentUrl } from '@/lib/upi-payment';
import { customizationDefaults, defaultMeasurements } from '@/lib/customization-defaults';

type CustomizationOption = { id: string; name: string; description?: string; image?: string; images?: string[]; priceAdjustment?: number; available?: boolean; visible?: boolean };
type CustomizationStep = { id: string; title: string; description?: string; required?: boolean; available?: boolean; options: CustomizationOption[] };
type MeasurementField = { id: string; name: string; unit: 'cm' | 'inch'; required?: boolean; available?: boolean };
type StoreProduct = Product & { images?: string[]; available?: boolean; options?: string[]; customizationSteps?: CustomizationStep[]; measurements?: MeasurementField[]; measurementsEnabled?: boolean; stitchingType?: string; stock?: number };
type TailoringStyle = { id: string; name: string; desc: string; price: number; image: string };
type Fabric = { name: string; quality: string; price: number; available: boolean; swatch: string };
const colors = [{ name: 'Ivory', hex: '#eee9dc' }, { name: 'Pure White', hex: '#f8f7f2' }, { name: 'Sand', hex: '#d1c3a3' }, { name: 'Midnight', hex: '#202326' }, { name: 'Slate', hex: '#777b80' }];
const sizes = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

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
    return { ...product, available: true, options: [], customizationSteps, measurements, measurementsEnabled: true };
  });
}

function CustomOptionImage({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img className="dynamic-option-image" src={src} alt={`${name}`} onError={() => setFailed(true)} />;
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
  const [payment, setPayment] = useState('upi');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [orderId, setOrderId] = useState('');
  const [upiFallback, setUpiFallback] = useState(false);
  const [paySettings, setPaySettings] = useState<Record<string, string>>({});
  const [serviceStyles, setServiceStyles] = useState<TailoringStyle[]>(defaultStyles);
  const [serviceFabrics, setServiceFabrics] = useState<Fabric[]>(defaultFabrics);
  const [shopProducts, setShopProducts] = useState<StoreProduct[]>(initialShopProducts);
  const [requestedProductId, setRequestedProductId] = useState<string | null>(null);
  const [selectedProductOption, setSelectedProductOption] = useState('');
  const [customSelections, setCustomSelections] = useState<Record<string, CustomizationOption>>({});
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [customSizeExpanded, setCustomSizeExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const productId = new URLSearchParams(window.location.search).get('product');
    if (productId) setRequestedProductId(productId);

    fetch('/api/store-data', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.settings) {
          setPaySettings(data.settings);
          if (data.settings.gold) document.documentElement.style.setProperty('--gold', data.settings.gold);
          if (data.settings.background) document.documentElement.style.setProperty('--ink', data.settings.background);
        }
        if (Array.isArray(data?.products)) {
          setShopProducts(data.products);
          const kanduras = data.products.filter((product: StoreProduct) => product.available !== false && product.category.toLowerCase() === 'kandura');
          if (kanduras.length) {
            const nextStyles = kanduras.map((product: StoreProduct) => ({ id: product.id, name: product.name, desc: product.description || '', price: product.price, image: product.image }));
            setServiceStyles(nextStyles);
            setStyle(nextStyles[0].id);
          }
          const fabrics = data.products.filter((product: StoreProduct) => product.available !== false && product.category.toLowerCase() === 'fabric');
          if (fabrics.length) setServiceFabrics(fabrics.map((product: StoreProduct) => ({ name: product.name, quality: product.description || '', price: product.price, available: true, swatch: (product as StoreProduct & { swatch?: string }).swatch || '#eee9dc' })));
        }
      })
      .catch(() => {});
  }, []);

  const selectedProduct = requestedProductId ? shopProducts.find((product) => product.id === requestedProductId) : undefined;
  const configuredProduct = selectedProduct || shopProducts.find((product) => product.id === style && product.category.toLowerCase() === 'kandura');
  const activeProductOption = selectedProductOption || configuredProduct?.options?.[0] || '';
  const isAbaya = (selectedProduct || configuredProduct)?.category.toLowerCase() === 'abaya';
  const isKandura = (selectedProduct || configuredProduct)?.category.toLowerCase() === 'kandura' || !selectedProduct;
  const customSteps = (configuredProduct?.customizationSteps || []).filter(item => item.available !== false);
  const hasStoredCustomization = (configuredProduct?.customizationSteps?.length || 0) > 0;
  const hasGarmentDefaults = (!selectedProduct || isAbaya || isKandura) && !hasStoredCustomization;
  const hasModelStep = isKandura && customSteps[0]?.title.toLowerCase() === 'choose your kandura model';
  const hasProductIntro = Boolean(selectedProduct && !hasModelStep);
  const customStepStart = hasGarmentDefaults ? 4 : hasModelStep ? 0 : hasProductIntro ? 1 : 0;
  const measurementFields = (configuredProduct?.measurements || []).filter(field => field.available !== false);
  const measurementsEnabled = configuredProduct?.measurementsEnabled !== false;
  const showMeasurements = !isKandura && measurementsEnabled && measurementFields.length > 0;
  const measurementStep = customStepStart + customSteps.length;
  const hasTimingStep = hasGarmentDefaults && !showMeasurements;
  const timingStep = measurementStep + (showMeasurements ? 1 : 0);
  const reviewStep = timingStep + (hasTimingStep ? 1 : 0);
  const deliveryStep = reviewStep + 1;
  const completionStep = deliveryStep + 1;
  const activeCustomStep = step >= customStepStart && step < measurementStep ? customSteps[step - customStepStart] : undefined;
  const requiredSelectionMissing = Boolean(activeCustomStep && activeCustomStep.required === true && !customSelections[activeCustomStep.id]);
  const activeCustomOption = activeCustomStep ? customSelections[activeCustomStep.id] : undefined;
  const measurementTitle = activeCustomStep?.title.toLowerCase() || '';
  const needsCustomMeasurements = Boolean(activeCustomStep && /custom/i.test(activeCustomOption?.name || '') && /fit|size|length|sleeve|measurement/.test(measurementTitle));
  const customOptionMeasurements = needsCustomMeasurements
    ? configuredProduct ? (measurementsEnabled ? measurementFields : []) : (['chest', 'shoulder', 'sleeve', 'length'] as const).map(name => ({ id: name, name, unit: unit as 'cm'|'inch', required: true }))
    : [];
  const missingCustomMeasurements = customOptionMeasurements.some(field => field.required === true && !measurements[field.id]?.trim()) || (showMeasurements && step === measurementStep && measurementFields.some(field => field.required === true && !measurements[field.id]?.trim()));
  const selectedOptionTotal = customSteps.reduce((total, item) => total + (customSelections[item.id]?.priceAdjustment || 0), 0);
  const currentStyle = serviceStyles.find((item) => item.id === style) || serviceStyles[0] || defaultStyles[0];
  const currentFabric = serviceFabrics[fabric] || serviceFabrics[0] || defaultFabrics[0];
  const basePrice = selectedProduct ? selectedProduct.price : currentStyle.price;
  const total = useMemo(() => Math.max(0, basePrice + (hasGarmentDefaults ? currentFabric.price : 0) + selectedOptionTotal + (hasGarmentDefaults && speed === 'urgent' ? 350 : 0)), [basePrice, currentFabric.price, selectedOptionTotal, speed, hasGarmentDefaults]);
  const titles = [...(hasProductIntro ? [`Choose your ${selectedProduct!.category.toLowerCase()}`] : hasGarmentDefaults ? ['Choose your style'] : []), ...(hasGarmentDefaults ? ['Select your fabric', 'Choose a colour', 'Your perfect fit'] : []), ...customSteps.map((item) => item.title), ...(showMeasurements ? ['Custom size / measurements'] : []), ...(hasTimingStep ? ['Tailoring speed'] : []), 'Review your design', 'Payment & delivery'];

  useEffect(() => {
    if (needsCustomMeasurements) setCustomSizeExpanded(true);
  }, [needsCustomMeasurements, activeCustomOption?.id]);

  function openUpiApp(orderRef: string) {
    const upiId = typeof paySettings.upiId === 'string' ? paySettings.upiId : '';
    const paymentUrl = createUpiPaymentUrl(upiId, total, orderRef);
    if (!paymentUrl) { setUpiFallback(true); return; }

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

  async function placeOrder() {
    if (submitting) return;
    setSubmitting(true);
    const orderIdBytes = crypto.getRandomValues(new Uint8Array(16));
    const id = `AT-${Array.from(orderIdBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const fit = sizing === 'standard' ? `Standard · ${size}` : `Custom (${unit}): ${Object.entries(measurements).map(([key, value]) => `${key} ${value || '—'}`).join(', ')}`;
    const productName = selectedProduct?.name || configuredProduct?.name || `${currentStyle.name} Kandura`;
    const chosenCustomOptions = customSteps.map((item) => ({ stepId: item.id, step: item.title, required: item.required === true, optionId: customSelections[item.id]?.id || '', option: customSelections[item.id]?.name || '', optionDescription: customSelections[item.id]?.description || '', optionImage: customSelections[item.id]?.image || '', priceAdjustment: customSelections[item.id]?.priceAdjustment || 0 }));
    const enteredMeasurements = measurementFields.reduce<Record<string, string>>((values, field) => { const value = measurements[field.id]; if (value?.trim()) values[field.name] = `${value} ${field.unit}`; return values; }, {});
    const selectedOptions = {
      ...(activeProductOption ? { productOption: activeProductOption } : {}),
      ...(hasGarmentDefaults ? { fabric: currentFabric.name, color } : {}),
      customization: chosenCustomOptions,
      ...(Object.values(measurements).some(value => value.trim()) ? { measurements: { unit, ...measurements, ...enteredMeasurements } } : {}),
      ...(hasGarmentDefaults ? { fit, speed: hasTimingStep ? (speed === 'normal' ? 'Normal tailoring' : 'Priority tailoring') : 'Configured production options' } : {}),
      note,
    };
    const order = {
      id,
      customer: name,
      initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      product: hasGarmentDefaults ? `${productName} · ${color}` : productName,
      ...(selectedProduct ? { productId: selectedProduct.id, productName: selectedProduct.name, productImage: selectedProduct.image, basePrice: selectedProduct.price } : configuredProduct ? { productId: configuredProduct.id, productName, productImage: configuredProduct.image, basePrice: configuredProduct.price } : {}),
      date: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      total,
      status: 'New',
      tone: 'sand',
      statusPayment: 'Pending verification',
      paymentMethod: payment,
      delivery: { email, phone, address, city, postal },
      design: {
        productType: selectedProduct?.category || 'Kandura',
        ...(selectedProduct ? { productId: selectedProduct.id, productName: selectedProduct.name, productImage: selectedProduct.image, basePrice: selectedProduct.price, options: [...(activeProductOption ? [activeProductOption] : []), ...chosenCustomOptions.map((item) => item.option).filter(Boolean)] } : { ...(configuredProduct ? { productId: configuredProduct.id, productName, productImage: configuredProduct.image } : {}), style, styleName: customSelections[customSteps[0]?.id]?.name || currentStyle.name, basePrice: configuredProduct?.price ?? currentStyle.price, options: [...(activeProductOption ? [activeProductOption] : []), ...chosenCustomOptions.map((item) => item.option).filter(Boolean)] }),
        ...selectedOptions,
        ...(hasGarmentDefaults ? { fabricPrice: currentFabric.price, priorityPrice: hasTimingStep && speed === 'urgent' ? 350 : 0 } : {}),
        total,
      },
    };

    try {
      const response = await fetch('/api/store-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
      if (!response.ok) throw new Error('We could not save this order securely. Please try again later or contact the atelier.');
      setOrderId(id);
      setStep(completionStep);
      if (payment === 'upi') {
        if (paySettings.upiId) openUpiApp(id);
        else setUpiFallback(true);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'We could not save this order securely. Please try again later or contact the atelier.');
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (requiredSelectionMissing || missingCustomMeasurements) return;
    if (step < deliveryStep) setStep((value) => value + 1);
    else void placeOrder();
  }

  const garmentLabel = selectedProduct?.category || 'Kandura';

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
          <div className="customizer-progress-track"><div style={{ width: `${Math.min((step + 1) / (deliveryStep + 1) * 100, 100)}%` }} /></div>
          <div className="eyebrow customizer-current-step">{step === completionStep ? 'ORDER RECEIVED' : `STEP ${String(step + 1).padStart(2,'0')} — ${titles[step]}`}</div>
        </div>

        <section className="customize-layout">
          <div className="customizer-panel">
            {step === 0 && hasProductIntro ? (
              <>
                <h2 className="serif customizer-step-title">Select your {selectedProduct!.category}</h2>
                <p className="subtle">Your chosen piece, ready to make personal. Continue through the same made-to-measure checkout used for Kanduras.</p>
                <div className="selected-garment-card">
                  <div className="selected-garment-visual">{selectedProduct!.images?.length?<div className="product-image-gallery">{selectedProduct!.images.map((image,index)=><img key={`${image}-${index}`} src={image} alt={`${selectedProduct!.name} image ${index+1}`}/>)}</div>:selectedProduct!.image?<img src={selectedProduct!.image} alt={selectedProduct!.name}/>:isAbaya?<GarmentVisual kind="abaya"/>:null}</div>
                  <div><span className="eyebrow">{selectedProduct!.category}</span><h3 className="serif">{selectedProduct!.name}</h3><p className="subtle">{selectedProduct!.description}</p><span className="gold">Base price · ₹{selectedProduct!.price.toLocaleString('en-IN')}</span>{selectedProduct!.options?.length ? <label className="subtle abaya-option-select">Available option<select value={activeProductOption} onChange={(event) => setSelectedProductOption(event.target.value)}>{selectedProduct!.options.map((option) => <option key={option}>{option}</option>)}</select></label> : null}</div>
                </div>
              </>
            ) : hasGarmentDefaults && step === 0 ? (
              <>
                <h2 className="serif customizer-step-title">Select a silhouette</h2><p className="subtle">Each style carries its own character and tailoring details.</p>
                <div className="product-grid customize-style-grid">{serviceStyles.map((item) => <button key={item.id} className={`customizer-choice ${style === item.id ? 'selected' : ''}`} onClick={() => { setStyle(item.id); setSelectedProductOption(''); setCustomSelections({}); }}><div className="customizer-choice-image" style={{ backgroundImage: `url('${item.image}')` }} /><div className="customizer-choice-copy"><span className="serif">{item.name}</span><span className="subtle">{item.desc}</span><b className="gold">Tailoring ₹{item.price.toLocaleString('en-IN')}</b></div></button>)}</div>{configuredProduct?.options?.length ? <label className="subtle abaya-option-select">Available option<select value={activeProductOption} onChange={(event) => setSelectedProductOption(event.target.value)}>{configuredProduct.options.map((option) => <option key={option}>{option}</option>)}</select></label> : null}
              </>
            ) : null}

            {showMeasurements && step === measurementStep && <div className="customer-measurement-panel"><h2 className="serif customizer-step-title">Custom size / measurements</h2><p className="subtle">Enter the measurements requested by the atelier. Your tailor will review them with the order.</p><div className="measurement-grid">{measurementFields.map(field=><label className="subtle" key={field.id}>{field.name}{field.required===true?' *':''}<div className="measurement-input"><input type="number" min="0" required={field.required===true} value={measurements[field.id]||''} onChange={event=>setMeasurements(previous=>({...previous,[field.id]:event.target.value}))} placeholder={field.unit}/><span>{field.unit}</span></div></label>)}</div></div>}

            {hasGarmentDefaults && step === 1 && <><h2 className="serif customizer-step-title">Choose the cloth</h2><p className="subtle">Consider the hand, weight and way it falls.</p>{serviceFabrics.map((item, index) => <button key={item.name} disabled={!item.available} className={`fabric-choice ${index === fabric ? 'selected' : ''}`} onClick={() => setFabric(index)}><span className="fabric-swatch" style={{ background: item.swatch }} /><span className="fabric-choice-copy"><b className="serif">{item.name}</b><span className="subtle">{item.quality} · {item.available ? 'Available' : 'Unavailable'}</span></span><span>₹{item.price.toLocaleString('en-IN')}</span></button>)}</>}

            {activeCustomStep && (() => {
              const item = activeCustomStep;
              const chosen = customSelections[item.id];
              const visibleOptions = item.options.filter(option => option.visible !== false);
              const isModelStep = /model/i.test(item.title);
              const showCustomMeasurements = needsCustomMeasurements && customOptionMeasurements.length > 0;
              return <>
                {hasModelStep && step === 0 && configuredProduct?.images?.length ? <div className="product-image-gallery">{configuredProduct.images.map((image, index) => <img key={`${image}-${index}`} src={image} alt={`${configuredProduct.name} image ${index + 1}`} />)}</div> : null}
                <h2 className="serif customizer-step-title">{item.title}</h2>
                <p className="subtle">{item.required === true ? 'Required selection' : 'Optional selection'}{item.description ? ` · ${item.description}` : ''}</p>
                <div className="dynamic-option-list">
                  {visibleOptions.map(option => {
                    const photos = [...new Set([...(option.images || []), ...(option.image ? [option.image] : [])])];
                    const expanded = expandedOptionId === option.id;
                    const hasOptionDetails = Boolean(option.description || photos.length > 0);
                    return <article className={`dynamic-option-item ${isModelStep ? 'model-option-item' : ''}`} key={option.id}>
                      <button type="button" disabled={option.available === false} className={`dynamic-option-choice ${photos.length ? 'has-visual' : ''} ${chosen?.id === option.id ? 'selected' : ''} ${option.available === false ? 'unavailable' : ''}`} aria-pressed={chosen?.id === option.id} onClick={() => { setCustomSelections(previous => ({ ...previous, [item.id]: option })); if (hasOptionDetails) setExpandedOptionId(expanded ? null : option.id); }}>
                        <CustomOptionImage src={photos[0]} name={option.name} />
                        <span className="dynamic-option-copy"><b>{option.name}</b>{option.description && <small className="subtle">{option.description}</small>}{option.available === false && <small className="subtle">Currently unavailable</small>}</span>
                        <b>{(option.priceAdjustment || 0) > 0 ? `+ ₹${option.priceAdjustment!.toLocaleString('en-IN')}` : (option.priceAdjustment || 0) < 0 ? `− ₹${Math.abs(option.priceAdjustment!).toLocaleString('en-IN')}` : 'Included'}</b>
                      </button>
                      {hasOptionDetails && <button type="button" className="option-details-toggle" aria-expanded={expanded} onClick={() => setExpandedOptionId(expanded ? null : option.id)}>{expanded ? 'Hide details' : `View details${photos.length > 1 ? ` · ${photos.length} photos` : ''}`}</button>}
                      {expanded && hasOptionDetails && <div className="model-option-details">{option.description && <p className="subtle">{option.description}</p>}{photos.length > 0 && <div className="model-option-gallery">{photos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={`${option.name} photo ${index + 1}`} />)}</div>}</div>}
                    </article>;
                  })}
                  {!visibleOptions.length && <p className="subtle">No options are currently shown. Please contact the atelier.</p>}
                </div>
                {showCustomMeasurements && <section className="inline-custom-measurements">
                  <button type="button" className="inline-custom-measurements-toggle" aria-expanded={customSizeExpanded} onClick={() => setCustomSizeExpanded(value => !value)}><span><b>Custom measurements</b><small className="subtle">Enter the fields requested by the atelier</small></span><span aria-hidden="true">{customSizeExpanded ? '−' : '+'}</span></button>
                  {customSizeExpanded && <div className="measurement-grid">{customOptionMeasurements.map(field => <label className="subtle" key={field.id}>{field.name}{field.required === true ? ' *' : ''}<input type="number" min="0" required={field.required === true} value={measurements[field.id] || ''} onChange={event => setMeasurements(previous => ({ ...previous, [field.id]: event.target.value }))} placeholder={field.unit} /></label>)}<label className="subtle">Unit<select value={unit} onChange={event => setUnit(event.target.value)}><option>cm</option><option>inch</option></select></label></div>}
                </section>}
              </>;
            })()}

            {hasGarmentDefaults && step === 2 && <><h2 className="serif customizer-step-title">Choose your colour</h2><p className="subtle">A considered palette, chosen to wear beautifully.</p><div className="color-choices">{colors.map((item) => <button key={item.name} onClick={() => setColor(item.name)} aria-label={item.name} aria-pressed={color === item.name} title={item.name}><span style={{ background: item.hex, borderColor: color === item.name ? 'var(--gold)' : '#555' }} /><small className="subtle">{item.name}</small></button>)}</div></>}

            {hasGarmentDefaults && step === 3 && <><h2 className="serif customizer-step-title">How do you like it to fit?</h2><div className="fit-mode-choices">{['standard', 'custom'].map((value) => <button key={value} className={`btn ${sizing === value ? '' : 'btn-outline'}`} onClick={() => setSizing(value)}>{value === 'standard' ? 'Standard size' : 'Custom measurements'}</button>)}</div>{sizing === 'standard' ? <div className="size-choices">{sizes.map((value) => <button key={value} className={`btn ${size === value ? '' : 'btn-outline'}`} onClick={() => setSize(value)} aria-pressed={size === value}>{value}</button>)}</div> : <><p className="subtle">Enter measurements for your {garmentLabel.toLowerCase()}. Your tailor will review them with the order.</p><div className="measurement-grid">{(['chest', 'shoulder', 'sleeve', 'length'] as const).map((key) => <label className="subtle" key={key}>{key}<div className="measurement-input"><input type="number" min="1" value={measurements[key]} onChange={(event) => setMeasurements({ ...measurements, [key]: event.target.value })} placeholder="Measurement" /><select value={unit} onChange={(event) => setUnit(event.target.value)}><option>cm</option><option>inch</option></select></div></label>)}</div></>}</>}

            {hasTimingStep && step === timingStep && <><h2 className="serif customizer-step-title">Choose your timing</h2><p className="subtle">We’ll confirm an estimated completion date before payment.</p><div className="timing-choices">{[{ id: 'normal', name: 'Normal tailoring', desc: 'Our considered standard schedule', fee: 0 }, { id: 'urgent', name: 'Priority tailoring', desc: 'Subject to atelier availability', fee: 350 }].map((item) => <button key={item.id} className={speed === item.id ? 'selected' : ''} onClick={() => setSpeed(item.id)}><span className="eyebrow">{item.fee ? 'Priority' : 'Standard'}</span><b className="serif">{item.name}</b><span className="subtle">{item.desc}</span><span>{item.fee ? `+ ₹${item.fee}` : 'Included'}</span></button>)}</div><label className="subtle customizer-note">A note for your tailor<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Share a fit preference or helpful detail…" rows={3} /></label></>}

            {step === reviewStep && <><h2 className="serif customizer-step-title">Your design, at a glance.</h2><p className="subtle">Review your choices before continuing.</p><div className="design-review">{[['Garment', selectedProduct?.name || configuredProduct?.name || `${currentStyle.name} Kandura`], ...(selectedProductOption ? [['Option', selectedProductOption]] : []), ...customSteps.map(item => [item.title, customSelections[item.id]?.name || (item.required===true?'Not selected':'Not selected (optional)')]), ...(measurementsEnabled && measurementFields.length ? [['Custom measurements', measurementFields.filter(field=>measurements[field.id]?.trim()).map(field=>`${field.name}: ${measurements[field.id]} ${field.unit}`).join(', ') || 'Not entered']] : []), ...(hasGarmentDefaults ? [['Fabric', currentFabric.name], ['Colour', color], ['Fit', sizing === 'standard' ? `Standard · ${size}` : `Custom measurements (${unit})`], ['Timing', speed === 'normal' ? 'Normal tailoring' : 'Priority tailoring']] : [])].map(([label, value]) => <div key={label}><span className="subtle">{label}</span><span>{value}</span></div>)}</div><label className="subtle customizer-note">A note for your tailor<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Share a fit preference or helpful detail…" rows={3} /></label><div className="price-estimate"><div className="eyebrow">Price estimate · INR</div>{selectedProduct && <div className="price-estimate-row"><span className="subtle">{selectedProduct.name} · base</span><span>₹{selectedProduct.price.toLocaleString('en-IN')}</span></div>}{hasGarmentDefaults&&<div className="price-estimate-row"><span className="subtle">Fabric · {currentFabric.name}</span><span>₹{currentFabric.price.toLocaleString('en-IN')}</span></div>}{isKandura && !selectedProduct && <div className="price-estimate-row"><span className="subtle">{currentStyle.name} tailoring</span><span>₹{currentStyle.price.toLocaleString('en-IN')}</span></div>}{customSteps.map(item => customSelections[item.id]?.priceAdjustment ? <div className="price-estimate-row" key={item.id}><span className="subtle">{item.title} · {customSelections[item.id].name}</span><span>{customSelections[item.id].priceAdjustment! > 0 ? ' + ' : ' − '}₹{Math.abs(customSelections[item.id].priceAdjustment!).toLocaleString('en-IN')}</span></div> : null)}{hasGarmentDefaults && speed === 'urgent' && <div className="price-estimate-row"><span className="subtle">Priority tailoring estimate</span><span>₹350</span></div>}<div className="price-estimate-total"><span>Total estimate</span><b className="gold">₹{total.toLocaleString('en-IN')}</b></div><p className="subtle">Illustrative pricing. Final price and availability must be confirmed by the atelier.</p></div><div className="customizer-notice"><ShieldCheck size={15} className="gold" />After placing a custom {garmentLabel} order, the design cannot be changed or cancelled. Payment is required before tailoring begins.</div></>}

            {step === deliveryStep && <><h2 className="serif customizer-step-title">Delivery &amp; payment</h2><p className="subtle">Add your details and choose how you’d like to pay. If you choose UPI, we’ll save your order and open a UPI app with the amount for you to confirm.</p><div className="delivery-fields">{[['Full name', name, setName, 'text'], ['Email address', email, setEmail, 'email'], ['Mobile number', phone, setPhone, 'tel'], ['Postal code', postal, setPostal, 'text'], ['City', city, setCity, 'text'], ['Delivery address', address, setAddress, 'text']].map(([label, value, setter, inputType]: any) => <label key={label} className="subtle">{label}<input required type={inputType} value={value} onChange={(event) => setter(event.target.value)} placeholder={label} /></label>)}</div><div className="eyebrow payment-heading">Choose payment option</div><div className="payment-choices">{[{ id: 'upi', title: 'UPI', desc: 'Google Pay, PhonePe, Paytm or any UPI app', Icon: Smartphone }, { id: 'card', title: 'Credit or debit card', desc: 'Visa, Mastercard and RuPay', Icon: CreditCard }, { id: 'cod', title: 'Pay after atelier confirmation', desc: 'We’ll contact you to confirm availability and payment', Icon: Wallet }].map(({ id, title, desc, Icon }) => <button type="button" key={id} className={payment === id ? 'selected' : ''} onClick={() => setPayment(id)}><Icon size={19} className={payment === id ? 'gold' : 'subtle'} /><span><b>{title}</b><small className="subtle">{desc}</small></span><i aria-hidden="true" /></button>)}</div>{payment === 'upi' && paySettings.qr && <div className="payment-qr"><div className="eyebrow">Pay by UPI</div><img src={paySettings.qr} alt="Store UPI QR code" />{paySettings.upiId && <p className="subtle">UPI ID: <b>{paySettings.upiId}</b></p>}</div>}{paySettings.accountNumber && <div className="payment-qr"><div className="eyebrow">Bank transfer details</div><p className="subtle">{paySettings.accountName}<br />{paySettings.bankName}<br />Account: {paySettings.accountNumber}<br />IFSC: {paySettings.ifsc}</p></div>}<div className="payment-security"><LockKeyhole size={14} className="gold" />{payment === 'upi' ? 'Your order will be saved before we open the UPI app. Verify the amount and recipient in the app before confirming.' : 'The atelier will contact you to confirm availability and payment.'}</div></>}

            {step === completionStep && <div className="order-success"><CheckCircle2 size={42} className="gold" /><h2 className="serif">Your design is with us.</h2><p className="subtle">Order <b>{orderId}</b> has been recorded. {payment === 'upi' ? 'Complete payment in your UPI app if it opened; the atelier will verify the payment.' : 'The atelier will contact you to confirm your fit, availability and payment.'}</p><span className="eyebrow">PAYMENT STATUS PENDING VERIFICATION</span>{payment === 'upi' && upiFallback && <div role="status" className="upi-fallback"><div className="eyebrow">UPI app did not open?</div><p className="subtle">Your order is saved. You can pay ₹{total.toLocaleString('en-IN')} using any UPI app with this UPI ID{paySettings.upiId ? <>: <b>{paySettings.upiId}</b></> : '. The shop has not configured a UPI ID yet.'}</p>{paySettings.qr && <><p className="subtle">Or scan the shop’s UPI QR code:</p><img src={paySettings.qr} alt="Arabian Tailors UPI QR code" /></>}</div>}<p className="success-back"><Link className="btn" href="/">Back to collection <ArrowRight size={14} /></Link></p></div>}
          </div>

          <aside className="customizer-summary"><div className="eyebrow">Your running estimate</div><div className="serif customizer-total">₹{total.toLocaleString('en-IN')}</div><div className="subtle">{selectedProduct ? <>{selectedProduct.name} ₹{selectedProduct.price.toLocaleString('en-IN')}<br /></> : null}{hasGarmentDefaults&&<>Fabric ₹{currentFabric.price.toLocaleString('en-IN')}</>}{isKandura && !selectedProduct && <><br />Tailoring ₹{currentStyle.price.toLocaleString('en-IN')}</>}{hasGarmentDefaults && speed === 'urgent' && <><br />Priority ₹350</>}</div><div className="summary-separator"><Scissors size={14} className="gold" />Made to your choices</div><p className="subtle">Estimate only. Final price and availability confirmed by the atelier.</p></aside>
        </section>

        {step < completionStep && <div className="customizer-nav"><button className="btn btn-outline" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}><ArrowLeft size={14} /> Back</button>{step === deliveryStep ? <button className="btn" onClick={next} disabled={!name || !email || !phone || !address || !city || !postal || submitting}>{submitting ? 'Saving order…' : <>Place order · ₹{total.toLocaleString('en-IN')} <ArrowRight size={14} /></>}</button> : <button className="btn" onClick={next} disabled={requiredSelectionMissing || missingCustomMeasurements}>{step === 0 && selectedProduct ? 'Order Now' : step === reviewStep ? 'Continue to payment' : 'Continue'} <ArrowRight size={14} /></button>}</div>}
      </div>

      <footer className="footer"><div className="wrap customizer-footer"><span>ARABIAN TAILORS · INDIA</span><span>Elegance, Tailored for You</span></div></footer>
    </main>
  );
}
