import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageUploadError, uploadFilesSequentially } from './upload-batch.ts';

const completedProgress = { loaded: 10, total: 10, percentage: 100 };

test('reports 100 only after each image URL has been saved', async () => {
  const files = [{ name: 'model.jpg', size: 10 }];
  const progress = [];
  let saved = false;

  await uploadFilesSequentially(
    files,
    async (_file, onProgress) => {
      onProgress(completedProgress);
      return 'https://images.blob.vercel-storage.com/model.jpg';
    },
    async () => {
      assert.equal(progress.includes(100), false);
      await Promise.resolve();
      saved = true;
    },
    value => progress.push(value),
  );

  assert.equal(saved, true);
  assert.equal(progress.at(-1), 100);
});

test('keeps earlier saved images and identifies the later file that failed', async () => {
  const files = [
    { name: 'first.jpg', size: 10 },
    { name: 'second.jpg', size: 10 },
  ];
  const progress = [];
  const savedUrls = [];

  await assert.rejects(
    uploadFilesSequentially(
      files,
      async (file, onProgress) => {
        if (file.name === 'second.jpg') throw new ImageUploadError('blob', 'Blob storage rejected the upload.', { statusCode: 503 });
        onProgress(completedProgress);
        return 'https://images.blob.vercel-storage.com/first.jpg';
      },
      async url => { savedUrls.push(url); },
      value => progress.push(value),
    ),
    error => error instanceof ImageUploadError
      && error.stage === 'blob'
      && error.fileName === 'second.jpg'
      && error.statusCode === 503,
  );

  assert.deepEqual(savedUrls, ['https://images.blob.vercel-storage.com/first.jpg']);
  assert.ok((progress.at(-1) ?? 0) < 100);
  assert.equal(progress.some(value => value === 100), false);
});

test('marks a product URL save failure as the failing file and never completes the batch', async () => {
  const progress = [];

  await assert.rejects(
    uploadFilesSequentially(
      [{ name: 'fabric.png', size: 10 }],
      async (_file, onProgress) => {
        onProgress(completedProgress);
        return 'https://images.blob.vercel-storage.com/fabric.png';
      },
      async () => { throw new ImageUploadError('save', 'The URL was not confirmed in store data.'); },
      value => progress.push(value),
    ),
    error => error instanceof ImageUploadError && error.stage === 'save' && error.fileName === 'fabric.png',
  );

  assert.equal(progress.some(value => value === 100), false);
});
