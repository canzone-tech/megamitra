import Link from 'next/link';
import { SignupForm } from '@/components/signup-form';

export default function MemberSignupPage() {
  return (
    <main className="mm-login-wrap">
      <section className="mm-login-card" aria-labelledby="member-signup-title">
        <div className="mm-login-art">
          <Link className="mm-brand" href="/" style={{ color: 'white' }}>
            <span className="mm-brand-mark">M</span>
            <span>Mega<span style={{ color: '#ffd66e' }}>GoldenClub</span></span>
          </Link>
          <h1 id="member-signup-title">Join with your valid E-PIN.</h1>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.75, opacity: .84 }}>
            Enter your sponsor reference to verify the sponsor before registration. A valid single-use E-PIN is required for every public signup.
          </p>
        </div>
        <div className="mm-login-form">
          <p className="mm-eyebrow">Public member signup</p>
          <h2 className="mm-title" style={{ fontSize: 34 }}>Create your account</h2>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>
            Sponsor details appear automatically when a valid sponsor ID, mobile or email is entered.
          </p>
          <SignupForm />
          <p style={{ marginTop: 24, fontSize: 13, color: 'var(--mm-ink-500)' }}>
            Already registered? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
