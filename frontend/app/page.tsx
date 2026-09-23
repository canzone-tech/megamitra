import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      <header className="mm-site-header">
        <Link className="mm-brand" href="/">
          <span className="mm-brand-mark">M</span>
          <span>Mega<span className="mm-brand-accent">Mitra</span> Rewards</span>
        </Link>
        <nav className="mm-nav" aria-label="Primary navigation">
          <Link className="mm-button light" href="#how-it-works">How it works</Link>
          <Link className="mm-button" href="/login">Member sign in</Link>
        </nav>
      </header>

      <main className="mm-public-main">
        <section className="mm-public-hero">
          <div>
            <span className="mm-kicker">Rewards • transparency • community</span>
            <h1>Small steps. <span className="mm-gradient-word">Brighter rewards.</span></h1>
            <p>
              MegaMitra brings program participation, payments, qualification, referrals, lucky draws and prize fulfillment into one auditable member experience. Your dashboard shows facts recorded by the platform—not promotional estimates.
            </p>
            <div className="mm-actions">
              <Link className="mm-button" href="/login">Open member portal</Link>
              <a className="mm-button blue" href="#how-it-works">Explore the journey</a>
            </div>
          </div>

          <div className="mm-reward-panel" aria-label="MegaMitra member experience highlights">
            <span className="mm-reward-ribbon">MegaMitra Rewards</span>
            <h2>One clear view of your participation.</h2>
            <p className="mm-subtitle">Commercial values and eligibility come from published policies; the website does not invent them.</p>
            <div className="mm-pill-grid">
              <div className="mm-feature-pill"><strong>Program progress</strong><span>Enrollment, dues and payment facts.</span></div>
              <div className="mm-feature-pill"><strong>Reward history</strong><span>Referral and binary outcomes with immutable records.</span></div>
              <div className="mm-feature-pill"><strong>Lucky draws</strong><span>Eligibility, entries, wins and claim status.</span></div>
              <div className="mm-feature-pill"><strong>Wallet truth</strong><span>Balance derived from the financial ledger.</span></div>
            </div>
          </div>
        </section>

        <section className="mm-section" id="how-it-works">
          <span className="mm-kicker">Member journey</span>
          <h2>Designed around recorded facts.</h2>
          <p className="mm-section-lead">MegaMitra keeps participation, reward calculation, draw selection and fulfillment as separate auditable stages. Your portal reads those authoritative records without creating hidden business rules.</p>
          <div className="mm-three">
            <article className="mm-story-card"><b>1</b><h3>Participate</h3><p>See your enrollment and payment status from the configured program version you joined.</p></article>
            <article className="mm-story-card"><b>2</b><h3>Qualify</h3><p>Track referral, binary and draw eligibility only when published policies create those facts.</p></article>
            <article className="mm-story-card"><b>3</b><h3>Receive</h3><p>View reward postings, draw outcomes, prize claims and fulfillment without rewriting history.</p></article>
          </div>
        </section>
      </main>
    </>
  );
}
