export type AdminStoreRequestKind = 'authentication' | 'validation' | 'server' | 'network' | 'response' | 'timeout';

export class AdminStoreRequestError extends Error {
  readonly kind: AdminStoreRequestKind;
  readonly statusCode?: number;

  constructor(
    kind: AdminStoreRequestKind,
    message: string,
    statusCode?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AdminStoreRequestError';
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

type StoreDataResponse = { ok?: boolean; error?: unknown; [key: string]: unknown };

let adminStoreWriteQueue: Promise<void> = Promise.resolve();

/** Serialize same-tab writes because each store-data PUT rewrites the shared Blob store file. */
export function serializeAdminStoreWrite<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = adminStoreWriteQueue.then(operation, operation);
  adminStoreWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function withRequestDeadline<Result>(operation: (signal: AbortSignal) => Promise<Result>, timeoutMs: number): Promise<Result> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AdminStoreRequestError('timeout', 'The store API did not respond before the save deadline. Your edits are still open; refresh to check whether the save completed before retrying.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function responseErrorMessage(body: unknown, status: number) {
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error?: unknown }).error;
    if (typeof message === 'string' && message.trim() && message.length <= 300) return message;
  }
  return `The store API rejected the request (HTTP ${status}).`;
}

/** Sends an authenticated same-origin store request and bounds both fetch and body parsing. */
export async function requestAdminStoreData<Result extends StoreDataResponse>(options: {
  method: 'GET' | 'PUT';
  body?: unknown;
  timeoutMs: number;
  fetcher?: typeof fetch;
  validate?: (body: Result) => boolean;
}): Promise<Result> {
  const fetcher = options.fetcher ?? fetch;
  try {
    return await withRequestDeadline(async (signal) => {
      let response: Response;
      try {
        response = await fetcher('/api/store-data', {
          method: options.method,
          cache: options.method === 'GET' ? 'no-store' : undefined,
          credentials: 'same-origin',
          headers: options.method === 'PUT' ? { 'Content-Type': 'application/json' } : undefined,
          body: options.method === 'PUT' ? JSON.stringify(options.body) : undefined,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new AdminStoreRequestError('network', 'Could not reach the store API. Check your connection and retry.', undefined, { cause: error });
      }

      let body: Result;
      try {
        body = await response.json() as Result;
      } catch (error) {
        if (signal.aborted) throw error;
        if (!response.ok) {
          const kind: AdminStoreRequestKind = response.status === 401 || response.status === 403
            ? 'authentication'
            : response.status === 400 || response.status === 409 || response.status === 413 || response.status === 422
              ? 'validation'
              : 'server';
          const message = response.status === 413
            ? 'The store rejected the save because the request was too large (HTTP 413). Your edits are still open; reduce the amount of data being saved or contact the site administrator.'
            : kind === 'authentication'
              ? 'Your admin session is no longer authorized. Sign in again, then retry the save.'
              : `The store API rejected the request (HTTP ${response.status}). Your edits are still open.`;
          throw new AdminStoreRequestError(kind, message, response.status, { cause: error });
        }
        throw new AdminStoreRequestError('response', 'The store API returned an unreadable response. Refresh to check whether the save completed before retrying.', response.status, { cause: error });
      }

      if (!response.ok) {
        const kind: AdminStoreRequestKind = response.status === 401 || response.status === 403
          ? 'authentication'
          : response.status === 400 || response.status === 409 || response.status === 413 || response.status === 422
            ? 'validation'
            : 'server';
        const message = response.status === 413
          ? 'The store rejected the save because the request was too large (HTTP 413). Your edits are still open; reduce the amount of data being saved or contact the site administrator.'
          : kind === 'authentication'
          ? 'Your admin session is no longer authorized. Sign in again, then retry the save.'
          : responseErrorMessage(body, response.status);
        throw new AdminStoreRequestError(kind, message, response.status);
      }

      if (!body || typeof body !== 'object' || Array.isArray(body) || (options.method === 'PUT' && body.ok !== true) || (options.validate && !options.validate(body))) {
        throw new AdminStoreRequestError('response', 'The store API did not confirm the requested changes. Your edits are still open; refresh before retrying.', response.status);
      }
      return body;
    }, options.timeoutMs);
  } catch (error) {
    if (error instanceof AdminStoreRequestError) throw error;
    if (error instanceof TypeError) throw new AdminStoreRequestError('network', 'The connection to the store API was interrupted. Your edits are still open; retry when the connection is stable.', undefined, { cause: error });
    throw new AdminStoreRequestError('server', 'The store request failed unexpectedly. Your edits are still open; retry or contact the site administrator.', undefined, { cause: error });
  }
}
