import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Awards & Rewards | MegaGoldenClub',
  description: 'Explore MegaGoldenClub achievement recognition and a clearly labelled preview of monthly lucky draw prizes. Actual eligibility and awards depend on official published rules.',
};

const recognition = [
  { number: '01', label: 'Achievement milestones', title: 'Progress worth recognizing', description: 'Learn about the Lightning Start, Bronze, Silver, Gold and Diamond progression. Qualification depends on the published version for your season.' },
  { number: '02', label: 'Lucky draw participation', title: 'A new reason to celebrate', description: 'Explore the 18-month flyer concept and check your own eligible installment-linked draw entries securely in the member portal.' },
  { number: '03', label: 'Member product benefits', title: 'Meaningful benefits, clearly recorded', description: 'Any granted product entitlement is recorded against your account, separate from a possible lucky draw prize.' },
] as const;

type MilestoneIconName = 'bolt' | 'bronze' | 'silver' | 'gold' | 'diamond';

// Presentation-only snapshot of approved RANK-01–03 reference rules.
 // Real qualification and published values are owned by the backend season policy.
const milestones = [
  { name: 'Lightning Start', icon: 'bolt', direct: 4, team: 0, deadline: '4 hours', cash: '₹1,000', trip: null, monthly: null },
  { name: 'Bronze', icon: 'bronze', direct: 10, team: 40, deadline: '20 days', cash: '₹5,000', trip: null, monthly: null },
  { name: 'Silver', icon: 'silver', direct: 25, team: 100, deadline: '30 days', cash: '₹10,000', trip: 'Goa family trip', monthly: null },
  { name: 'Gold', icon: 'gold', direct: 50, team: 250, deadline: '60 days', cash: '₹20,000', trip: 'Ooty family trip', monthly: '₹2,000/month up to 18 months, stopping on Diamond achievement' },
  { name: 'Diamond', icon: 'diamond', direct: 100, team: 500, deadline: '90 days', cash: '₹50,000', trip: 'Shimla family trip', monthly: '₹5,000/month up to 18 months after Diamond achievement' },
] as const satisfies ReadonlyArray<{
  name: string; icon: MilestoneIconName; direct: number; team: number;
  deadline: string; cash: string; trip: string | null; monthly: string | null;
}>;

