import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { flyerPrizeConcepts, type PrizeConcept } from '../prize-preview';

export const metadata: Metadata = {
  title: 'Monthly Lucky Draw Prize Preview | MegaGoldenClub',
  description: 'Explore the 18-month illustrative prize concepts from the supplied 18-month rewards flyer. Actual season prizes and draw schedules are confirmed only in official published member records.',
};

function PrizeSymbol({ kind }: { kind: PrizeConcept['kind'] }) {
  const shapes: Record<PrizeConcept['kind'], ReactNode> = {
    car: <><path d="M4 15h16l-2-6H6l-2 6Zm2-6 2-4h8l2 4M4 15v3h3v-3m10 0v3h3v-3"/><circle cx="7" cy="15" r="1"/><circle cx="17" cy="15" r="1"/></>,
    scooter: <><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M8 18h5l3-7h-6l-2 7Zm8-7-2-6h4m-5 13h3"/></>,
    bike: <><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m5 18 5-8 4 8h5l-5-8h-4M12 6h5m-7 4-2-4"/></>,
    gold: <><path d="m12 3 8 5v9l-8 5-8-5V8l8-5Z" /><path d="m8 10 4 7 4-7M9 10h6"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{shapes[kind]}</svg>;
}

export default function MonthlyPrizesPage() {
  return (
    <main id="main-content" className="mm-rewards-main">
      <section className="mm-prizes-hero" aria-labelledby="mm-prizes-title">
        <div className="mm-rewards-container mm-prizes-hero-inner">
          <div>
            <Link href="/rewards" className="mm-prizes-back">‹ Awards &amp; Rewards</Link>
            <span className="mm-rewards-eyebrow"><span aria-hidden="true">✦</span> CELEBRATING THE POSSIBILITIES</span>
            <h1 id="mm-prizes-title">Monthly Lucky Draw<br /><span>Prize Preview.</span></h1>
            <p>A visual walk through the prize categories in the original 18-month supplied 18-month rewards flyer. Explore a new concept for every monthly round.</p>
            <p className="mm-prizes-hero-disclaimer"><strong>Illustrative flyer preview only.</strong> Not an official prize announcement, confirmed draw date, winner list or guaranteed benefit.</p>
          </div>
          <div className="mm-prizes-hero-medallion" aria-hidden="true"><span>18</span><small>MONTHLY<br />PREVIEW ROUNDS</small><span className="mm-prizes-hero-twinkle">✦</span></div>
        </div>
      </section>

      <section className="mm-prizes-section mm-rewards-container" aria-labelledby="mm-prizes-grid-title">
        <div className="mm-rewards-section-head">
          <span className="mm-rewards-kicker">THE MONTH-BY-MONTH FLYER CONCEPT</span>
          <h2 id="mm-prizes-grid-title">18 moments to <span>look forward to.</span></h2>
          <p>These category examples are taken from a visual reference flyer. They are not connected to the live prize catalogue, and none is confirmed for a current or future season until officially published.</p>
        </div>
        <div className="mm-prizes-grid">
          {flyerPrizeConcepts.map((prize) => (
            <article className="mm-prizes-card" key={prize.month}>
              <div className={`mm-prizes-card-art mm-prizes-card-art-${prize.kind}`}>
                <span className="mm-prizes-month">MONTH {String(prize.month).padStart(2,'0')}</span>
                <span className="mm-prizes-icon"><PrizeSymbol kind={prize.kind} /></span>
                <span className="mm-prizes-art-shine" aria-hidden="true">✦</span>
              </div>
              <div className="mm-prizes-card-copy">
                <span className="mm-prizes-concept-label">Flyer concept • Not confirmed</span>
                <h3>{prize.headline}</h3>
                <p>{prize.accompanying}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="mm-prizes-terms mm-rewards-container" aria-labelledby="mm-prizes-terms-title">
        <div className="mm-prizes-terms-icon" aria-hidden="true">✦</div>
        <div>
          <h2 id="mm-prizes-terms-title">Where can I see official monthly prizes?</h2>
          <p>The member portal shows your season&apos;s published prize catalogue, official draw schedules, installment-linked token records and verified winning or claim status. Prize selection and winner verification remain controlled by the authorized draw workflow.</p>
          <p>Entry and eligibility depend on confirmed eligible installments and the applicable published program rules. Holding a token does not guarantee a prize.</p>
          <Link href="/login" className="mm-rewards-button mm-rewards-button-dark">Open my member portal <span aria-hidden="true">↗</span></Link>
        </div>
      </section>
    </main>
  );
}
