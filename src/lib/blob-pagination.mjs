/** @typedef {{ pathname: string; url: string }} PagedBlob */

/**
 * Read every page returned by the Vercel Blob list() cursor contract.
 * Results are deduplicated by pathname and sorted for deterministic consumers.
 * @param {(options: { prefix: string; limit: number; cursor?: string }) => Promise<{ blobs: PagedBlob[]; hasMore: boolean; cursor?: string }>} listPage
 * @param {{ prefix: string; limit: number }} options
 * @returns {Promise<PagedBlob[]>}
 */
export async function listAllBlobPages(listPage, options) {
  const byPath = new Map();
  const seenCursors = new Set();
  let cursor;

  while (true) {
    const page = await listPage({ ...options, ...(cursor ? { cursor } : {}) });
    for (const blob of page.blobs) {
      if (blob && typeof blob.pathname === 'string') byPath.set(blob.pathname, blob);
    }
    if (!page.hasMore) break;
    if (typeof page.cursor !== 'string' || !page.cursor || seenCursors.has(page.cursor)) {
      throw new Error('Blob listing pagination did not provide a new cursor.');
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }

  return [...byPath.values()].sort((a, b) => a.pathname.localeCompare(b.pathname));
}
