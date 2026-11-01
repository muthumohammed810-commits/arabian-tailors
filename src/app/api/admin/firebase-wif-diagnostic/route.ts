import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/app/admin/guard';
import { authorizeAdminPushRequest } from '@/lib/admin-push-notifications.mjs';
import { diagnoseAdminFirebaseWif } from '@/lib/admin-push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export async function POST(request: Request) {
  if (!authorizeAdminPushRequest(await isAdminAuthenticated())) return json({ ok: false, stage: 'authorization', httpStatus: 401, message: 'Admin sign-in is required.' }, 401);
  if (!sameOrigin(request)) return json({ ok: false, stage: 'request-validation', httpStatus: 403, message: 'Request origin could not be verified.' }, 403);

  try {
    const result = await diagnoseAdminFirebaseWif();
    return json(result, result.ok ? 200 : result.httpStatus || 503);
  } catch {
    // Do not log the exception: authentication provider errors may contain sensitive details.
    return json({ ok: false, stage: 'diagnostic', httpStatus: 503, message: 'The Firebase identity diagnostic could not complete safely.' }, 503);
  }
}
