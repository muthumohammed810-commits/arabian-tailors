export type SharedBlobStorage =
  | { mode: 'oidc'; configured: true; storeId: string; oidcToken: string }
  | { mode: 'token'; configured: true; token: string }
  | { mode: 'unavailable'; configured: false };

export function resolveSharedBlobStorage(env?: Record<string, string | undefined>): SharedBlobStorage;
export function sharedBlobAuthOptions(env?: Record<string, string | undefined>): { oidcToken: string; storeId: string } | { token: string };
export function isSharedBlobConfigured(env?: Record<string, string | undefined>): boolean;
export function sharedBlobUploadMode(env?: Record<string, string | undefined>): 'presigned' | 'client-token' | 'unavailable';
