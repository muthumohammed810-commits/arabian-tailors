import { list, get, put, del } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { products as catalog } from '@/lib/catalog';
import { addDefaultCustomization } from '@/lib/customization-defaults';
import { isSameOrderIntent } from '@/lib/payment-order-idempotency';
import { getCustomerOrderPaymentFields } from '@/lib/upi-order-policy';
import { createCustomReferenceOrderFields, customerPaymentAmount, CUSTOM_REFERENCE_ORDER_TYPE, updateCustomReferenceFinalPrice } from '@/lib/custom-reference-order';
import { isGarmentReferencePhotoForOrder, referencePhotoFromDesign } from '@/lib/abaya-customization';
import { calculateConfiguredSubtotal, calculateOrderTotal, DELIVERY_PICKUP_ORIGIN, isValidFlatDeliveryFee, matchesOrderBreakdown, publicDeliveryRules, quoteFlatDelivery, resolveFlatDeliveryFee, withDeliveryRestrictionMode, withFlatDeliveryFee } from '@/lib/delivery-pricing';
import { isOfficialIndiaPostPinSource, isValidKeralaPinDirectory } from '@/lib/delivery-rule-csv.mjs';
import { createWhatsAppNotificationStates, dispatchWhatsAppNotification, getWhatsAppConfiguration, isE164Phone, sendWhatsAppTemplate, templateParametersForOrder, WHATSAPP_NOTIFICATION_CHANNELS, WHATSAPP_NOTIFICATION_STATES } from '@/lib/whatsapp-order-notifications.mjs';
import { notifyAdminDevicesOfOrder } from '@/lib/admin-push-server';
import { persistOrderThenNotifyAdminPush } from '@/lib/admin-push-notifications.mjs';
import { hasRequiredMeasurementValues, isValidMeasurementFields, isValidMeasurementGuideList, isValidMeasurementGuideVideo, publishedMeasurementFields, publishedMeasurementGuideVideo, publishedMeasurementGuides } from '@/lib/measurement-guides.mjs';
import { canReviewPaymentStatus, initialCustomerOrderStatus, isUntrackedDeliveryStatusTransition, paidOrderCustomerEntries, summarizeOrders, updateDeliveryStatus } from '@/lib/order-admin.mjs';
import { normalizePaymentStatus, paymentAuditFields, recordPaymentConfirmation } from '@/lib/order-admin.mjs';
import { listAllBlobPages } from '@/lib/blob-pagination.mjs';
import { publicStoreSettings } from '@/lib/public-store-settings.mjs';
import { findLegacyAbayaFallback, hasManagedAbayaCatalog } from '@/lib/abaya-product-selection.mjs';
import { projectPublicStoreProduct } from '@/lib/public-store-product.mjs';
import { buildAdminStoreResponse } from '@/lib/admin-store-response.mjs';
import { validateAbayaModelCodes } from '@/lib/abaya-model-management.mjs';
import { findRecordAcrossCatalogs, getUniqueCatalogRecordIds, isAbayaRecord, keepLegacyAbayaAsProduct, moveLegacyAbayaToManagement, replaceCatalogCollection, splitProductRecords } from '@/lib/abaya-data-separation.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const STORE_FILE = 'arabian-tailors/store.json';
const ORDER_PREFIX = 'arabian-tailors/orders/';
const ADMIN_ORDER_BASE_URL = 'https://arabian-tailors.vercel.app';
const statuses = ['New', 'In production', 'Ready to ship', 'Delivered', 'Cancelled'] as const;
type Store = { products: any[]; abayaProducts: any[]; settings: Record<string, any>; abayaCatalogManaged?: boolean };
const defaultStore = (): Store => ({ products: catalog.map(p => ({ ...p, stock: 0, available: true, stitchingType: '', options: [] })), abayaProducts: [], settings: {}, abayaCatalogManaged: false });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const validText = (value: unknown, max = 500) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function logOrderWriteFailure(orderId: string, error: unknown) {
  const details = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown } : {};
  const safeLabel = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
  const status = Number(details.statusCode ?? details.status);
  console.error('[store-data] Vercel Blob order write failed', {
    orderId,
    errorName: safeLabel(details.name),
    errorCode: safeLabel(details.code),
    statusCode: Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
  });
}
function validModelCustomization(value: unknown, validateOption: (option: any, allowModelSettings: boolean) => boolean) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const categories = value as Record<string, any>;
  return (['colors', 'fabrics', 'stitching'] as const).every((key) => {
    const category = categories[key];
    return category === undefined || (category && typeof category === 'object' && !Array.isArray(category)
      && (category.visible === undefined || typeof category.visible === 'boolean')
      && (category.required === undefined || typeof category.required === 'boolean')
      && Array.isArray(category.options)
      && category.options.every((option: any) => validateOption(option, false)));
  }) && (categories.steps === undefined || Array.isArray(categories.steps) && (() => {
    const stepIds = new Set<string>();
    return categories.steps.every((step: any) => step && typeof step === 'object' && !Array.isArray(step)
      && validText(step.id, 100) && !stepIds.has(step.id) && (stepIds.add(step.id), true)
      && validText(step.title, 120)
      && (step.description === undefined || typeof step.description === 'string' && step.description.length <= 500)
      && (step.visible === undefined || typeof step.visible === 'boolean')
      && (step.required === undefined || typeof step.required === 'boolean')
      && Array.isArray(step.options) && step.options.every((option: any) => validateOption(option, false)));
  })());
}
function validCustomizationSteps(value: unknown) {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((step: any) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || !validText(step.id, 100) || ids.has(step.id) || !validText(step.title, 120) || (step.description !== undefined && (typeof step.description !== 'string' || step.description.length > 500)) || (step.required !== undefined && typeof step.required !== 'boolean') || (step.available !== undefined && typeof step.available !== 'boolean') || !Array.isArray(step.options)) return false;
    ids.add(step.id);
    const optionIds = new Set<string>();
    const validOption = (option: any, allowModelSettings: boolean): boolean => {
      if (!option || typeof option !== 'object' || Array.isArray(option) || !validText(option.id, 100) || optionIds.has(option.id) || !validText(option.name, 160) || (option.modelCode !== undefined && (typeof option.modelCode !== 'string' || option.modelCode.length > 32)) || (option.description !== undefined && (typeof option.description !== 'string' || option.description.length > 500)) || (option.image !== undefined && (typeof option.image !== 'string' || option.image.length > 2000)) || (option.images !== undefined && (!Array.isArray(option.images) || !option.images.every((image: unknown) => typeof image === 'string' && image.length <= 2000))) || (option.priceAdjustment !== undefined && (!Number.isFinite(option.priceAdjustment) || Math.abs(option.priceAdjustment) > 1_000_000)) || (option.basePrice !== undefined && (!Number.isFinite(option.basePrice) || option.basePrice < 0 || option.basePrice > 1_000_000)) || (option.stock !== undefined && (!Number.isInteger(option.stock) || option.stock < 0 || option.stock > 1_000_000)) || (option.available !== undefined && typeof option.available !== 'boolean') || (option.visible !== undefined && typeof option.visible !== 'boolean')) return false;
      optionIds.add(option.id);
      if (option.swatch !== undefined && (typeof option.swatch !== 'string' || !(/^#[0-9a-f]{6}$/i.test(option.swatch) || /^rgb\(\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*\)$/i.test(option.swatch)))) return false;
      return !allowModelSettings || validModelCustomization(option.modelCustomization, validOption);
    };
    return step.options.every((option: any) => validOption(option, true));
  });
}
function validProductList(value: unknown) {
  return Array.isArray(value) && value.length <= 500
    && value.every((p: any) => validText(p.id, 100) && validText(p.name, 160) && validText(p.category, 80)
      && (p.catalogOwner === undefined || p.catalogOwner === 'products')
      && (p.abayaCategory === undefined || typeof p.abayaCategory === 'string' && p.abayaCategory.length <= 80)
      && (p.description === undefined || typeof p.description === 'string' && p.description.length <= 2000)
      && Number.isFinite(p.price) && p.price >= 0 && Number.isFinite(p.stock) && p.stock >= 0
      && (p.available === undefined || typeof p.available === 'boolean')
      && (p.options === undefined || Array.isArray(p.options) && p.options.length <= 50 && p.options.every((o: any) => typeof o === 'string' && o.length <= 160))
      && validCustomizationSteps(p.customizationSteps) && isValidMeasurementFields(p.measurements, p.id)
      && (p.measurementsEnabled === undefined || typeof p.measurementsEnabled === 'boolean')
      && (p.measurementGuideVideo === undefined || isValidMeasurementGuideVideo(p.measurementGuideVideo, p.id))
      && (p.measurementGuides === undefined || isValidMeasurementGuideList(p.measurementGuides, p.id))
      && (p.stitchingType === undefined || typeof p.stitchingType === 'string' && p.stitchingType.length <= 160)
      && (p.image === undefined || typeof p.image === 'string' && p.image.length <= 2000)
      && (p.images === undefined || Array.isArray(p.images) && p.images.every((image: any) => typeof image === 'string' && image.length <= 2000)))
    && new Set(value.map((p: any) => p.id)).size === value.length;
}
async function readBlob(pathname: string) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const blob = blobs.find(item => item.pathname === pathname);
  if (!blob) return null;
  const result = await get(blob.url, { access: 'private', useCache: false });
  return result?.statusCode === 200 ? await new Response(result.stream).json() : null;
}
async function readStore(): Promise<Store> {
  const stored = await readBlob(STORE_FILE);
  if (!stored || !Array.isArray(stored.products)) return defaultStore();
  return { products: stored.products, abayaProducts: Array.isArray(stored.abayaProducts) ? stored.abayaProducts : [], settings: stored.settings && typeof stored.settings === 'object' ? stored.settings : {}, abayaCatalogManaged: stored.abayaCatalogManaged === true };
}
function storeProductLocation(store: Store, productId: string) {
  const product = findRecordAcrossCatalogs(store.products, store.abayaProducts, productId);
  if (!product) return null;
  return { product, collection: store.abayaProducts.includes(product) ? 'abayaProducts' as const : 'products' as const };
}
async function listOrders() {
  const blobs = await listAllBlobPages((options) => list(options), { prefix: ORDER_PREFIX, limit: 1000 });
  return (await Promise.all(blobs.map(async blob => {
    const result = await get(blob.url, { access: 'private', useCache: false });
    return result?.statusCode === 200 ? await new Response(result.stream).json() : null;
  }))).filter(Boolean);
}
async function saveStore(store: Store) {
  await put(STORE_FILE, JSON.stringify(store), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
async function saveOrder(order: any) {
  await put(`${ORDER_PREFIX}${order.id}.json`, JSON.stringify(order), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
function safeNotificationLog(orderId: string, channel: string, error: unknown) {
  const details = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; statusCode?: unknown } : {};
  const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
  const statusCode = Number(details.statusCode);
  console.error('[whatsapp-notifications] Order notification processing failed', {
    orderId, channel, errorName: safe(details.name), errorCode: safe(details.code),
    ...(Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? { statusCode } : {}),
  });
}
async function acquireWhatsAppClaim(orderId: string, channel: string) {
  const pathname = `arabian-tailors/whatsapp-claims/${orderId}-${channel}.json`;
  try {
    await put(pathname, JSON.stringify({ claimedAt: new Date().toISOString() }), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    return true;
  } catch (error) {
    const details = error && typeof error === 'object' ? error as { code?: unknown; statusCode?: unknown } : {};
    if (details.statusCode === 409 || details.statusCode === 412 || details.code === 'BLOB_ALREADY_EXISTS') return false;
    throw error;
  }
}
async function releaseWhatsAppClaim(orderId: string, channel: string) {
  const pathname = `arabian-tailors/whatsapp-claims/${orderId}-${channel}.json`;
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const claim = blobs.find((item) => item.pathname === pathname);
  if (claim) await del(claim.url);
}
async function saveWhatsAppNotificationOrder(next: any) {
  const stored = await readBlob(`${ORDER_PREFIX}${next.id}.json`);
  if (!stored) throw new Error('Order disappeared while recording WhatsApp notification state.');
  await saveOrder({
    ...stored,
    whatsappConsent: next.whatsappConsent ?? stored.whatsappConsent,
    whatsappNotifications: next.whatsappNotifications,
  });
}
async function runWhatsAppNotification(order: any, channel: 'customer' | 'owner', explicitRetry = false) {
  const config = getWhatsAppConfiguration(process.env, channel);
  const customerConsented = order.whatsappConsent?.customerUpdates === true;
  const recipient = channel === 'owner'
    ? process.env.WHATSAPP_OWNER_PHONE_NUMBER
    : customerConsented ? order.delivery?.phone : null;
  const adminLink = new URL(`/admin?orderId=${encodeURIComponent(order.id)}`, ADMIN_ORDER_BASE_URL).toString();
  return dispatchWhatsAppNotification({
    order, channel, recipient, config,
    parameters: templateParametersForOrder(order, channel, adminLink),
    explicitRetry, saveOrder: saveWhatsAppNotificationOrder,
    loadOrder: (id: string) => readBlob(`${ORDER_PREFIX}${id}.json`),
    acquireClaim: acquireWhatsAppClaim,
    releaseClaim: releaseWhatsAppClaim,
    send: sendWhatsAppTemplate,
  });
}
async function notifyNewOrder(orderId: string) {
  for (const channel of WHATSAPP_NOTIFICATION_CHANNELS as Array<'customer' | 'owner'>) {
    try {
      const stored = await readBlob(`${ORDER_PREFIX}${orderId}.json`);
      if (stored) await runWhatsAppNotification(stored, channel);
    } catch (error) {
      safeNotificationLog(orderId, channel, error);
    }
  }
}
function safePayment(order: any) {
  return {
    id: order.id, customer: order.customer, initials: order.initials, product: order.product,
    ...(order.productId ? { productId: order.productId } : {}),
    ...(order.productName ? { productName: order.productName } : {}),
    ...(order.productImage ? { productImage: order.productImage } : {}),
    ...(Number.isFinite(order.basePrice) ? { basePrice: order.basePrice } : {}),
    orderType: order.orderType === CUSTOM_REFERENCE_ORDER_TYPE ? CUSTOM_REFERENCE_ORDER_TYPE : 'standard',
    ...(order.orderType === CUSTOM_REFERENCE_ORDER_TYPE ? {
      estimatedTotal: Number.isFinite(order.estimatedTotal) ? order.estimatedTotal : order.total,
      advanceAmount: 500,
      advanceStatus: normalizePaymentStatus(order.statusPayment),
      finalPrice: Number.isFinite(order.finalPrice) ? order.finalPrice : null,
      finalPriceConfirmed: order.finalPriceConfirmed === true,
      remainingBalance: Number.isFinite(order.remainingBalance) ? order.remainingBalance : null,
    } : {}),
    date: order.date, total: order.total, subtotal: order.subtotal, deliveryFee: order.deliveryFee, discount: order.discount, status: order.status, tone: order.tone,
    ...paymentAuditFields(order),
    ...(typeof order.deliveredAt === 'string' ? { deliveredAt: order.deliveredAt } : { deliveredAt: null }),
    ...(Array.isArray(order.deliveryHistory) ? { deliveryHistory: order.deliveryHistory.filter((entry: any) => entry && typeof entry.status === 'string' && typeof entry.at === 'string').map((entry: any) => ({ status: entry.status, at: entry.at, ...(typeof entry.admin === 'string' ? { admin: entry.admin } : {}) })) } : {}),
    delivery: order.delivery, design: order.design,
    ...(order.whatsappConsent && typeof order.whatsappConsent.customerUpdates === 'boolean' ? { whatsappConsent: { customerUpdates: order.whatsappConsent.customerUpdates, ...(typeof order.whatsappConsent.capturedAt === 'string' ? { capturedAt: order.whatsappConsent.capturedAt } : {}) } } : {}),
    ...(order.whatsappNotifications && typeof order.whatsappNotifications === 'object' ? { whatsappNotifications: Object.fromEntries(WHATSAPP_NOTIFICATION_CHANNELS.map((channel) => {
      const record = order.whatsappNotifications[channel];
      if (!record || !WHATSAPP_NOTIFICATION_STATES.includes(record.status)) return [channel, { status: 'pending', attempts: 0 }];
      return [channel, {
        status: record.status,
        attempts: Number.isSafeInteger(record.attempts) ? record.attempts : 0,
        ...(typeof record.lastAttemptAt === 'string' ? { lastAttemptAt: record.lastAttemptAt } : {}),
        ...(typeof record.sentAt === 'string' ? { sentAt: record.sentAt } : {}),
        ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
        ...(Number.isSafeInteger(record.httpStatus) ? { httpStatus: record.httpStatus } : {}),
        ...(typeof record.errorCode === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(record.errorCode) ? { errorCode: record.errorCode } : {}),
      }];
    })) } : {}),
    paymentMethod: ['upi','card','cod'].includes(order.paymentMethod) ? order.paymentMethod : 'Not provided',
    statusPayment: normalizePaymentStatus(order.statusPayment),
  };
}
function validEmail(value: unknown): value is string { return typeof value === 'string' && validText(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validateSettings(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'flatDeliveryFee') {
      if (!isValidFlatDeliveryFee(item)) return false;
      continue;
    }
    if (key === 'restrictDeliveryToConfiguredRules') {
      if (typeof item !== 'boolean') return false;
      continue;
    }
    if (key === 'deliveryPickupOrigin') {
      if (item !== DELIVERY_PICKUP_ORIGIN) return false;
      continue;
    }
    if (key === 'deliveryRules') {
      if (!Array.isArray(item) || item.length > 10_000) return false;
      const ids = new Set<string>();
      const prefixes = new Set<string>();
      if (!item.every((rule: any) => rule && typeof rule === 'object' && !Array.isArray(rule)
        && validText(rule.id, 100) && !ids.has(rule.id) && (ids.add(rule.id), true)
        && (rule.area === undefined || validText(rule.area, 120))
        && typeof rule.prefix === 'string' && /^\d{3,6}$/.test(rule.prefix) && !prefixes.has(rule.prefix) && (prefixes.add(rule.prefix), true)
        && Number.isFinite(rule.fee) && rule.fee >= 0 && rule.fee <= 1_000_000
        && (rule.pinSource === undefined || validText(rule.pinSource, 500))
        && (rule.feeSource === undefined || validText(rule.feeSource, 500))
        && (rule.imported === undefined || typeof rule.imported === 'boolean')
        && (rule.rateProvider === undefined || rule.rateProvider === 'DTDC')
        && (rule.rateVerified === undefined || typeof rule.rateVerified === 'boolean')
        && (rule.rateProvider !== 'DTDC' || validText(rule.feeSource, 500))
        && (rule.imported !== true || (Number.isInteger(rule.fee) && validText(rule.area, 120) && validText(rule.pinSource, 500) && isOfficialIndiaPostPinSource(rule.pinSource) && validText(rule.feeSource, 500)))
        && typeof rule.enabled === 'boolean')) return false;
      continue;
    }
    if (key === 'keralaPinDirectory') {
      if (!isValidKeralaPinDirectory(item)) return false;
      continue;
    }
    if (!['storeName','gold','background','heroImage','upiId','accountName','accountNumber','ifsc','bankName','qr'].includes(key) || typeof item !== 'string' || item.length > 2_000_000) return false;
  }
  return true;
}
function isVercelBlobUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'blob.vercel-storage.com' || url.hostname.endsWith('.blob.vercel-storage.com'));
  } catch { return false; }
}
function logAdminWriteFailure(resource: unknown, error: unknown) {
  const details = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown } : {};
  const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
  const status = Number(details.statusCode ?? details.status);
  console.error('[store-data] Admin write failed', {
    resource: ['products', 'productPhotos', 'optionPhotos', 'settings', 'order', 'customer'].includes(String(resource)) ? String(resource) : 'unknown',
    errorName: safe(details.name), errorCode: safe(details.code),
    statusCode: Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
  });
}
function optionPhotos(option: any) {
  const images = [...new Set([...(Array.isArray(option.images) ? option.images : []), ...(typeof option.image === 'string' && option.image ? [option.image] : [])])];
  return images;
}
function setOptionPhotos(option: any, images: string[]) {
  option.images = images;
  option.image = images[0] || '';
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'Shared storage is not connected.' }, 503);
  try {
    const store = await readStore();
    const migratedCustomization = addDefaultCustomization(store);
    const migratedAbayaCustomization = addDefaultCustomization({ products: store.abayaProducts });
    if (await isAdminAuthenticated()) {
      if (migratedCustomization || migratedAbayaCustomization) await saveStore(store);
      const orders = (await listOrders()).map(safePayment);
      const customers = paidOrderCustomerEntries(orders);
      const separated = splitProductRecords(store.products);
      return json(buildAdminStoreResponse({ ...store, products: separated.products, legacyAbayaProducts: separated.legacyAbayaProducts }, orders, customers, summarizeOrders(orders)));
    }
    const separated = splitProductRecords(store.products);
    const abayaCatalogManaged = hasManagedAbayaCatalog([...store.abayaProducts, ...separated.legacyAbayaProducts], store.abayaCatalogManaged);
    const allCatalogRecords = [...store.products, ...store.abayaProducts];
    const uniqueCatalogIds = getUniqueCatalogRecordIds(allCatalogRecords);
    const hasUniqueCatalogIdentity = (product: any) => uniqueCatalogIds.has(product.id);
    const publicProducts = separated.products.filter(p => p.available !== false && hasUniqueCatalogIdentity(p)).map((product: any) => projectPublicStoreProduct({
      ...product,
      ...(/^(kandura|abaya)$/i.test(String(product.category || '').trim()) && Array.isArray(product.measurements) ? { measurements: publishedMeasurementFields(product.measurements, product.id, product.measurementsEnabled !== false).filter((field: any) => !/^abaya$/i.test(String(product.category || '').trim()) || field.available !== false) } : {}),
      ...(/^(kandura|abaya)$/i.test(String(product.category || '').trim()) && product.measurementGuideVideo ? { measurementGuideVideo: publishedMeasurementGuideVideo(product.measurementGuideVideo, product.id, product.measurementsEnabled !== false) } : {}),
      ...(/^(kandura|abaya)$/i.test(String(product.category || '').trim()) && Array.isArray(product.measurementGuides) ? { measurementGuides: publishedMeasurementGuides(product.measurementGuides, product.id) } : {}),
    }, { managedAbayaCatalog: isAbayaRecord(product) ? false : abayaCatalogManaged })).filter(Boolean);
    const publicAbayaProducts = store.abayaProducts.filter(p => p.available !== false && hasUniqueCatalogIdentity(p)).map((product: any) => projectPublicStoreProduct({
      ...product,
      ...(Array.isArray(product.measurements) ? { measurements: publishedMeasurementFields(product.measurements, product.id, product.measurementsEnabled !== false).filter((field: any) => field.available !== false) } : {}),
      ...(product.measurementGuideVideo ? { measurementGuideVideo: publishedMeasurementGuideVideo(product.measurementGuideVideo, product.id, product.measurementsEnabled !== false) } : {}),
      ...(Array.isArray(product.measurementGuides) ? { measurementGuides: publishedMeasurementGuides(product.measurementGuides, product.id) } : {}),
    }, { managedAbayaCatalog: true })).filter(Boolean);
    let publicLegacyAbayaProducts = separated.legacyAbayaProducts.filter(p => p.available !== false && hasUniqueCatalogIdentity(p)).map((product: any) => projectPublicStoreProduct(product, { managedAbayaCatalog: true })).filter(Boolean);
    // Keep pre-existing legacy choices available in the Abaya configurator, never in Products & Services.
    if (!abayaCatalogManaged && publicLegacyAbayaProducts.length === 0) {
      const legacyStore = { products: catalog.filter(product => product.category.toLowerCase() === 'abaya').map(product => ({ ...product, stock: 0, available: true, stitchingType: '', options: [] })) };
      addDefaultCustomization(legacyStore);
      publicLegacyAbayaProducts = legacyStore.products.map((product) => projectPublicStoreProduct(product)).filter(Boolean);
    }
    const storefrontSettings = publicStoreSettings(store.settings);
    return json({ products: publicProducts, abayaProducts: publicAbayaProducts, legacyAbayaProducts: publicLegacyAbayaProducts, abayaCatalogManaged, settings: { ...storefrontSettings, deliveryRules: publicDeliveryRules(Array.isArray(store.settings.deliveryRules) ? store.settings.deliveryRules : []) } });
  } catch { return json({ error: 'Could not load store data.' }, 500); }
}

