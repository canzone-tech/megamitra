import type { Metadata } from 'next';
import Link from 'next/link';
import HomepageMotion from '../components/homepage-motion';

export const metadata: Metadata = {
  title: 'MegaGoldenClub | Your Membership Journey',
  description: 'Discover MegaGoldenClub membership, secure account access, referral tracking, program progress, and published reward eligibility in one member portal.',
};

type HomeIconName = 'arrow' | 'shield' | 'person' | 'ticket' | 'chart' | 'users' | 'gift' | 'wallet' | 'lock' | 'check' | 'compass' | 'spark';

function HomeIcon({ name, size = 22 }: { name: HomeIconName; size?: number }) {
  const paths: Record<HomeIconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.5-7 8-7s8 2.6 8 7" /></>,
    ticket: <><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7Z" /><path d="M13 5v2m0 4v2m0 4v2" /></>,
    chart: <><path d="M3 19h18" /><path d="M6 16v-5m6 5V5m6 11V9" /></>,
    users: <><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    gift: <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18M12 8H8a3 3 0 1 1 3-3c0 1.6 1 3 1 3Zm0 0h4a3 3 0 1 0-3-3c0 1.6-1 3-1 3Z" /></>,
    wallet: <><rect x="2" y="5" width="20" height="15" rx="3" /><path d="M16 13h6M6 5V3h13" /><circle cx="17" cy="13" r="1" /></>,
    lock: <><rect x="4" y="10" width="16" height="12" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
    check: <><path d="m4 12 5 5L20 6" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15 9-2 4-4 2 2-4 4-2Z" /></>,
    spark: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2ZM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z" /></>,
  };

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

const heroSparkles = Array.from({ length: 18 }, (_, index) => index);

const rewardHighlights = [
  { icon: 'ticket', title: 'Monthly draw updates', description: 'Follow your recorded draw entries, published schedules, and official results when available.' },
  { icon: 'gift', title: 'Product benefit records', description: 'See entitlements actually granted to your account, separate from possible draw prizes.' },
  { icon: 'shield', title: 'Clear reward eligibility', description: 'Understand recorded rewards and the published rules that govern participation.' },
] as const;

const memberFeatures = [
  { icon: 'chart', title: 'Membership progress', description: 'Follow your enrollment and installment journey in one organized view.' },
  { icon: 'users', title: 'Referral activity', description: 'See your referral network and the activity tied to your member account.' },
  { icon: 'gift', title: 'Reward records', description: 'Review recorded program rewards and the rules that govern eligibility.' },
  { icon: 'ticket', title: 'Lucky draw entries', description: 'Track eligible entries and published draw results when applicable.' },
  { icon: 'wallet', title: 'Wallet overview', description: 'Review wallet activity and recorded transactions without guesswork.' },
  { icon: 'lock', title: 'Account security', description: 'Manage your sign-in, password, verification, and account safety.' },
] as const;

const questions = [
  {
    question: 'How do I join MegaGoldenClub?',
    answer: 'Open the registration page, provide the requested member details, verify the sponsor reference when using a referral, and complete registration with a valid single-use activation E-PIN.',
  },
  {
    question: 'Can I register through a sponsor link?',
    answer: 'Yes. A sponsor referral link opens the signup page with the sponsor reference prefilled. Confirm the sponsor details shown before submitting your registration.',
  },
  {
    question: 'Are rewards or lucky draw prizes guaranteed?',
    answer: 'No. Participation, reward eligibility, draws, and claims depend on the applicable published program rules, recorded activity, and any required approvals.',
  },
  {
    question: 'Where can I check my progress and account details?',
    answer: 'Sign in to your member portal to view the information available for your account, including enrollment, payment records, referrals, rewards, and security settings.',
  },
] as const;

