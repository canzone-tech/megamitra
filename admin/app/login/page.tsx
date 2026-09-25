import { LoginForm } from '@/components/login-form';

export default function AdminLoginPage() {
  return (
    <main className="mm-login-wrap">
      <section className="mm-login-card" aria-labelledby="admin-login-title">
        <div className="mm-login-art">
          <div className="mm-brand">
            <span className="mm-brand-mark">M</span>
            <span>Mega<span className="mm-brand-accent">GoldenClub</span></span>
          </div>
          <p className="mm-eyebrow" style={{ color: '#ffd978', marginTop: 38 }}>Administration</p>
          <h1 id="admin-login-title" style={{ fontSize: 'clamp(34px, 5vw, 54px)', margin: 0, letterSpacing: '-.05em' }}>
            Manage MegaGoldenClub with confidence.
          </h1>
          <p style={{ maxWidth: 430, lineHeight: 1.7, opacity: .82 }}>
            Review members, programs, rewards, payouts and daily operations from one secure workspace.
          </p>
        </div>
        <div className="mm-login-form">
          <p className="mm-eyebrow">Admin access</p>
          <h2 style={{ fontSize: 30, margin: '0 0 8px', letterSpacing: '-.04em' }}>Sign in to continue</h2>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>
            Use your MegaGoldenClub administrator account to access the management console.
          </p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
