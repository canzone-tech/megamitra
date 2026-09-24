import Link from 'next/link';

export function AdminAuthPageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mm-login-wrap">
      <section className="mm-login-card">
        <div className="mm-login-art">
          <div className="mm-brand"><span className="mm-brand-mark">M</span><div>Mega<span className="mm-brand-accent">Mitra</span><div className="mm-brand-subtitle">Admin security</div></div></div>
          <h1 style={{ marginTop: 34 }}>Secure access, auditable recovery.</h1>
          <p style={{ lineHeight: 1.7, opacity: .82 }}>Recovery and verification requests use one-time expiring tokens. The completion link opens the canonical MegaMitra public security flow.</p>
        </div>
        <div className="mm-login-form">
          <p className="mm-eyebrow">{eyebrow}</p>
          <h2 className="mm-title" style={{ fontSize: 34 }}>{title}</h2>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>{description}</p>
          {children}
          <p style={{ marginTop: 24, fontSize: 13, color: 'var(--mm-ink-500)' }}><Link href="/login">← Back to admin sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
