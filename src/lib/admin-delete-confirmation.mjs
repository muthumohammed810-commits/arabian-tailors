/**
 * Keeps destructive Admin actions explicitly confirmed while accepting the
 * previous typed-ID confirmation payload for older clients.
 */
export function isAdminDeleteConfirmed(body, { caseInsensitiveLegacyMatch = false } = {}) {
  if (body?.confirmed === true) return true;

  if (typeof body?.id !== 'string' || typeof body?.confirmation !== 'string') return false;
  return caseInsensitiveLegacyMatch
    ? body.confirmation.toLowerCase() === body.id.toLowerCase()
    : body.confirmation === body.id;
}
