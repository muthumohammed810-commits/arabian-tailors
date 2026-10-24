export type UploadProgressEvent = { loaded: number; total: number; percentage: number };

export type UploadFailureStage = 'authentication' | 'token' | 'blob' | 'save';

export class ImageUploadError extends Error {
  readonly stage: UploadFailureStage;
  readonly fileName?: string;
  readonly statusCode?: number;

  constructor(stage: UploadFailureStage, message: string, details: { fileName?: string; statusCode?: number; cause?: unknown } = {}) {
    super(message, { cause: details.cause });
    this.name = 'ImageUploadError';
    this.stage = stage;
    this.fileName = details.fileName;
    this.statusCode = details.statusCode;
  }
}

function withFileName(error: unknown, file: { name: string }): ImageUploadError {
  if (error instanceof ImageUploadError) {
    return new ImageUploadError(error.stage, error.message, {
      fileName: file.name,
      statusCode: error.statusCode,
      cause: error,
    });
  }
  return new ImageUploadError('blob', 'The upload failed unexpectedly. Retry this image.', {
    fileName: file.name,
    cause: error,
  });
}

export function appendOptionPhoto<OptionType extends { image?: string; images?: string[] }>(option: OptionType, url: string): OptionType {
  const images = [...(option.images || [])];
  if (option.image && !images.includes(option.image)) images.unshift(option.image);
  if (!images.includes(url)) images.push(url);
  return { ...option, images, image: images[0] || '' };
}

/** Upload files sequentially, reporting 100% only after every upload resolves. */
export async function uploadFilesSequentially<FileType extends { size: number; name: string }>(
  files: FileType[],
  uploadFile: (file: FileType, onProgress: (event: UploadProgressEvent) => void) => Promise<string>,
  onUploaded: (url: string, file: FileType) => void | Promise<void>,
  onProgress: (percentage: number) => void,
) {
  if (!files.length) return;

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  let completedBytes = 0;
  let lastReported = 0;
  const report = (percentage: number) => {
    lastReported = Math.max(lastReported, Math.min(99, Math.floor(percentage)));
    onProgress(lastReported);
  };

  for (const file of files) {
    try {
      const url = await uploadFile(file, event => {
        const loadedRatio = event.total > 0 ? event.loaded / event.total : event.percentage / 100;
        const loadedBytes = Math.min(file.size, Math.max(0, loadedRatio * file.size));
        report(((completedBytes + loadedBytes) / Math.max(totalBytes, 1)) * 100);
      });
      if (!url) throw new ImageUploadError('blob', 'The storage service completed without returning an image URL.');
      await onUploaded(url, file);
      completedBytes += file.size;
      report((completedBytes / Math.max(totalBytes, 1)) * 100);
    } catch (error) {
      throw withFileName(error, file);
    }
  }

  onProgress(100);
}
