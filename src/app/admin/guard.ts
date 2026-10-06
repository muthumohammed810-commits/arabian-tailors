import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

export async function isAdminAuthenticated() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = (await cookies()).get('atelier_admin')?.value;
  if (!secret || !token) return false;
  const [expiry, signature] = token.split('.');
  if (!expiry || !signature || !/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  const expected = createHmac('sha256', secret).update(`${expiry}:arabian-tailors-admin`).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