export default function HomePage() {
  return (
    <div className="mm-home">
      <HomepageMotion />
      <a className="mm-home-skip" href="#main-content">Skip to main content</a>
      <header className="mm-home-header">
        <div className="mm-home-header-inner">
          <Link className="mm-home-brand" href="/" aria-label="MegaGoldenClub home">
            <span className="mm-brand-mark" aria-hidden="true">M</span>
            <span>Mega<span className="mm-home-brand-accent">GoldenClub</span><small>MEMBER EXPERIENCE</small></span>
          </Link>
          <nav className="mm-home-nav" aria-label="Primary navigation">
            <a href="#how-it-works">How it works</a>
            <a className="mm-home-nav-optional" href="#rewards">Rewards</a>
            <a className="mm-home-nav-optional" href="#questions">FAQs</a>
            <Link className="mm-home-nav-login" href="/login">Member login <HomeIcon name="arrow" size={16} /></Link>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <div className="mm-home-hero-wrap">
          <div className="mm-home-sparkle-field" aria-hidden="true">
            {heroSparkles.map((index) => <span className="mm-home-sparkle" key={index} />)}
          </div>
          <div className="mm-home-orb mm-home-orb-one" aria-hidden="true" />
          <div className="mm-home-orb mm-home-orb-two" aria-hidden="true" />
          <section className="mm-home-hero" aria-labelledby="mm-home-hero-title">
            <div className="mm-home-hero-copy">
              <div className="mm-home-hero-eyebrow"><span className="mm-home-eyebrow-dot" /> WELCOME TO MEGAGOLDENCLUB</div>
              <h1 id="mm-home-hero-title">Your membership.<br /><span>Your journey.</span><br />All in one place.</h1>
              <p className="mm-home-hero-lead">
                One thoughtfully designed space to follow your membership, referrals,
                participation records, and rewards journey—with clarity at every step.
              </p>
              <div className="mm-home-hero-actions">
                <Link href="/login" className="mm-home-btn mm-home-btn-primary">Open member portal <HomeIcon name="arrow" size={19} /></Link>
                <Link href="/signup" className="mm-home-btn mm-home-btn-outline">Register with E-PIN</Link>
              </div>
              <div className="mm-home-hero-note"><HomeIcon name="shield" size={17} /> A clear view of your records. Your account stays yours.</div>
            </div>

            <div className="mm-home-preview-area">
              <div className="mm-home-preview-glow" aria-hidden="true" />
              <div className="mm-home-preview" aria-label="Illustration of the MegaGoldenClub member portal">
                <div className="mm-home-preview-top">
                  <span className="mm-home-preview-logo"><span aria-hidden="true">M</span> MEGAGOLDENCLUB</span>
                  <span className="mm-home-preview-dots" aria-hidden="true"><i /><i /><i /></span>
                </div>
                <div className="mm-home-preview-content">
                  <div className="mm-home-preview-greeting">
                    <span className="mm-home-preview-hello">YOUR MEMBER SPACE</span>
                    <strong>Welcome to your journey.</strong>
                    <span>Everything you need, beautifully organized.</span>
                  </div>
                  <div className="mm-home-preview-banner">
                    <div className="mm-home-preview-banner-icon"><HomeIcon name="compass" size={26} /></div>
                    <div><strong>Membership overview</strong><span>Progress, records &amp; activity</span></div>
                    <span className="mm-home-preview-banner-arrow"><HomeIcon name="arrow" size={18} /></span>
                  </div>
                  <div className="mm-home-preview-grid">
                    <div className="mm-home-preview-tile"><span className="mm-home-preview-tile-icon mm-home-preview-tile-blue"><HomeIcon name="chart" size={19} /></span><strong>My progress</strong><span>Enrollment records</span><span className="mm-home-preview-line" aria-hidden="true" /></div>
                    <div className="mm-home-preview-tile"><span className="mm-home-preview-tile-icon mm-home-preview-tile-pink"><HomeIcon name="users" size={19} /></span><strong>My network</strong><span>Referral activity</span><span className="mm-home-preview-line mm-home-preview-line-pink" aria-hidden="true" /></div>
                    <div className="mm-home-preview-tile"><span className="mm-home-preview-tile-icon mm-home-preview-tile-gold"><HomeIcon name="ticket" size={19} /></span><strong>My entries</strong><span>Draw participation</span><span className="mm-home-preview-line mm-home-preview-line-gold" aria-hidden="true" /></div>
                    <div className="mm-home-preview-tile"><span className="mm-home-preview-tile-icon mm-home-preview-tile-green"><HomeIcon name="wallet" size={19} /></span><strong>My records</strong><span>Wallet &amp; activity</span><span className="mm-home-preview-line mm-home-preview-line-green" aria-hidden="true" /></div>
                  </div>
                </div>
              </div>
              <div className="mm-home-preview-caption"><HomeIcon name="spark" size={15} /> Illustrative preview · No member data shown</div>
            </div>
          </section>
        </div>

        <section className="mm-home-assurance" aria-label="What to expect">
          <div><span className="mm-home-assurance-icon"><HomeIcon name="shield" size={22} /></span><span><strong>Verified sponsor details</strong><small>Review before you register</small></span></div>
          <div><span className="mm-home-assurance-icon"><HomeIcon name="lock" size={22} /></span><span><strong>Private member access</strong><small>Your account, your information</small></span></div>
          <div><span className="mm-home-assurance-icon"><HomeIcon name="chart" size={22} /></span><span><strong>Transparent activity</strong><small>Follow your recorded journey</small></span></div>
        </section>

        <section className="mm-home-rewards" id="rewards" aria-labelledby="mm-home-rewards-title">
          <div className="mm-home-rewards-inner">
            <div className="mm-home-rewards-heading" data-home-reveal>
              <div>
                <span className="mm-home-section-eyebrow">REWARDS, MADE CLEAR</span>
                <h2 id="mm-home-rewards-title">Brighter moments.<br /><span>Clearer participation.</span></h2>
              </div>
              <p>From program draws to recorded member benefits, discover the parts of your rewards journey that matter to you.</p>
            </div>
            <div className="mm-home-rewards-grid">
              {rewardHighlights.map(({ icon, title, description }) => (
                <article className="mm-home-reward-card" key={title} data-home-reveal>
                  <span className="mm-home-reward-card-icon"><HomeIcon name={icon} size={26} /></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
            <p className="mm-home-rewards-disclaimer">Prize types, eligibility, entitlements and draw schedules depend on your season&apos;s published rules and your account records. No prize or reward is guaranteed.</p>
          </div>
        </section>

        <section className="mm-home-section mm-home-journey" id="how-it-works" aria-labelledby="mm-home-journey-title">
          <div className="mm-home-section-heading mm-home-section-centered" data-home-reveal>
            <span className="mm-home-section-eyebrow">THE MEMBER JOURNEY</span>
            <h2 id="mm-home-journey-title">A simple path to getting started.</h2>
            <p>From your first registration step to your member dashboard, everything has a place.</p>
          </div>
          <div className="mm-home-steps">
            <article className="mm-home-step" data-home-reveal>
              <div className="mm-home-step-head"><span className="mm-home-step-number">01</span><span className="mm-home-step-symbol"><HomeIcon name="person" size={25} /></span></div>
              <h3>Start with your sponsor</h3>
              <p>Follow a referral link or enter a sponsor reference, then review the details displayed during signup.</p>
            </article>
            <article className="mm-home-step" data-home-reveal>
              <div className="mm-home-step-head"><span className="mm-home-step-number">02</span><span className="mm-home-step-symbol"><HomeIcon name="ticket" size={25} /></span></div>
              <h3>Complete your registration</h3>
              <p>Provide your member details and use a valid single-use E-PIN to complete the registration process.</p>
            </article>
            <article className="mm-home-step" data-home-reveal>
              <div className="mm-home-step-head"><span className="mm-home-step-number">03</span><span className="mm-home-step-symbol"><HomeIcon name="compass" size={25} /></span></div>
              <h3>Explore your member space</h3>
              <p>Sign in to follow progress, referrals, recorded benefits, account activity, and security settings.</p>
            </article>
          </div>
          <div className="mm-home-journey-link"><Link href="/signup">Explore member registration <HomeIcon name="arrow" size={17} /></Link></div>
        </section>

        <section className="mm-home-section mm-home-features-section" id="features" aria-labelledby="mm-home-features-title">
          <div className="mm-home-features-heading" data-home-reveal>
            <div className="mm-home-section-heading">
              <span className="mm-home-section-eyebrow">ONE CONNECTED MEMBER SPACE</span>
              <h2 id="mm-home-features-title">Your important details,<br /><span>thoughtfully organized.</span></h2>
            </div>
            <p>No jumping between disconnected screens. Your portal brings together the records relevant to your membership and program.</p>
          </div>
          <div className="mm-home-features-grid">
            {memberFeatures.map((feature) => (
              <article className="mm-home-feature-card" key={feature.title} data-home-reveal>
                <span className="mm-home-feature-icon"><HomeIcon name={feature.icon} size={25} /></span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
          <p className="mm-home-feature-footnote">Availability of individual features, rewards, draws and actions depends on your account status and applicable published program rules.</p>
        </section>

        <section className="mm-home-promise" aria-labelledby="mm-home-promise-title">
          <div className="mm-home-promise-art" aria-hidden="true"><div className="mm-home-promise-ring"><HomeIcon name="shield" size={62} /></div></div>
          <div className="mm-home-promise-copy" data-home-reveal>
            <span className="mm-home-section-eyebrow">BUILT AROUND TRUST</span>
            <h2 id="mm-home-promise-title">Clarity matters.<br /><span>So does your confidence.</span></h2>
            <p>Your member portal should help you understand your participation and protect your account—not make promises it cannot support.</p>
            <ul>
              <li><HomeIcon name="check" size={17} /> Program participation and reward eligibility follow published rules.</li>
              <li><HomeIcon name="check" size={17} /> Recorded payments, draws and account activity are visible where applicable.</li>
              <li><HomeIcon name="check" size={17} /> Keep your password private and use official member sign-in.</li>
            </ul>
          </div>
        </section>

        <section className="mm-home-section mm-home-faq-section" id="questions" aria-labelledby="mm-home-faq-title">
          <div className="mm-home-faq-intro" data-home-reveal>
            <span className="mm-home-section-eyebrow">GOOD TO KNOW</span>
            <h2 id="mm-home-faq-title">Questions before<br />you begin?</h2>
            <p>Here are a few helpful answers about joining and using the member portal.</p>
            <Link href="/login" className="mm-home-faq-link">Already a member? Sign in <HomeIcon name="arrow" size={17} /></Link>
          </div>
          <div className="mm-home-faq-list" data-home-reveal>
            {questions.map(({ question, answer }) => (
              <details className="mm-home-faq-item" key={question}>
                <summary>{question}<span className="mm-home-faq-plus" aria-hidden="true" /></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mm-home-last-cta" data-home-reveal aria-labelledby="mm-home-last-cta-title">
          <div>
            <span className="mm-home-section-eyebrow">YOUR NEXT STEP</span>
            <h2 id="mm-home-last-cta-title">Ready to begin your journey?</h2>
            <p>Welcome to a clearer, more connected member experience.</p>
          </div>
          <div className="mm-home-last-actions">
            <Link href="/signup" className="mm-home-btn mm-home-btn-white">Register with E-PIN <HomeIcon name="arrow" size={18} /></Link>
            <Link href="/login" className="mm-home-btn mm-home-btn-ghost">Member login</Link>
          </div>
        </section>
      </main>

      <footer className="mm-home-footer">
        <div className="mm-home-footer-upper">
          <Link className="mm-home-brand mm-home-brand-footer" href="/" aria-label="MegaGoldenClub home"><span className="mm-brand-mark" aria-hidden="true">M</span><span>Mega<span className="mm-home-brand-accent">GoldenClub</span><small>MEMBER EXPERIENCE</small></span></Link>
          <nav aria-label="Footer navigation"><Link href="/signup">Registration</Link><Link href="/login">Member login</Link><Link href="/forgot-password">Account recovery</Link><a href="#questions">FAQs</a></nav>
        </div>
        <div className="mm-home-footer-lower">
          <span>© {new Date().getFullYear()} MegaGoldenClub. Member participation portal.</span>
          <span>Program benefits are subject to eligibility and published terms. No reward is guaranteed.</span>
        </div>
      </footer>
    </div>
  );
}
