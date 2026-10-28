import { list, get, put, del } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { products as catalog } from '@/lib/catalog';
import { addDefaultCustomization } from '@/lib/customization-defaults';
import { isSameOrderIntent } from '@/lib/payment-order-idempotency';
import { getCustomerOrderPaymentFields } from '@/lib/upi-order-policy';
import { isAbayaReferencePhotoForOrder, referencePhotoFromDesign } from '@/lib/abaya-customization';
import { calculateConfiguredSubtotal, calculateOrderTotal, publicDeliveryRules, quoteDelivery, type DeliveryRule } from '@/lib/delivery-pricing';
import { isOfficialIndiaPostPinSource } from '@/lib/delivery-rule-csv.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const STORE_FILE = 'arabian-tailors/store.json';
const ORDER_PREFIX = 'arabian-tailors/orders/';
const statuses = ['New', 'In production', 'Ready to ship', 'Delivered', 'Cancelled'] as const;
const paymentStatuses = ['Pending verification', 'Paid', 'Failed', 'Refunded'] as const;
type Store = { products: any[]; settings: Record<string, any> };
const defaultStore = (): Store => ({ products: catalog.map(p => ({ ...p, stock: 0, available: true, stitchingType: '', options: [] })), settings: {} });
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
      if (!option || typeof option !== 'object' || Array.isArray(option) || !validText(option.id, 100) || optionIds.has(option.id) || !validText(option.name, 160) || (option.description !== undefined && (typeof option.description !== 'string' || option.description.length > 500)) || (option.image !== undefined && (typeof option.image !== 'string' || option.image.length > 2000)) || (option.images !== undefined && (!Array.isArray(option.images) || !option.images.every((image: unknown) => typeof image === 'string' && image.length <= 2000))) || (option.priceAdjustment !== undefined && (!Number.isFinite(option.priceAdjustment) || Math.abs(option.priceAdjustment) > 1_000_000)) || (option.basePrice !== undefined && (!Number.isFinite(option.basePrice) || option.basePrice < 0 || option.basePrice > 1_000_000)) || (option.stock !== undefined && (!Number.isInteger(option.stock) || option.stock < 0 || option.stock > 1_000_000)) || (option.available !== undefined && typeof option.available !== 'boolean') || (option.visible !== undefined && typeof option.visible !== 'boolean')) return false;
      optionIds.add(option.id);
      if (option.swatch !== undefined && (typeof option.swatch !== 'string' || !(/^#[0-9a-f]{6}$/i.test(option.swatch) || /^rgb\(\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)\s*\)$/i.test(option.swatch)))) return false;
      return !allowModelSettings || validModelCustomization(option.modelCustomization, validOption);
    };
    return step.options.every((option: any) => validOption(option, true));
  });
}
function validMeasurementFields(value: unknown) {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((field: any) => {
    if (!field || typeof field !== 'object' || Array.isArray(field) || !validText(field.id, 100) || ids.has(field.id) || !validText(field.name, 120) || !['cm', 'inch'].includes(field.unit) || (field.required !== undefined && typeof field.required !== 'boolean') || (field.available !== undefined && typeof field.available !== 'boolean')) return false;
    ids.add(field.id);
    return true;
  });
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
  return { products: stored.products, settings: stored.settings && typeof stored.settings === 'object' ? stored.settings : {} };
}
async function listOrders() {
  const { blobs } = await list({ prefix: ORDER_PREFIX, limit: 1000 });
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
function safePayment(order: any) {
  return {
    id: order.id, customer: order.customer, initials: order.initials, product: order.product,
    ...(order.productId ? { productId: order.productId } : {}),
    ...(order.productName ? { productName: order.productName } : {}),
    ...(order.productImage ? { productImage: order.productImage } : {}),
    ...(Number.isFinite(order.basePrice) ? { basePrice: order.basePrice } : {}),
    date: order.date, total: order.total, subtotal: order.subtotal, deliveryFee: order.deliveryFee, discount: order.discount, status: order.status, tone: order.tone,
    delivery: order.delivery, design: order.design,
    paymentMethod: ['upi','card','cod'].includes(order.paymentMethod) ? order.paymentMethod : 'Not provided',
    statusPayment: paymentStatuses.includes(order.statusPayment) ? order.statusPayment : 'Pending verification',
  };
}
function validEmail(value: unknown): value is string { return typeof value === 'string' && validText(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validateSettings(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'deliveryRules') {
      if (!Array.isArray(item) || item.length > 500) return false;
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
        && (rule.imported !== true || (Number.isInteger(rule.fee) && validText(rule.area, 120) && validText(rule.pinSource, 500) && isOfficialIndiaPostPinSource(rule.pinSource) && validText(rule.feeSource, 500)))
        && typeof rule.enabled === 'boolean')) return false;
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
    if (await isAdminAuthenticated()) {
      if (migratedCustomization) await saveStore(store);
      const orders = (await listOrders()).map(safePayment);
      const customers = [...new Map(orders.filter((o: any) => o.delivery?.email || o.customer).map((o: any) => {
        const d = o.delivery || {};
        const key = String(d.email || d.phone || o.customer).toLowerCase();
        return [key, { id: key, name: o.customer || d.name || '', email: d.email || '', phone: d.phone || '', address: d.address || '', city: d.city || '', postal: d.postal || '', orderCount: orders.filter((x: any) => String(x.delivery?.email || x.delivery?.phone || x.customer).toLowerCase() === key).length }];
      }))].map(([, customer]) => customer);
      return json({ ...store, orders, customers });
    }
    return json({ products: store.products.filter(p => p.available !== false), settings: { ...store.settings, deliveryRules: publicDeliveryRules(Array.isArray(store.settings.deliveryRules) ? store.settings.deliveryRules : []) } });
  } catch { return json({ error: 'Could not load store data.' }, 500); }
}

