export type UploadProgressEvent = { loaded: number; total: number; percentage: number };

export function appendOptionPhoto<OptionType extends { image?: string; images?: string[] }>(option: OptionType, url: string): OptionType {
  const images = [...(option.images || [])];
  if (option.image && !images.includes(option.image)) images.unshift(option.image);
  if (!images.includes(url)) images.push(url);
  return { ...option, images, image: images[0] || '' };
}

/** Upload files sequentially, reporting 100% only after every upload resolves. */
export async function uploadFilesSequentially<FileType extends { size: number }>(
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
    const url = await uploadFile(file, event => {
      const loadedRatio = event.total > 0 ? event.loaded / event.total : event.percentage / 100;
      const loadedBytes = Math.min(file.size, Math.max(0, loadedRatio * file.size));
      report(((completedBytes + loadedBytes) / Math.max(totalBytes, 1)) * 100);
    });
    if (!url) throw new Error('The image upload completed without returning a photo URL.');
    await onUploaded(url, file);
    completedBytes += file.size;
    report((completedBytes / Math.max(totalBytes, 1)) * 100);
  }

  onProgress(100);
}
