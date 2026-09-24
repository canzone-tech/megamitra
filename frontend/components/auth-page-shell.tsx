import Link from 'next/link';

export function AuthPageShell({
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
          <Link className="mm-brand" href="/" style={{ color: 'white' }}>
            <span className="mm-brand-mark">M</span>
            <span>Mega<span style={{ color: '#ffd66e' }}>Mitra</span></span>
          </Link>
          <h1>Secure account access, without shortcuts.</h1>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.75, opacity: .84 }}>
            Recovery and verification actions use expiring one-time links. Password resets and verified email changes revoke older sessions automatically.
          </p>
        </div>
        <div className="mm-login-form">
          <p className="mm-eyebrow">{eyebrow}</p>
          <h2 className="mm-title" style={{ fontSize: 34 }}>{title}</h2>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>{description}</p>
          {children}
          <p style={{ marginTop: 24, fontSize: 13, color: 'var(--mm-ink-500)' }}><Link href="/login">← Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
