import Link from 'next/link';
import { LoginForm } from '@/components/login-form';

export default function MemberLoginPage() {
  return (
    <main className="mm-login-wrap">
      <section className="mm-login-card" aria-labelledby="member-login-title">
        <div className="mm-login-art">
          <Link className="mm-brand" href="/" style={{ color: 'white' }}>
            <span className="mm-brand-mark">M</span>
            <span>Mega<span style={{ color: '#ffd66e' }}>Mitra</span></span>
          </Link>
          <h1 id="member-login-title">Your rewards journey, clearly recorded.</h1>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.75, opacity: .84 }}>
            Sign in to see program progress, wallet ledger activity, referral rewards, binary outcomes and lucky-draw status tied to your own account.
          </p>
        </div>
        <div className="mm-login-form">
          <p className="mm-eyebrow">Member portal</p>
          <h2 className="mm-title" style={{ fontSize: 34 }}>Welcome back</h2>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>Credentials are verified by MegaGoldenClub API and session tokens remain in HttpOnly cookies.</p>
          <LoginForm />
          <p style={{ marginTop: 24, fontSize: 13, color: 'var(--mm-ink-500)' }}><Link href="/">← Back to MegaGoldenClub Rewards</Link></p>
        </div>
      </section>
    </main>
  );
}
