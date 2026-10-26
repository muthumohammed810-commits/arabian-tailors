import assert from 'node:assert/strict';
import test from 'node:test';
import { createUploadProgressActivityReporter, ImageUploadError, saveUploadedPhotoUrl, uploadFilesSequentially, withAbortableDeadline } from './upload-batch.ts';

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

test('retries saving an uploaded URL without transferring it again and updates only after confirmation', async () => {
  let transferCount = 0;
  const uploadOnce = async () => {
    transferCount += 1;
    return 'https://images.blob.vercel-storage.com/already-uploaded.jpg';
  };
  const uploadedUrl = await uploadOnce();
  const gallery = [];
  let saveAttempt = 0;

  await assert.rejects(saveUploadedPhotoUrl(
    uploadedUrl,
    async url => {
      assert.equal(url, uploadedUrl);
      saveAttempt += 1;
      throw new ImageUploadError('save', 'Store did not confirm the URL yet.');
    },
    images => gallery.splice(0, gallery.length, ...images),
  ));
  assert.deepEqual(gallery, []);

  const saved = await saveUploadedPhotoUrl(
    uploadedUrl,
    async url => {
      assert.equal(url, uploadedUrl);
      saveAttempt += 1;
      return ['existing.jpg', url];
    },
    images => gallery.splice(0, gallery.length, ...images),
  );

  assert.equal(transferCount, 1);
  assert.equal(saveAttempt, 2);
  assert.deepEqual(saved, ['existing.jpg', uploadedUrl]);
  assert.deepEqual(gallery, ['existing.jpg', uploadedUrl]);
});

test('aborts a never-resolving Blob transfer at 97% and names the file', async () => {
  const progress = [];
  let wasAborted = false;

  await assert.rejects(
    uploadFilesSequentially(
      [{ name: 'hanging-model.jpg', size: 10 }],
      (_file, onProgress) => {
        onProgress({ loaded: 97, total: 100, percentage: 97 });
        return withAbortableDeadline(
          signal => new Promise(() => { signal.addEventListener('abort', () => { wasAborted = true; }); }),
          { timeoutMs: 15, onTimeout: () => new ImageUploadError('blob', 'Blob transfer exceeded its deadline.') },
        );
      },
      async () => {},
      value => progress.push(value),
    ),
    error => error instanceof ImageUploadError && error.stage === 'blob' && error.fileName === 'hanging-model.jpg',
  );

  assert.equal(wasAborted, true);
  assert.equal(progress.at(-1), 97);
  assert.equal(progress.includes(100), false);
});

test('aborts a never-resolving token request and reports the token stage', async () => {
  let wasAborted = false;

  await assert.rejects(
    uploadFilesSequentially(
      [{ name: 'token-pending.png', size: 10 }],
      () => withAbortableDeadline(
        signal => new Promise(() => { signal.addEventListener('abort', () => { wasAborted = true; }); }),
        { timeoutMs: 15, onTimeout: () => new ImageUploadError('token', 'Upload authorization exceeded its deadline.') },
      ),
      async () => {},
      () => {},
    ),
    error => error instanceof ImageUploadError && error.stage === 'token' && error.fileName === 'token-pending.png',
  );

  assert.equal(wasAborted, true);
});

test('keeps an earlier saved photo when a later store save never resolves', async () => {
  const files = [
    { name: 'saved-first.jpg', size: 10 },
    { name: 'hanging-save.png', size: 10 },
  ];
  const progress = [];
  const savedUrls = [];

  await assert.rejects(
    uploadFilesSequentially(
      files,
      async file => `https://images.blob.vercel-storage.com/${file.name}`,
      async (url, file) => {
        if (file.name === 'hanging-save.png') {
          await withAbortableDeadline(
            signal => new Promise(() => { signal.addEventListener('abort', () => {}); }),
            { timeoutMs: 15, onTimeout: () => new ImageUploadError('save', 'Store save exceeded its deadline.') },
          );
        }
        savedUrls.push(url);
      },
      value => progress.push(value),
    ),
    error => error instanceof ImageUploadError && error.stage === 'save' && error.fileName === 'hanging-save.png',
  );

  assert.deepEqual(savedUrls, ['https://images.blob.vercel-storage.com/saved-first.jpg']);
  assert.equal(progress.includes(100), false);
});

test('activity cannot extend the hard end-to-end deadline', async () => {
  let timeoutKind;

  await assert.rejects(
    withAbortableDeadline(async (signal, reportActivity) => {
      const interval = setInterval(reportActivity, 2);
      signal.addEventListener('abort', () => clearInterval(interval), { once: true });
      return new Promise((_resolve, reject) => setTimeout(() => reject(new Error('unexpected completion')), 100));
    }, { timeoutMs: 15, idleTimeoutMs: 8, onTimeout: kind => { timeoutKind = kind; return new Error(`deadline:${kind}`); } }),
    /deadline:total/,
  );

  assert.equal(timeoutKind, 'total');
});

test('unchanged Blob progress cannot keep the idle deadline alive', async () => {
  let timeoutKind;
  let wasAborted = false;

  await assert.rejects(
    withAbortableDeadline(async (signal, reportActivity) => {
      const observeProgress = createUploadProgressActivityReporter(reportActivity);
      const interval = setInterval(() => observeProgress({ loaded: 74 }), 2);
      signal.addEventListener('abort', () => {
        wasAborted = true;
        clearInterval(interval);
      }, { once: true });
      return new Promise(() => {});
    }, { timeoutMs: 80, idleTimeoutMs: 15, onTimeout: kind => { timeoutKind = kind; return new Error(`deadline:${kind}`); } }),
    /deadline:idle/,
  );

  assert.equal(timeoutKind, 'idle');
  assert.equal(wasAborted, true);
});

test('a Blob retry that restarts its byte count still counts as transfer activity', () => {
  const activity = [];
  const observeProgress = createUploadProgressActivityReporter(() => activity.push('active'));

  for (const loaded of [0, 10, 10, 3, 7]) observeProgress({ loaded });

  assert.equal(activity.length, 4);
});

test('forward Blob byte progress extends the idle deadline', async () => {
  let timeoutKind;
  let wasAborted = false;

  await assert.rejects(
    withAbortableDeadline(async (signal, reportActivity) => {
      const observeProgress = createUploadProgressActivityReporter(reportActivity);
      let loaded = 0;
      const interval = setInterval(() => {
        loaded += 1;
        observeProgress({ loaded });
      }, 3);
      signal.addEventListener('abort', () => {
        wasAborted = true;
        clearInterval(interval);
      }, { once: true });
      return new Promise(() => {});
    }, { timeoutMs: 60, idleTimeoutMs: 15, onTimeout: kind => { timeoutKind = kind; return new Error(`deadline:${kind}`); } }),
    /deadline:total/,
  );

  assert.equal(timeoutKind, 'total');
  assert.equal(wasAborted, true);
});
