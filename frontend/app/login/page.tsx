import Link from 'next/link';
import { LoginForm } from '@/components/login-form';

export default function MemberLoginPage() {
  return (
    <main className="mm-login-wrap">
      <section className="mm-login-card" aria-labelledby="member-login-title">
        <div className="mm-login-art">
          <Link className="mm-brand" href="/" style={{ color: 'white' }}>
            <span className="mm-brand-mark">M</span>
            <span>Mega<span style={{ color: '#ffd66e' }}>GoldenClub</span></span>
          </Link>
          <h1 id="member-login-title">Welcome back to MegaGoldenClub.</h1>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.75, opacity: .84 }}>
            Sign in to check your program progress, payments, rewards, referrals, wallet activity and lucky draw status.
          </p>
        </div>
        <div className="mm-login-form">
          <p className="mm-eyebrow">Member portal</p>
          <h2 className="mm-title" style={{ fontSize: 34 }}>Welcome back</h2>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>Use your MegaGoldenClub account to continue.</p>
          <LoginForm />
          <p style={{ marginTop: 24, fontSize: 13, color: 'var(--mm-ink-500)' }}><Link href="/">← Back to MegaGoldenClub Rewards</Link></p>
        </div>
      </section>
    </main>
  );
}