export async function PUT(request: Request) {
  if (!await isAdminAuthenticated()) return json({ error: 'Sign in required.' }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'Shared storage is not connected.' }, 503);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
  try {
    if (body.resource === 'settings') {
      if (body.action === 'setFlatDeliveryFee') {
        if (!isValidFlatDeliveryFee(body.flatDeliveryFee)) return json({ error: 'Enter a valid non-negative flat delivery fee with up to two decimal places.' }, 400);
        const store = await readStore();
        const settings = withFlatDeliveryFee(store.settings, body.flatDeliveryFee);
        if (!settings) return json({ error: 'Enter a valid non-negative flat delivery fee with up to two decimal places.' }, 400);
        store.settings = settings;
        await saveStore(store);
        return json({ ok: true, settings: store.settings });
      }
      if (body.action === 'setDeliveryRestrictionMode') {
        const store = await readStore();
        const settings = withDeliveryRestrictionMode(store.settings, body.restrictDeliveryToConfiguredRules);
        if (!settings) return json({ error: 'Choose whether delivery should be restricted to configured PIN rules.' }, 400);
        store.settings = settings;
        await saveStore(store);
        return json({ ok: true, settings: store.settings });
      }
      if (!validateSettings(body.settings)) return json({ error: 'Invalid store settings.' }, 400);
      const store = await readStore(); store.settings = body.settings; await saveStore(store); return json({ ok: true, settings: store.settings });
    }
    if (body.resource === 'products') {
      if (!validProductList(body.products) || body.products.some((product: any) => isAbayaRecord(product) && product.catalogOwner !== 'products')) return json({ error: 'Invalid Product Management records. Abaya Management records require the Abaya collection.' }, 400);
      const store = await readStore();
      const replacement = replaceCatalogCollection(store.products, store.abayaProducts, 'products', body.products);
      if (!replacement.ok) return json({ error: replacement.code === 'UNCLASSIFIED_ABAYA' ? 'Resolve the unclassified legacy Abaya record before reusing its product ID.' : 'Product IDs must be unique across management collections.' }, 409);
      const legacyIds = new Set(splitProductRecords(store.products).legacyAbayaProducts.map((product: any) => product.id));
      if (body.products.some((product: any) => legacyIds.has(product.id))) return json({ error: 'Resolve the unclassified legacy Abaya record before reusing its product ID.' }, 409);
      const abayaModelCodes = validateAbayaModelCodes(body.products, splitProductRecords(store.products).products);
      if (!abayaModelCodes.ok) return json({ error: abayaModelCodes.error, code: abayaModelCodes.code }, 400);
      store.products = replacement.products;
      await saveStore(store); return json({ ok: true, products: splitProductRecords(store.products).products });
    }
    if (body.resource === 'abayaCatalog') {
      if (!validProductList(body.products) || !body.products.every((product: any) => isAbayaRecord(product) && product.catalogOwner === undefined)) return json({ error: 'Invalid Abaya Management records.' }, 400);
      const store = await readStore();
      const replacement = replaceCatalogCollection(store.products, store.abayaProducts, 'abaya', body.products);
      if (!replacement.ok) return json({ error: 'Abaya record IDs must be unique across management collections.' }, 409);
      const abayaModelCodes = validateAbayaModelCodes(body.products, store.abayaProducts);
      if (!abayaModelCodes.ok) return json({ error: abayaModelCodes.error, code: abayaModelCodes.code }, 400);
      store.abayaProducts = replacement.abayaProducts;
      if (store.abayaProducts.length > 0) store.abayaCatalogManaged = true;
      await saveStore(store); return json({ ok: true, abayaProducts: store.abayaProducts });
    }
    if (body.resource === 'abayaMigration') {
      if (!validText(body.id, 100) || body.confirmed !== true || !['moveToAbayaManagement', 'keepAsProduct'].includes(body.action)) return json({ error: 'Confirm the legacy Abaya classification action.' }, 400);
      const store = await readStore();
      if (body.action === 'moveToAbayaManagement') {
        const moved = moveLegacyAbayaToManagement(store.products, store.abayaProducts, body.id);
        if (!moved.ok) return json({ error: moved.code === 'PRODUCT_ID_CONFLICT' ? 'A matching record already exists in another management collection.' : 'Legacy Abaya record not found.' }, moved.code === 'PRODUCT_ID_CONFLICT' ? 409 : 404);
        store.products = moved.products;
        store.abayaProducts = moved.abayaProducts;
        store.abayaCatalogManaged = true;
      } else {
        if (store.abayaProducts.some((product: any) => product.id === body.id)) return json({ error: 'A matching Abaya record already exists.' }, 409);
        const kept = keepLegacyAbayaAsProduct(store.products, body.id);
        if (!kept.ok) return json({ error: kept.code === 'PRODUCT_ID_CONFLICT' ? 'The legacy Abaya ID is ambiguous and cannot be classified safely.' : 'Legacy Abaya record not found.' }, kept.code === 'PRODUCT_ID_CONFLICT' ? 409 : 404);
        store.products = kept.products;
        store.abayaCatalogManaged = true;
      }
      await saveStore(store);
      const separated = splitProductRecords(store.products);
      return json({ ok: true, products: separated.products, legacyAbayaProducts: separated.legacyAbayaProducts, abayaProducts: store.abayaProducts });
    }
    if (body.resource === 'measurementGuides') {
      if (body.action !== 'save' || !validText(body.productId, 100) || !isValidMeasurementGuideList(body.guides, body.productId)) return json({ error: 'Invalid product measurement guide configuration.' }, 400);
      const store = await readStore();
      const product = storeProductLocation(store, body.productId)?.product;
      if (!product || !/^(kandura|abaya)$/i.test(String(product.category || '').trim())) return json({ error: 'Kandura or Abaya product not found.' }, 404);
      product.measurementGuides = body.guides;
      await saveStore(store);
      return json({ ok: true, productId: product.id, measurementGuides: product.measurementGuides });
    }
    if (body.resource === 'measurements') {
      const hasFields = Object.prototype.hasOwnProperty.call(body, 'measurements');
      const hasVideo = Object.prototype.hasOwnProperty.call(body, 'measurementGuideVideo');
      if (body.action !== 'save' || !validText(body.productId, 100) || (!hasFields && !hasVideo)
        || (hasFields && !isValidMeasurementFields(body.measurements, body.productId))
        || (hasVideo && !isValidMeasurementGuideVideo(body.measurementGuideVideo, body.productId))) {
        return json({ error: 'Invalid product measurement media configuration.' }, 400);
      }
      const store = await readStore();
      const product = storeProductLocation(store, body.productId)?.product;
      if (!product || !/^(kandura|abaya)$/i.test(String(product.category || '').trim())) return json({ error: 'Kandura or Abaya product not found.' }, 404);
      if (hasFields) product.measurements = body.measurements;
      if (hasVideo) product.measurementGuideVideo = body.measurementGuideVideo || undefined;
      await saveStore(store);
      return json({ ok: true, productId: product.id, measurements: product.measurements || [], measurementGuideVideo: product.measurementGuideVideo || null });
    }
    if (body.resource === 'productPhotos' || body.resource === 'optionPhotos') {
      if (!validText(body.productId, 100) || !isVercelBlobUrl(body.url) || !['add', 'replace'].includes(body.action)) return json({ error: 'Invalid image update.' }, 400);
      if (body.action === 'replace' && (!Number.isInteger(body.index) || body.index < 0)) return json({ error: 'Invalid photo position.' }, 400);
      const store = await readStore();
      const product = storeProductLocation(store, body.productId)?.product;
      if (!product) return json({ error: 'Product not found. Save the product before uploading photos.' }, 404);
      let target: any;
      if (body.resource === 'productPhotos') {
        target = product;
      } else if (validText(body.modelId, 100)) {
        const model = (product.customizationSteps || []).flatMap((step: any) => step.options || []).find((option: any) => option.id === body.modelId);
        if (body.category !== undefined) {
          if (!['colors', 'fabrics', 'stitching'].includes(body.category)) return json({ error: 'Invalid model category.' }, 400);
          target = model?.modelCustomization?.[body.category]?.options?.find((option: any) => option.id === body.optionId);
        } else if (validText(body.modelStepId, 100)) {
          target = model?.modelCustomization?.steps?.find((step: any) => step.id === body.modelStepId)?.options?.find((option: any) => option.id === body.optionId);
        }
      } else if (validText(body.stepId, 100) && validText(body.optionId, 100)) {
        const step = (product.customizationSteps || []).find((item: any) => item.id === body.stepId);
        target = step?.options?.find((option: any) => option.id === body.optionId);
      }
      if (!target) return json({ error: 'The selected product option was not found. Save it before uploading photos.' }, 404);
      const images = optionPhotos(target);
      if (body.action === 'add') {
        if (!images.includes(body.url)) images.push(body.url);
      } else {
        if (body.index >= images.length) return json({ error: 'Photo position no longer exists. Refresh and try again.' }, 409);
        images[body.index] = body.url;
      }
      setOptionPhotos(target, images);
      await saveStore(store);
      return json({ ok: true, productId: product.id, image: target.image || '', images });
    }
    if (body.resource === 'order') {
      if (!validText(body.id, 100)) return json({ error: 'Invalid order ID.' }, 400);
      const order = await readBlob(`${ORDER_PREFIX}${body.id}.json`);
      if (!order) return json({ error: 'Order not found.' }, 404);
      if (body.action === 'retryWhatsApp') {
        if (!['customer', 'owner'].includes(body.channel)) return json({ error: 'Choose a valid WhatsApp notification.' }, 400);
        const channel = body.channel as 'customer' | 'owner';
        const current = order.whatsappNotifications?.[channel]?.status || 'pending';
        if (!['pending', 'failed', 'not_configured'].includes(current)) return json({ error: 'This notification cannot be retried automatically because it is already sent or its delivery outcome is uncertain.' }, 409);
        if (channel === 'customer' && order.whatsappConsent?.customerUpdates !== true) return json({ error: 'The customer did not opt in to WhatsApp order updates.' }, 409);
        let result;
        try { result = await runWhatsAppNotification(order, channel, true); }
        catch (error) { safeNotificationLog(order.id, channel, error); return json({ error: 'The notification could not be retried safely. Check its status before trying again.' }, 503); }
        const updated = await readBlob(`${ORDER_PREFIX}${order.id}.json`);
        if (!updated) return json({ error: 'The order could not be reloaded after notification processing.' }, 500);
        if (result.locked) return json({ error: 'This notification is already being processed. Refresh the order status shortly.' }, 409);
        return json({ ok: true, order: safePayment(updated) });
      }
      if (body.action === 'delete') {
        if (String(body.confirmation || '') !== body.id) return json({ error: 'Type the order ID to confirm deletion.' }, 400);
        const { blobs } = await list({ prefix: `${ORDER_PREFIX}${body.id}.json`, limit: 1 });
        const blob = blobs.find(item => item.pathname === `${ORDER_PREFIX}${body.id}.json`);
        if (blob) await del(blob.url);
        return json({ ok: true });
      }
      if (body.action === 'update') {
        const updates = body.updates;
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return json({ error: 'Invalid order updates.' }, 400);
        if (updates.status !== undefined && !statuses.includes(updates.status)) return json({ error: 'Invalid order status.' }, 400);
        if (updates.status !== undefined && isUntrackedDeliveryStatusTransition(order.status, updates.status)) return json({ error: 'Use the delivery confirmation or correction controls so the delivery timestamp and history are recorded.' }, 409);
        if (updates.customer !== undefined && !validText(updates.customer, 160)) return json({ error: 'Invalid customer name.' }, 400);
        if (order.orderType === CUSTOM_REFERENCE_ORDER_TYPE && updates.total !== undefined) return json({ error: 'Use the reviewed final-price confirmation field for this custom order.' }, 400);
        if (order.orderType !== CUSTOM_REFERENCE_ORDER_TYPE && (updates.finalPrice !== undefined || updates.finalPriceConfirmed !== undefined)) return json({ error: 'Final custom-order pricing is not available for this order.' }, 400);
        if (updates.total !== undefined && (!Number.isFinite(updates.total) || updates.total < 0)) return json({ error: 'Invalid order total.' }, 400);
        if (updates.delivery !== undefined) { const d = updates.delivery; if (!d || typeof d !== 'object' || !validEmail(d.email) || !validText(d.phone, 40) || !validText(d.address, 500) || !validText(d.city, 100) || !validText(d.postal, 20)) return json({ error: 'Invalid delivery details.' }, 400); }
        if (['paymentAmount', 'paidAt', 'paymentDate'].some((field) => Object.prototype.hasOwnProperty.call(updates, field))) return json({ error: 'Payment amount and verification date are recorded by the server when payment is reviewed.' }, 400);
        if (updates.statusPayment !== undefined && !canReviewPaymentStatus(order.statusPayment || 'Pending verification', updates.statusPayment)) return json({ error: 'Payment status can only be reviewed from pending, unpaid, or pending verification states.' }, 400);
        const next = { ...order, ...updates }; delete next.payment;
        if (updates.statusPayment === 'Paid') {
          const confirmedPayment = recordPaymentConfirmation(order, customerPaymentAmount(order), new Date().toISOString());
          if (!confirmedPayment) return json({ error: 'The server could not determine a safe amount to record for this payment.' }, 409);
          next.paymentAmount = confirmedPayment.paymentAmount;
          next.paidAt = confirmedPayment.paidAt;
          next.paymentDate = confirmedPayment.paymentDate;
        }
        if (order.orderType === CUSTOM_REFERENCE_ORDER_TYPE) {
          const priceUpdate = updateCustomReferenceFinalPrice(next, {
            finalPrice: updates.finalPrice !== undefined ? updates.finalPrice : order.finalPrice,
            finalPriceConfirmed: updates.finalPriceConfirmed !== undefined ? updates.finalPriceConfirmed : order.finalPriceConfirmed === true,
          }, next.statusPayment || 'Pending verification');
          if (!priceUpdate) return json({ error: 'Enter a valid final order total of at least ₹500 and explicitly confirm it after reviewing the design.' }, 400);
          Object.assign(next, priceUpdate);
          next.advanceStatus = next.statusPayment || 'Pending verification';
        }
        if (updates.delivery?.phone && updates.delivery.phone !== order.delivery?.phone && order.whatsappConsent?.customerUpdates === true) {
          next.whatsappConsent = { ...order.whatsappConsent, customerUpdates: false };
          const customerNotice = order.whatsappNotifications?.customer;
          if (customerNotice && !['sent', 'unknown', 'sending'].includes(customerNotice.status)) {
            next.whatsappNotifications = { ...order.whatsappNotifications, customer: { ...customerNotice, status: 'skipped', errorCode: 'phone_changed_consent_required', updatedAt: new Date().toISOString() } };
          }
        }
        await saveOrder(next); return json({ ok: true, order: safePayment(next) });
      }
      if (body.action === 'setDeliveryStatus') {
        if (typeof body.delivered !== 'boolean') return json({ error: 'Choose a valid delivery action.' }, 400);
        if (order.status === 'Cancelled') return json({ error: 'Cancelled orders cannot be marked delivered or changed through delivery controls.' }, 409);
        const updated = updateDeliveryStatus(order, body.delivered, 'authenticated-admin');
        if (!updated.changed) return json({ ok: true, order: safePayment(order), unchanged: true });
        await saveOrder(updated.order);
        return json({ ok: true, order: safePayment(updated.order) });
      }
      return json({ error: 'Invalid order action.' }, 400);
    }
    if (body.resource === 'customer') {
      if (!validText(body.id, 254)) return json({ error: 'Invalid customer ID.' }, 400);
      const orders = await listOrders();
      const matching = orders.filter((o: any) => String(o.delivery?.email || o.delivery?.phone || o.customer).toLowerCase() === body.id.toLowerCase());
      if (!matching.length) return json({ error: 'Customer not found.' }, 404);
      if (body.action === 'delete') {
        if (!body.id.includes('@') || String(body.confirmation || '').toLowerCase() !== body.id.toLowerCase()) return json({ error: 'Type the customer email to confirm deletion.' }, 400);
        const blobs = await listAllBlobPages((options) => list(options), { prefix: ORDER_PREFIX, limit: 1000 });
        const urls = blobs.filter(b => matching.some((o: any) => o.id && b.pathname === `${ORDER_PREFIX}${o.id}.json`)).map(b => b.url);
        if (urls.length) await del(urls);
        return json({ ok: true });
      }
      if (body.action === 'update') {
        const d = body.updates;
        if (!d || typeof d !== 'object' || Array.isArray(d) || !validText(d.name, 160) || !validEmail(d.email) || !validText(d.phone, 40) || !validText(d.address, 500) || !validText(d.city, 100) || !validText(d.postal, 20)) return json({ error: 'Complete customer details are required.' }, 400);
        for (const order of matching) { order.customer = d.name; order.initials = d.name.split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(); order.delivery = { ...order.delivery, email: d.email, phone: d.phone, address: d.address, city: d.city, postal: d.postal }; await saveOrder(order); }
        return json({ ok: true });
      }
      return json({ error: 'Invalid customer action.' }, 400);
    }
    return json({ error: 'Unknown data resource.' }, 400);
  } catch (error) { logAdminWriteFailure(body.resource, error); return json({ error: 'Could not save store data.' }, 500); }
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[store-data] Order persistence unavailable: BLOB_READ_WRITE_TOKEN is not configured', { vercelEnvironment: process.env.VERCEL_ENV || 'unknown' });
    return json({ error: 'Shared storage is not connected.' }, 503);
  }
  const order = await request.json().catch(() => null);
  if (!order || !validText(order.id, 100) || !/^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(order.id) || !validText(order.customer, 160) || !validText(order.product, 240) || !Number.isFinite(order.total) || order.total < 0 || !statuses.includes(order.status) || !validEmail(order.delivery?.email) || !validText(order.delivery?.phone, 40) || !validText(order.delivery?.address, 500) || !validText(order.delivery?.city, 100) || !validText(order.delivery?.postal, 20)) return json({ error: 'Invalid order.' }, 400);
  if (order.whatsappConsent !== undefined && (!order.whatsappConsent || typeof order.whatsappConsent !== 'object' || Array.isArray(order.whatsappConsent) || typeof order.whatsappConsent.customerUpdates !== 'boolean')) return json({ error: 'Invalid WhatsApp contact permission.' }, 400);
  if (order.whatsappConsent?.customerUpdates === true && !isE164Phone(order.delivery.phone)) return json({ error: 'Use the customer WhatsApp number with country code or turn off WhatsApp updates.' }, 400);
  const paymentFields = getCustomerOrderPaymentFields(order);
  if (!paymentFields) return json({ error: 'Customer checkout currently accepts UPI orders only.' }, 400);
  const referencePhotoUrl = referencePhotoFromDesign(order.design);
  if (order.design?.customerReferencePhoto !== undefined && (!isGarmentReferencePhotoForOrder(order.design, order.id) || !referencePhotoUrl)) return json({ error: 'The customer model reference photo does not match this garment order.' }, 400);
  if (order.productId !== undefined && (!validText(order.productId, 100) || !validText(order.productName, 160) || (order.productImage !== undefined && (typeof order.productImage !== 'string' || order.productImage.length > 2000)) || !Number.isFinite(order.basePrice) || order.basePrice < 0)) return json({ error: 'Invalid product details.' }, 400);
  try {
    const store = await readStore();
    addDefaultCustomization(store);
    addDefaultCustomization({ products: store.abayaProducts });
    const productId = order.productId || '';
    const storedProductMatches = [...store.products, ...store.abayaProducts].filter((record: any) => record.id === productId);
    if (storedProductMatches.length > 1) return json({ error: 'This product reference is ambiguous. Contact the atelier before placing the order.' }, 409);
    let product = storedProductMatches[0];
    if (!product && order.design?.productId !== undefined && order.design.productId !== order.productId) return json({ error: 'The selected product does not match the submitted design. Refresh your choices.' }, 400);
    if (!product && String(order.design?.productType || '').toLowerCase() === 'abaya') {
      const legacyProduct = findLegacyAbayaFallback(order.productId, catalog, hasManagedAbayaCatalog(store.abayaProducts, store.abayaCatalogManaged));
      if (legacyProduct) {
        const fallbackStore = { products: [{ ...legacyProduct, stock: 0, available: true, stitchingType: '', options: [] }] };
        addDefaultCustomization(fallbackStore);
        product = fallbackStore.products[0];
      }
    }
    if (!product || product.available === false) return json({ error: 'This product is not currently available. Refresh the page and try again.' }, 409);
    if (order.productId && order.productName !== product.name) return json({ error: 'The product details changed. Refresh your choices before placing the order.' }, 409);
    if (order.design?.productId !== undefined && order.design.productId !== product.id) return json({ error: 'The selected product does not match the submitted design. Refresh your choices.' }, 400);
    if (order.design?.productName !== undefined && order.design.productName !== product.name) return json({ error: 'The product details changed. Refresh your choices before placing the order.' }, 409);
    if (order.design?.productType !== undefined && String(order.design.productType).toLowerCase() !== String(product.category || '').toLowerCase()) return json({ error: 'The selected product category changed. Refresh your choices before placing the order.' }, 409);
    if (order.design?.customerReferencePhoto !== undefined && !isGarmentReferencePhotoForOrder(order.design, order.id, String(product.category || ''))) return json({ error: 'The customer model reference photo does not match this product category.' }, 400);
    if (/^abaya$/i.test(String(product.category || '').trim())
      && !hasRequiredMeasurementValues(product.measurements, product.measurementsEnabled !== false, order.design?.measurements)) return json({ error: 'Complete all required Abaya measurements and remove values from hidden fields before placing the order.' }, 400);
    const pricing = calculateConfiguredSubtotal(product, { ...order.design, productType: product.category }, store.products.filter((item: any) => String(item.category || '').toLowerCase() === 'fabric'));
    if (!pricing.ok) return json({ error: pricing.error }, 400);
    if (Number(order.basePrice) !== pricing.basePrice) return json({ error: 'The product price changed. Refresh your choices before placing the order.' }, 409);
    const deliveryQuote = quoteFlatDelivery(order.delivery.postal, store.settings.deliveryRules || [], store.settings.keralaPinDirectory || null, resolveFlatDeliveryFee(store.settings.flatDeliveryFee), store.settings.restrictDeliveryToConfiguredRules === true);
    if (deliveryQuote.status !== 'available') return json({ error: deliveryQuote.message }, deliveryQuote.status === 'invalid' ? 400 : 503);
    const subtotal = pricing.subtotal;
    const deliveryFee = deliveryQuote.fee;
    const discount = 0;
    const finalTotal = calculateOrderTotal(subtotal, deliveryFee, discount);
    if (finalTotal === null) return json({ error: 'The order total could not be calculated safely.' }, 400);
    if (!matchesOrderBreakdown(order, subtotal, deliveryFee, discount)) return json({ error: 'The price breakdown changed. Review the latest delivery fee and total before retrying.' }, 409);
    const isCustomReferenceOrder = Boolean(referencePhotoUrl);
    const customReferenceFields = isCustomReferenceOrder ? createCustomReferenceOrderFields(finalTotal) : {};
    const savedDesign = order.productId ? {
      ...order.design,
      productType: product.category,
      productId: product.id,
      productName: product.name,
      productImage: product.image || product.images?.[0] || '',
      basePrice: pricing.basePrice,
      ...(String(product.category || '').toLowerCase() === 'abaya' && order.design?.selectedModel ? { selectedModel: { ...order.design.selectedModel, basePrice: pricing.basePrice } } : {}),
    } : order.design;
    const clean = {
      id: order.id, customer: order.customer,
      orderType: isCustomReferenceOrder ? CUSTOM_REFERENCE_ORDER_TYPE : 'standard',
      initials: order.initials || order.customer.split(/\s+/).map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(),
      product: order.product,
      ...(order.productId ? { productId: product.id, productName: product.name, productImage: product.image || product.images?.[0] || '', basePrice: pricing.basePrice } : {}),
      date: order.date || new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      subtotal, deliveryFee, discount, total: finalTotal, status: initialCustomerOrderStatus(order.status), tone: order.tone || 'sand',
      ...customReferenceFields,
      ...paymentFields,
      delivery: order.delivery, design: savedDesign,
      whatsappConsent: {
        customerUpdates: order.whatsappConsent?.customerUpdates === true,
        ...(order.whatsappConsent?.customerUpdates === true ? { capturedAt: new Date().toISOString() } : {}),
      },
      whatsappNotifications: createWhatsAppNotificationStates(),
      createdAt: typeof order.createdAt === 'string' ? order.createdAt : new Date().toISOString(),
    };
    const pathname = `${ORDER_PREFIX}${clean.id}.json`;
    const existing = await readBlob(pathname);
    if (existing) {
      if (isSameOrderIntent(existing, clean)) return json({ ok: true, orderId: clean.id, statusPayment: existing.statusPayment || 'Pending verification', subtotal: existing.subtotal, deliveryFee: existing.deliveryFee, discount: existing.discount || 0, total: existing.total, orderType: existing.orderType || 'standard', ...(existing.orderType === CUSTOM_REFERENCE_ORDER_TYPE ? { estimatedTotal: existing.estimatedTotal, advanceAmount: 500, advanceStatus: existing.advanceStatus || existing.statusPayment || 'Pending verification', finalPrice: existing.finalPrice ?? null, finalPriceConfirmed: existing.finalPriceConfirmed === true, remainingBalance: existing.remainingBalance ?? null } : {}), paymentAmount: customerPaymentAmount(existing), alreadySaved: true }, 200);
      return json({ error: 'This order reference is already in use. Please contact the atelier before retrying.' }, 409);
    }
    try {
      await persistOrderThenNotifyAdminPush(clean, {
        persist: async (savedOrder: any) => {
          await put(pathname, JSON.stringify(savedOrder), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
          return savedOrder;
        },
        notify: async (savedOrder: any) => {
          // Keep WhatsApp independent from FCM; both run only after the order is durable.
          await Promise.all([notifyNewOrder(savedOrder.id), notifyAdminDevicesOfOrder(savedOrder.id)]);
        },
      });
    } catch (writeError) {
      // A concurrent request may have saved the same reference after our read.
      const racedOrder = await readBlob(pathname);
      if (racedOrder && isSameOrderIntent(racedOrder, clean)) return json({ ok: true, orderId: clean.id, statusPayment: racedOrder.statusPayment || 'Pending verification', subtotal: racedOrder.subtotal, deliveryFee: racedOrder.deliveryFee, discount: racedOrder.discount || 0, total: racedOrder.total, orderType: racedOrder.orderType || 'standard', ...(racedOrder.orderType === CUSTOM_REFERENCE_ORDER_TYPE ? { estimatedTotal: racedOrder.estimatedTotal, advanceAmount: 500, advanceStatus: racedOrder.advanceStatus || racedOrder.statusPayment || 'Pending verification', finalPrice: racedOrder.finalPrice ?? null, finalPriceConfirmed: racedOrder.finalPriceConfirmed === true, remainingBalance: racedOrder.remainingBalance ?? null } : {}), paymentAmount: customerPaymentAmount(racedOrder), alreadySaved: true }, 200);
      throw writeError;
    }
    return json({ ok: true, orderId: clean.id, statusPayment: 'Pending verification', subtotal, deliveryFee, discount, total: finalTotal, orderType: clean.orderType || 'standard', ...(isCustomReferenceOrder ? { estimatedTotal: finalTotal, advanceAmount: 500, advanceStatus: 'Pending verification', finalPrice: null, finalPriceConfirmed: false, remainingBalance: null } : {}), paymentAmount: customerPaymentAmount(clean) }, 201);
  } catch (error) {
    logOrderWriteFailure(order.id, error);
    return json({ error: 'Could not save order.' }, 500);
  }
}
