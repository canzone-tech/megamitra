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
            <span>Mega<span style={{ color: '#ffd66e' }}>GoldenClub</span></span>
          </Link>
          <h1>Keep your account secure.</h1>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.75, opacity: .84 }}>
            Reset your password, verify your email or confirm an email change using the secure link sent to you.
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
