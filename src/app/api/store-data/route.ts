import { list, get, put, del } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { products as catalog } from '@/lib/catalog';

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
    date: order.date, total: order.total, status: order.status, tone: order.tone,
    delivery: order.delivery, design: order.design,
    paymentMethod: ['upi','card','cod'].includes(order.paymentMethod) ? order.paymentMethod : 'Not provided',
    statusPayment: paymentStatuses.includes(order.statusPayment) ? order.statusPayment : 'Pending verification',
  };
}
function validEmail(value: unknown): value is string { return typeof value === 'string' && validText(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validateSettings(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, v]) => ['storeName','gold','background','heroImage','upiId','accountName','accountNumber','ifsc','bankName','qr'].includes(key) && typeof v === 'string' && v.length <= 2_000_000);
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'Shared storage is not connected.' }, 503);
  try {
    const store = await readStore();
    if (await isAdminAuthenticated()) {
      const orders = (await listOrders()).map(safePayment);
      const customers = [...new Map(orders.filter((o: any) => o.delivery?.email || o.customer).map((o: any) => {
        const d = o.delivery || {};
        const key = String(d.email || d.phone || o.customer).toLowerCase();
        return [key, { id: key, name: o.customer || d.name || '', email: d.email || '', phone: d.phone || '', address: d.address || '', city: d.city || '', postal: d.postal || '', orderCount: orders.filter((x: any) => String(x.delivery?.email || x.delivery?.phone || x.customer).toLowerCase() === key).length }];
      }))].map(([, customer]) => customer);
      return json({ ...store, orders, customers });
    }
    return json({ products: store.products.filter(p => p.available !== false), settings: store.settings });
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
      if (!Array.isArray(body.products) || body.products.length > 500 || !body.products.every((p: any) => validText(p.id, 100) && validText(p.name, 160) && validText(p.category, 80) && (p.description === undefined || typeof p.description === 'string' && p.description.length <= 2000) && Number.isFinite(p.price) && p.price >= 0 && Number.isFinite(p.stock) && p.stock >= 0 && (p.available === undefined || typeof p.available === 'boolean') && (p.options === undefined || Array.isArray(p.options) && p.options.length <= 50 && p.options.every((o: any) => typeof o === 'string' && o.length <= 160)) && (p.stitchingType === undefined || typeof p.stitchingType === 'string' && p.stitchingType.length <= 160) && (p.image === undefined || typeof p.image === 'string' && p.image.length <= 2000))) return json({ error: 'Invalid product list.' }, 400);
      if (new Set(body.products.map((p: any) => p.id)).size !== body.products.length) return json({ error: 'Product IDs must be unique.' }, 400);
      const store = await readStore(); store.products = body.products; await saveStore(store); return json({ ok: true, products: store.products });
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
  } catch { return json({ error: 'Could not save store data.' }, 500); }
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'Shared storage is not connected.' }, 503);
  const order = await request.json().catch(() => null);
  if (!order || !validText(order.id, 100) || !/^AT-[0-9]{6,}$/.test(order.id) || !validText(order.customer, 160) || !validText(order.product, 240) || !Number.isFinite(order.total) || order.total < 0 || !statuses.includes(order.status) || !validEmail(order.delivery?.email) || !validText(order.delivery?.phone, 40) || !validText(order.delivery?.address, 500) || !validText(order.delivery?.city, 100) || !validText(order.delivery?.postal, 20)) return json({ error: 'Invalid order.' }, 400);
  if (order.productId !== undefined && (!validText(order.productId, 100) || !validText(order.productName, 160) || (order.productImage !== undefined && (typeof order.productImage !== 'string' || order.productImage.length > 2000)) || !Number.isFinite(order.basePrice) || order.basePrice < 0)) return json({ error: 'Invalid product details.' }, 400);
  try {
    const clean = {
      id: order.id, customer: order.customer,
      initials: order.initials || order.customer.split(/\s+/).map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(),
      product: order.product,
      ...(order.productId ? { productId: order.productId, productName: order.productName, productImage: order.productImage || '', basePrice: order.basePrice } : {}),
      date: order.date || new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      total: order.total, status: order.status, tone: order.tone || 'sand',
      statusPayment: 'Pending verification',
      paymentMethod: ['upi','card','cod'].includes(order.paymentMethod) ? order.paymentMethod : 'Not provided',
      delivery: order.delivery, design: order.design,
      createdAt: typeof order.createdAt === 'string' ? order.createdAt : new Date().toISOString(),
    };
    await put(`${ORDER_PREFIX}${clean.id}.json`, JSON.stringify(clean), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    return json({ ok: true }, 201);
  } catch { return json({ error: 'Could not save order.' }, 500); }
}
