import { LoginForm } from '@/components/login-form';

export default function AdminLoginPage() {
  return (
    <main className="mm-login-wrap">
      <section className="mm-login-card" aria-labelledby="admin-login-title">
        <div className="mm-login-art">
          <div className="mm-brand">
            <span className="mm-brand-mark">M</span>
            <span>Mega<span className="mm-brand-accent">Mitra</span></span>
          </div>
          <p className="mm-eyebrow" style={{ color: '#ffd978', marginTop: 38 }}>Operations console</p>
          <h1 id="admin-login-title" style={{ fontSize: 'clamp(34px, 5vw, 54px)', margin: 0, letterSpacing: '-.05em' }}>
            Run the program from verified facts.
          </h1>
          <p style={{ maxWidth: 430, lineHeight: 1.7, opacity: .82 }}>
            Policies, money movement, qualifications, draw operations and prize fulfillment stay auditable and separated by design.
          </p>
        </div>
        <div className="mm-login-form">
          <p className="mm-eyebrow">Secure access</p>
          <h2 style={{ fontSize: 30, margin: '0 0 8px', letterSpacing: '-.04em' }}>Admin sign in</h2>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>
            MegaGoldenClub administrator credentials are verified by the API. Tokens stay in HttpOnly cookies in this web app.
          </p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
