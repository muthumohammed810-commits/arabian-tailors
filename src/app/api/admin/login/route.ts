import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export async function POST(request: Request) {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!password || !secret) return NextResponse.json({ error: 'Admin password is not configured on the server.' }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const submitted = typeof body.password === 'string' ? body.password : '';
  const expected = Buffer.from(password);
  const actual = Buffer.from(submitted);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const token = `${expires}.${createHmac('sha256', secret).update(`${expires}:arabian-tailors-admin`).digest('hex')}`;
  const response = NextResponse.json({ ok: true });
  response.cookies.set('atelier_admin', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/admin', expires: new Date(expires) });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('atelier_admin', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/admin', maxAge: 0 });
  return response;
}
