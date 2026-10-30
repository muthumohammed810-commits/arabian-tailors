import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from './guard';
import AdminDashboard from './dashboard';
export const dynamic = 'force-dynamic';
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;
  const next = typeof orderId === 'string' && /^AT-(?:[0-9]{6,}|[0-9a-f]{32})$/i.test(orderId)
    ? `/admin?orderId=${encodeURIComponent(orderId)}`
    : '/admin';
  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET) return <main className="admin-gate"><section className="admin-gate-card"><div className="eyebrow">SETUP REQUIRED</div><h1 className="serif">Admin access is locked</h1><p className="subtle">Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET in the Vercel project environment, then redeploy to enable your private dashboard.</p></section></main>;
  if (!await isAdminAuthenticated()) redirect(`/admin/login?next=${encodeURIComponent(next)}`);
  return <AdminDashboard />;
}
