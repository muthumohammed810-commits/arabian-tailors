import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminStoreRequestError, requestAdminStoreData, serializeAdminStoreWrite } from './admin-store-request.ts';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('confirms successful store writes and sends same-origin session credentials', async () => {
  const expected = { resource: 'products', products: [{ id: 'p1', name: 'Kandura' }] };
  const result = await requestAdminStoreData({
    method: 'PUT', body: expected, timeoutMs: 100,
    fetcher: async (url, init) => {
      assert.equal(url, '/api/store-data');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.method, 'PUT');
      assert.deepEqual(JSON.parse(init.body), expected);
      return jsonResponse({ ok: true, products: expected.products });
    },
    validate: body => JSON.stringify(body.products) === JSON.stringify(expected.products),
  });
  assert.equal(result.ok, true);
});

test('surfaces authentication expiry with its HTTP status', async () => {
  await assert.rejects(
    requestAdminStoreData({ method: 'PUT', body: {}, timeoutMs: 100, fetcher: async () => jsonResponse({ error: 'Sign in required.' }, 401) }),
    error => error instanceof AdminStoreRequestError && error.kind === 'authentication' && error.statusCode === 401,
  );
});

test('surfaces server validation errors without discarding the caller draft', async () => {
  const draft = { name: 'Edited model' };
  await assert.rejects(
    requestAdminStoreData({ method: 'PUT', body: draft, timeoutMs: 100, fetcher: async () => jsonResponse({ error: 'Invalid product list.' }, 400) }),
    error => error instanceof AdminStoreRequestError && error.kind === 'validation' && error.message === 'Invalid product list.',
  );
  assert.equal(draft.name, 'Edited model');
});

test('reports an upstream 413 even when the hosting error body is not JSON', async () => {
  await assert.rejects(
    requestAdminStoreData({ method: 'PUT', body: {}, timeoutMs: 100, fetcher: async () => new Response('<html>Payload Too Large</html>', { status: 413 }) }),
    error => error instanceof AdminStoreRequestError && error.kind === 'validation' && error.statusCode === 413 && error.message.includes('HTTP 413'),
  );
});

test('loads store data without requiring a write-only ok flag', async () => {
  const result = await requestAdminStoreData({
    method: 'GET', timeoutMs: 100,
    fetcher: async (_url, init) => {
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'same-origin');
      return jsonResponse({ products: [{ id: 'p1' }] });
    },
    validate: body => Array.isArray(body.products),
  });
  assert.equal(result.products.length, 1);
});

test('rejects a success response that does not confirm the requested product data', async () => {
  await assert.rejects(
    requestAdminStoreData({
      method: 'PUT', body: { resource: 'products', products: [{ id: 'p1', name: 'New name' }] }, timeoutMs: 100,
      fetcher: async () => jsonResponse({ ok: true, products: [{ id: 'p1', name: 'Old name' }] }),
      validate: body => JSON.stringify(body.products) === JSON.stringify([{ id: 'p1', name: 'New name' }]),
    }),
    error => error instanceof AdminStoreRequestError && error.kind === 'response',
  );
});

test('aborts a request that remains pending and returns a bounded timeout', async () => {
  let aborted = false;
  await assert.rejects(
    requestAdminStoreData({
      method: 'PUT', body: {}, timeoutMs: 15,
      fetcher: (_url, init) => new Promise(() => init.signal.addEventListener('abort', () => { aborted = true; }, { once: true })),
    }),
    error => error instanceof AdminStoreRequestError && error.kind === 'timeout',
  );
  assert.equal(aborted, true);
});

test('bounds a response body that stalls after HTTP success', async () => {
  const response = { ok: true, status: 200, json: () => new Promise(() => {}) };
  await assert.rejects(
    requestAdminStoreData({ method: 'PUT', body: {}, timeoutMs: 15, fetcher: async () => response }),
    error => error instanceof AdminStoreRequestError && error.kind === 'timeout',
  );
});

test('serializes store rewrites and continues after a failed write', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const first = serializeAdminStoreWrite(async () => {
    order.push('first-start');
    await firstGate;
    order.push('first-end');
    throw new Error('first write failed');
  });
  const second = serializeAdminStoreWrite(async () => {
    order.push('second-start');
    return 'confirmed';
  });

  await Promise.resolve();
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await assert.rejects(first, /first write failed/);
  assert.equal(await second, 'confirmed');
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
});