function MilestoneIcon({ name }: { name: MilestoneIconName }) {
  const paths: Record<MilestoneIconName, ReactNode> = {
    bolt: <path d="M13 2 5 13h7l-1 9 8-11h-7l1-9Z" />,
    bronze: <><circle cx="12" cy="12" r="8" /><path d="m9 8 3 2 3-2M9 16l3-2 3 2" /></>,
    silver: <><path d="m12 2 2.8 6.9L22 12l-7.2 3.1L12 22l-2.8-6.9L2 12l7.2-3.1L12 2Z" /></>,
    gold: <><path d="M6 3h12v9a6 6 0 0 1-12 0V3ZM6 5H3v4a4 4 0 0 0 4 4m11-8h3v4a4 4 0 0 1-4 4M12 18v3m-5 0h10" /></>,
    diamond: <><path d="M3 9 8 3h8l5 6-9 12L3 9Z" /><path d="M3 9h18M8 3l4 18 4-18" /></>,
  };
  return <svg aria-hidden="true" width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function AwardsAndRewardsPage() {
  return (
    <main id="main-content" className="mm-rewards-main">
      <section className="mm-rewards-hero" aria-labelledby="mm-rewards-title">
        <div className="mm-rewards-container mm-rewards-hero-inner">
          <div className="mm-rewards-hero-copy">
            <span className="mm-rewards-eyebrow"><span aria-hidden="true">✦</span> RECOGNITION THAT INSPIRES</span>
            <h1 id="mm-rewards-title">Awards &amp; <span>Rewards.</span><br />A journey worth celebrating.</h1>
            <p>From meaningful milestones to monthly lucky draw excitement, explore the different ways MegaGoldenClub recognizes participation — with clear rules and no unrealistic promises.</p>
            <div className="mm-rewards-actions">
              <Link className="mm-rewards-button mm-rewards-button-primary" href="/rewards/monthly-prizes">Explore monthly prizes <span aria-hidden="true">↗</span></Link>
              <Link className="mm-rewards-button mm-rewards-button-outline" href="/login">View my official rewards</Link>
            </div>
            <p className="mm-rewards-hero-note">Actual prizes, qualified rewards and dates are determined only by official, published season rules and records.</p>
          </div>
          <div className="mm-rewards-hero-visual" aria-hidden="true">
            <div className="mm-rewards-visual-ring mm-rewards-visual-ring-outer" />
            <div className="mm-rewards-visual-ring mm-rewards-visual-ring-inner" />
            <svg viewBox="0 0 240 240" className="mm-rewards-trophy" fill="none">
              <path d="M91 57h58v62a29 29 0 0 1-58 0V57Z" stroke="currentColor" strokeWidth="8" strokeLinejoin="round"/>
              <path d="M91 67H66v23c0 18 12 28 30 29M149 67h25v23c0 18-12 28-30 29M120 148v25m-29 14h58m-48-14h38" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="m120 75 7 16 18 1-14 11 5 18-16-10-16 10 5-18-14-11 18-1 7-16Z" fill="currentColor" opacity=".8"/>
            </svg>
            <span className="mm-rewards-visual-star mm-rewards-visual-star-one">✦</span>
            <span className="mm-rewards-visual-star mm-rewards-visual-star-two">✧</span>
            <span className="mm-rewards-visual-star mm-rewards-visual-star-three">✦</span>
            <span className="mm-rewards-visual-caption">MILESTONES • MOMENTS • MEMORIES</span>
          </div>
        </div>
      </section>

      <section className="mm-rewards-section mm-rewards-container" aria-labelledby="mm-rewards-pathways-title">
        <div className="mm-rewards-section-head">
          <span className="mm-rewards-kicker">A MORE REWARDING EXPERIENCE</span>
          <h2 id="mm-rewards-pathways-title">More than a prize.<br /><span>Every milestone matters.</span></h2>
          <p>Three different experiences, one clear place to discover them. Each operates under its own official eligibility and publication rules.</p>
        </div>
        <div className="mm-rewards-pathways">
          {recognition.map((item) => (
            <article className="mm-rewards-pathway" key={item.number}>
              <div className="mm-rewards-pathway-top"><span>{item.number}</span><span aria-hidden="true">✦</span></div>
              <span className="mm-rewards-pathway-label">{item.label}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mm-rewards-milestones" aria-labelledby="mm-rewards-milestones-title">
        <div className="mm-rewards-container">
          <div className="mm-rewards-section-head">
            <span className="mm-rewards-kicker">ACHIEVEMENT RECOGNITION</span>
            <h2 id="mm-rewards-milestones-title">A progression of <span>possibilities.</span></h2>
            <p>Explore original reference qualification targets, joining-date deadlines and possible benefits for each level. These are examples, not a live-season offer or guaranteed earnings; published season policy takes precedence.</p>
          </div>
          <div className="mm-rewards-tier-row">
            {milestones.map((tier) => (
              <article className="mm-rewards-tier" key={tier.name}>
                <div className="mm-rewards-tier-heading">
                  <span className="mm-rewards-tier-symbol" aria-hidden="true"><MilestoneIcon name={tier.icon} /></span>
                  <div><span className="mm-rewards-tier-label">Reference milestone</span><h3>{tier.name}</h3></div>
                </div>
                <dl className="mm-rewards-tier-details">
                  <div><dt>New qualified direct</dt><dd>{tier.direct} members</dd></div>
                  {tier.team ? <div><dt>New qualified team</dt><dd>{tier.team} members</dd></div> : null}
                  <div><dt>Deadline from paid joining</dt><dd>Within {tier.deadline}</dd></div>
                  <div className="mm-rewards-tier-cash"><dt>Reference cash bonus</dt><dd>{tier.cash}</dd></div>
                </dl>
                {tier.trip ? <p className="mm-rewards-tier-extra"><span>Family trip</span><strong>{tier.trip}</strong></p> : null}
                {tier.monthly ? <p className="mm-rewards-tier-extra"><span>Reference monthly benefit</span><strong>{tier.monthly}</strong></p> : null}
              </article>
            ))}
          </div>
          <aside className="mm-rewards-rules-note" aria-label="Achievement reference rules">
            <strong>How qualification works in the reference program</strong>
            <p>All deadlines begin at the original paid joining timestamp. Each level needs fresh active paid qualified direct and sponsor-tree team members, not people counted at earlier levels. Missing Lightning Start does not block Bronze.</p>
            <p>Gold and Diamond monthly rewards are mutually exclusive and never simultaneous: Gold stops on Diamond achievement. Trips require separate fulfilment. Your published season policy and recorded results are authoritative; no reward or income is guaranteed.</p>
            <Link className="mm-rewards-policy-link" href="/login">View my official published rank policy and achievements <span aria-hidden="true">↗</span></Link>
          </aside>
        </div>
      </section>

      <section className="mm-rewards-monthly-feature" aria-labelledby="mm-rewards-monthly-feature-title">
        <div className="mm-rewards-container mm-rewards-monthly-feature-inner">
          <div>
            <span className="mm-rewards-kicker">18 MONTHS • FLYER CONCEPT</span>
            <h2 id="mm-rewards-monthly-feature-title">Monthly Lucky Draw <span>Prize Preview.</span></h2>
            <p>Explore the month-by-month prize ideas shown in the supplied 18-month rewards flyer — scooters, gold jewellery, cars, motorbikes and more. This is an illustrative visual preview, not an official, live prize announcement.</p>
            <Link className="mm-rewards-button mm-rewards-button-primary" href="/rewards/monthly-prizes">Explore 18 months <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="mm-rewards-monthly-feature-art" aria-hidden="true">
            <div className="mm-rewards-gift-box"><span className="mm-rewards-gift-knot">✦</span><span className="mm-rewards-gift-lid" /><span className="mm-rewards-gift-body" /></div>
            <strong>18</strong><span>MONTHLY CONCEPT ROUNDS</span>
          </div>
        </div>
      </section>
      <section className="mm-rewards-footer-note mm-rewards-container">
        <h2>The official view is always yours.</h2>
        <p>Sign in to see published prize information for your actual season, installment-linked tokens, and any verified wins or claims. A preview is not a draw entry, a promise or a substitute for official records.</p>
        <Link href="/login" className="mm-rewards-button mm-rewards-button-dark">Member login <span aria-hidden="true">↗</span></Link>
      </section>
    </main>
  );
}
