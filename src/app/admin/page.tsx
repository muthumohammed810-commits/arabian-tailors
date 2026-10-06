import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from './guard';
import AdminDashboard from './dashboard';
export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET) return <main className="admin-gate"><section className="admin-gate-card"><div className="eyebrow">SETUP REQUIRED</div><h1 className="serif">Admin access is locked</h1><p className="subtle">Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET in the Vercel project environment, then redeploy to enable your private dashboard.</p></section></main>;
  if (!await isAdminAuthenticated()) redirect('/admin/login');
  return <AdminDashboard />;
}
