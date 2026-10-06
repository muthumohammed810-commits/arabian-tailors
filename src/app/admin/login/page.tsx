'use client';
import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';

export default function AdminLogin() {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not sign in.'); window.location.href = '/admin'; }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign in.'); setBusy(false); }
  }
  return <main className="admin-gate"><form onSubmit={submit} className="admin-gate-card"><div className="eyebrow">ARABIAN TAILORS · OWNER ACCESS</div><LockKeyhole size={25} color="var(--gold)"/><h1 className="serif">Admin sign in</h1><p className="subtle">Enter the password configured for your store.</p><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>{error&&<p className="admin-gate-error">{error}</p>}<button className="btn" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></main>;
}
