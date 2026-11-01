import assert from 'node:assert/strict';
import test from 'node:test';
import { listAllBlobPages } from './blob-pagination.mjs';

test('follows the Vercel Blob cursor and deduplicates overlapping paths in stable order', async () => {
  const calls = [];
  const pages = [
    { blobs: [{ pathname: 'orders/02' }, { pathname: 'orders/01' }], hasMore: true, cursor: 'page-2' },
    { blobs: [{ pathname: 'orders/02' }, { pathname: 'orders/03' }], hasMore: false },
  ];
  const blobs = await listAllBlobPages(async (options) => { calls.push(options); return pages[calls.length - 1]; }, { prefix: 'orders/', limit: 1000 });
  assert.deepEqual(calls, [{ prefix: 'orders/', limit: 1000 }, { prefix: 'orders/', limit: 1000, cursor: 'page-2' }]);
  assert.deepEqual(blobs.map(blob => blob.pathname), ['orders/01', 'orders/02', 'orders/03']);
});

test('fails rather than silently truncating if a page has no advancing cursor', async () => {
  await assert.rejects(() => listAllBlobPages(async () => ({ blobs: [], hasMore: true }), { prefix: 'orders/', limit: 1000 }), /new cursor/);
});

test('detects a repeated cursor rather than looping forever', async () => {
  let calls = 0;
  await assert.rejects(() => listAllBlobPages(async () => {
    calls += 1;
    return { blobs: [], hasMore: true, cursor: 'same-page' };
  }, { prefix: 'orders/', limit: 1000 }), /new cursor/);
  assert.equal(calls, 2);
});
