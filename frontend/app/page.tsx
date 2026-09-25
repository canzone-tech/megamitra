import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      <header className="mm-site-header">
        <Link className="mm-brand" href="/">
          <span className="mm-brand-mark">M</span>
          <span>Mega<span className="mm-brand-accent">GoldenClub</span> Rewards</span>
        </Link>
        <nav className="mm-nav" aria-label="Primary navigation">
          <Link className="mm-button light" href="#how-it-works">How it works</Link>
          <Link className="mm-button" href="/login">Member sign in</Link>
        </nav>
      </header>

      <main className="mm-public-main">
        <section className="mm-public-hero">
          <div>
            <span className="mm-kicker">Rewards • progress • community</span>
            <h1>Your progress. <span className="mm-gradient-word">Your rewards.</span> One place.</h1>
            <p>
              MegaGoldenClub helps you keep track of your participation, payments, referrals, rewards, lucky draws and prize claims in one simple member experience.
            </p>
            <div className="mm-actions">
              <Link className="mm-button" href="/login">Open member portal</Link>
              <a className="mm-button blue" href="#how-it-works">Explore the journey</a>
            </div>
          </div>

          <div className="mm-reward-panel" aria-label="MegaGoldenClub member experience highlights">
            <span className="mm-reward-ribbon">MegaGoldenClub Rewards</span>
            <h2>One clear view of your journey.</h2>
            <p className="mm-subtitle">See the information that applies to your account and program.</p>
            <div className="mm-pill-grid">
              <div className="mm-feature-pill"><strong>Program progress</strong><span>Enrollment and payment status.</span></div>
              <div className="mm-feature-pill"><strong>Reward history</strong><span>Referral and binary reward activity.</span></div>
              <div className="mm-feature-pill"><strong>Lucky draws</strong><span>Entries, results and claim status.</span></div>
              <div className="mm-feature-pill"><strong>Wallet</strong><span>Current balance and transaction history.</span></div>
            </div>
          </div>
        </section>

        <section className="mm-section" id="how-it-works">
          <span className="mm-kicker">Member journey</span>
          <h2>Everything important, easy to follow.</h2>
          <p className="mm-section-lead">From joining a program to receiving rewards, your portal keeps each step organized and visible.</p>
          <div className="mm-three">
            <article className="mm-story-card"><b>1</b><h3>Participate</h3><p>Follow your enrollment and payments.</p></article>
            <article className="mm-story-card"><b>2</b><h3>Qualify</h3><p>See your referral, binary and draw eligibility as it updates.</p></article>
            <article className="mm-story-card"><b>3</b><h3>Receive</h3><p>Track rewards, draw results and prize claims.</p></article>
          </div>
        </section>
      </main>
    </>
  );
}
