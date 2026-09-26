import Link from 'next/link';
import { AdminEmailChangeForm } from '@/components/auth-account-forms';
import { PlatformConfigAdmin } from '@/components/platform-config-admin';

export default function AdminSecurityPage() {
  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div>Mega<span className="mm-brand-accent">GoldenClub</span><div className="mm-brand-subtitle">Platform configuration</div></div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="mm-button secondary" href="/portal/settings">Settings</Link>
          <Link className="mm-button secondary" href="/operations">Operations</Link>
        </div>
      </header>
      <main className="mm-page">
        <div className="mm-hero-row">
          <div><p className="mm-eyebrow">SuperAdmin configuration</p><h1 className="mm-title">Authentication, security & registration</h1><p className="mm-subtitle">Complete platform access and member-onboarding rules before creating operational users. These settings are stored in the database, validated by the backend and audited on every change.</p></div>
        </div>

        <PlatformConfigAdmin />

        <section className="mm-card" style={{ maxWidth: 760, marginTop: 18 }}>
          <div className="mm-card-head"><h2>SuperAdmin account email</h2><span className="mm-chip warning">ACCOUNT ACTION</span></div>
          <div className="mm-card-body">
            <p className="mm-note" style={{ marginBottom: 16 }}>This changes only the signed-in SuperAdmin account email. It is separate from platform-wide authentication policy.</p>
            <AdminEmailChangeForm />
          </div>
        </section>
      </main>
    </div>
  );
}
