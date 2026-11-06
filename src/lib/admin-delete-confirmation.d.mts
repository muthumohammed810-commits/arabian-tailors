export function isAdminDeleteConfirmed(
  body: { id?: unknown; confirmed?: unknown; confirmation?: unknown },
  options?: { caseInsensitiveLegacyMatch?: boolean },
): boolean;
