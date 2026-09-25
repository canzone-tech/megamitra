import Link from 'next/link';
import { AdminEmailChangeForm } from '@/components/auth-account-forms';

export default function AdminSecurityPage() {
  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div>Mega<span className="mm-brand-accent">GoldenClub</span><div className="mm-brand-subtitle">Admin security</div></div></div>
        <Link className="mm-button secondary" href="/operations">Operations</Link>
      </header>
      <main className="mm-page">
        <div className="mm-hero-row">
          <div><p className="mm-eyebrow">Account security</p><h1 className="mm-title">Change your admin email</h1><p className="mm-subtitle">Enter your current password and confirm the new email address. For your security, you'll be signed out after the change.</p></div>
        </div>
        <section className="mm-card" style={{ maxWidth: 640 }}>
          <div className="mm-card-head"><h2>Change account email</h2><span className="mm-chip warning">Re-verification required</span></div>
          <div className="mm-card-body"><AdminEmailChangeForm /></div>
        </section>
      </main>
    </div>
  );
}