export async function PUT(request: Request) {
  if (!await isAdminAuthenticated()) return json({ error: 'Sign in required.' }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'Shared storage is not connected.' }, 503);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
  try {
    if (body.resource === 'settings') {
      if (!validateSettings(body.settings)) return json({ error: 'Invalid store settings.' }, 400);
      const store = await readStore(); store.settings = body.settings; await saveStore(store); return json({ ok: true, settings: store.settings });
    }
    if (body.resource === 'products') {
      if (!Array.isArray(body.products) || body.products.length > 500 || !body.products.every((p: any) => validText(p.id, 100) && validText(p.name, 160) && validText(p.category, 80) && (p.description === undefined || typeof p.description === 'string' && p.description.length <= 2000) && Number.isFinite(p.price) && p.price >= 0 && Number.isFinite(p.stock) && p.stock >= 0 && (p.available === undefined || typeof p.available === 'boolean') && (p.options === undefined || Array.isArray(p.options) && p.options.length <= 50 && p.options.every((o: any) => typeof o === 'string' && o.length <= 160)) && validCustomizationSteps(p.customizationSteps) && validMeasurementFields(p.measurements) && (p.measurementsEnabled === undefined || typeof p.measurementsEnabled === 'boolean') && (p.stitchingType === undefined || typeof p.stitchingType === 'string' && p.stitchingType.length <= 160) && (p.image === undefined || typeof p.image === 'string' && p.image.length <= 2000) && (p.images === undefined || Array.isArray(p.images) && p.images.every((image: any) => typeof image === 'string' && image.length <= 2000)))) return json({ error: 'Invalid product list.' }, 400);
      if (new Set(body.products.map((p: any) => p.id)).size !== body.products.length) return json({ error: 'Product IDs must be unique.' }, 400);
      const store = await readStore(); store.products = body.products; await saveStore(store); return json({ ok: true, products: store.products });
    }
    if (body.resource === 'productPhotos' || body.resource === 'optionPhotos') {
      if (!validText(body.productId, 100) || !isVercelBlobUrl(body.url) || !['add', 'replace'].includes(body.action)) return json({ error: 'Invalid image update.' }, 400);
      if (body.action === 'replace' && (!Number.isInteger(body.index) || body.index < 0)) return json({ error: 'Invalid photo position.' }, 400);
      const store = await readStore();
      const product = store.products.find((item: any) => item.id === body.productId);
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
        if (updates.customer !== undefined && !validText(updates.customer, 160)) return json({ error: 'Invalid customer name.' }, 400);
        if (updates.total !== undefined && (!Number.isFinite(updates.total) || updates.total < 0)) return json({ error: 'Invalid order total.' }, 400);
        if (updates.delivery !== undefined) { const d = updates.delivery; if (!d || typeof d !== 'object' || !validEmail(d.email) || !validText(d.phone, 40) || !validText(d.address, 500) || !validText(d.city, 100) || !validText(d.postal, 20)) return json({ error: 'Invalid delivery details.' }, 400); }
        if (updates.statusPayment !== undefined && (!paymentStatuses.includes(updates.statusPayment) || (order.statusPayment || 'Pending verification') !== 'Pending verification' || updates.statusPayment === 'Pending verification')) return json({ error: 'Payment status can only be changed from pending verification to a reviewed outcome.' }, 400);
        const next = { ...order, ...updates }; delete next.payment;
        await saveOrder(next); return json({ ok: true, order: safePayment(next) });
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
        const { blobs } = await list({ prefix: ORDER_PREFIX, limit: 1000 });
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
  const paymentFields = getCustomerOrderPaymentFields(order);
  if (!paymentFields) return json({ error: 'Customer checkout currently accepts UPI orders only.' }, 400);
  const referencePhotoUrl = referencePhotoFromDesign(order.design);
  if (order.design?.customerReferencePhoto !== undefined && (!isAbayaReferencePhotoForOrder(order.design, order.id) || !referencePhotoUrl)) return json({ error: 'The customer reference photo does not match this Abaya order.' }, 400);
  if (order.productId !== undefined && (!validText(order.productId, 100) || !validText(order.productName, 160) || (order.productImage !== undefined && (typeof order.productImage !== 'string' || order.productImage.length > 2000)) || !Number.isFinite(order.basePrice) || order.basePrice < 0)) return json({ error: 'Invalid product details.' }, 400);
  try {
    const store = await readStore();
    addDefaultCustomization(store);
    const product = store.products.find((item: any) => item.id === order.productId);
    if (!product || product.available === false) return json({ error: 'This product is not currently available. Refresh the page and try again.' }, 409);
    const pricing = calculateConfiguredSubtotal(product, order.design, store.products.filter((item: any) => String(item.category || '').toLowerCase() === 'fabric'));
    if (!pricing.ok) return json({ error: pricing.error }, 400);
    if (Number(order.basePrice) !== pricing.basePrice) return json({ error: 'The product price changed. Refresh your choices before placing the order.' }, 409);
    const deliveryQuote = quoteDelivery(order.delivery.postal, (Array.isArray(store.settings.deliveryRules) ? store.settings.deliveryRules : []) as DeliveryRule[]);
    if (deliveryQuote.status !== 'available') return json({ error: deliveryQuote.message }, 400);
    const subtotal = pricing.subtotal;
    const deliveryFee = deliveryQuote.fee;
    const discount = 0;
    const finalTotal = calculateOrderTotal(subtotal, deliveryFee, discount);
    if (finalTotal === null) return json({ error: 'The order total could not be calculated safely.' }, 400);
    if (Number(order.subtotal) !== subtotal || Number(order.deliveryFee) !== deliveryFee || Number(order.discount || 0) !== discount || Number(order.total) !== finalTotal) return json({ error: 'The price breakdown changed. Review the latest delivery fee and total before retrying.' }, 409);
    const clean = {
      id: order.id, customer: order.customer,
      initials: order.initials || order.customer.split(/\s+/).map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(),
      product: order.product,
      ...(order.productId ? { productId: order.productId, productName: order.productName, productImage: order.productImage || '', basePrice: order.basePrice } : {}),
      date: order.date || new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      subtotal, deliveryFee, discount, total: finalTotal, status: order.status, tone: order.tone || 'sand',
      ...paymentFields,
      delivery: order.delivery, design: order.design,
      createdAt: typeof order.createdAt === 'string' ? order.createdAt : new Date().toISOString(),
    };
    const pathname = `${ORDER_PREFIX}${clean.id}.json`;
    const existing = await readBlob(pathname);
    if (existing) {
      if (isSameOrderIntent(existing, clean)) return json({ ok: true, orderId: clean.id, statusPayment: existing.statusPayment || 'Pending verification', subtotal: existing.subtotal, deliveryFee: existing.deliveryFee, discount: existing.discount || 0, total: existing.total, alreadySaved: true }, 200);
      return json({ error: 'This order reference is already in use. Please contact the atelier before retrying.' }, 409);
    }
    try {
      await put(pathname, JSON.stringify(clean), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    } catch (writeError) {
      // A concurrent request may have saved the same reference after our read.
      const racedOrder = await readBlob(pathname);
      if (racedOrder && isSameOrderIntent(racedOrder, clean)) return json({ ok: true, orderId: clean.id, statusPayment: racedOrder.statusPayment || 'Pending verification', subtotal: racedOrder.subtotal, deliveryFee: racedOrder.deliveryFee, discount: racedOrder.discount || 0, total: racedOrder.total, alreadySaved: true }, 200);
      throw writeError;
    }
    return json({ ok: true, orderId: clean.id, statusPayment: 'Pending verification', subtotal, deliveryFee, discount, total: finalTotal }, 201);
  } catch (error) {
    logOrderWriteFailure(order.id, error);
    return json({ error: 'Could not save order.' }, 500);
  }
}
