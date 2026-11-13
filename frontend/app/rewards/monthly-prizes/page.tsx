import type { Metadata } from 'next';
import Link from 'next/link';
import { readPublishedPrizes } from '@/lib/public-prizes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Monthly Lucky Draw Prizes | MegaGoldenClub',
  description: 'Explore every month in the currently active MegaGoldenClub prize catalogue. Prize availability depends on published season rules.',
};

function GiftIcon() {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="11" y="26" width="42" height="27" rx="4"/>
    <path d="M8 19h48v11H8zM32 19v34M23 19C7 17 10 3 20 4c7 2 12 15 12 15Zm18 0C57 17 54 3 44 4c-7 2-12 15-12 15Z"/>
  </svg>;
}

export default async function MonthlyPrizesPage() {
  const catalogue = await readPublishedPrizes();
  const months = catalogue?.season?.totalMonths ?? 18;
  const counts = new Map<number, number>();
  for (const prize of catalogue?.prizes ?? []) {
    counts.set(prize.monthNumber, (counts.get(prize.monthNumber) ?? 0) + 1);
  }

  return (
    <main id="main-content" className="mm-rewards-main">
      <section className="mm-prizes-hero" aria-labelledby="mm-prizes-title">
        <div className="mm-rewards-container mm-prizes-hero-inner">
          <div>
            <Link href="/rewards" className="mm-prizes-back">‹ Awards &amp; Rewards</Link>
            <span className="mm-rewards-eyebrow"><span aria-hidden="true">✦</span> MONTH BY MONTH • REWARDS TO EXPLORE</span>
            <h1 id="mm-prizes-title">Monthly Lucky Draw<br /><span>Prize Catalogue.</span></h1>
            <p>Browse each monthly round and open its detail page to see the prizes configured in the active season&apos;s official prize catalogue.</p>
            <p className="mm-prizes-hero-disclaimer">Eligibility, prize selection and fulfilment follow published season rules. No prize or reward is guaranteed.</p>
          </div>
          <div className="mm-prizes-hero-medallion" aria-hidden="true"><span>{months}</span><small>MONTHLY<br />DRAW ROUNDS</small><span className="mm-prizes-hero-twinkle">✦</span></div>
        </div>
      </section>

      <section className="mm-prizes-section mm-rewards-container" aria-labelledby="mm-prizes-grid-title">
        <div className="mm-rewards-section-head">
          <span className="mm-rewards-kicker">EXPLORE EVERY MONTH</span>
          <h2 id="mm-prizes-grid-title">A moment for <span>every month.</span></h2>
          <p>One clear card for each month. Select View Details to explore that month&apos;s complete prize lineup.</p>
        </div>
        {!catalogue?.season ? (
          <p className="mm-prizes-availability" role="status">No active season prize catalogue is available right now. Confirmed prizes will appear when a season becomes active.</p>
        ) : (
          <p className="mm-prizes-availability" role="status">Showing active season: <strong>{catalogue.season.name}</strong></p>
        )}
        <div className="mm-prizes-grid mm-prizes-month-grid">
          {Array.from({ length: months }, (_, i) => i + 1).map((month) => (
            <article className="mm-prizes-card mm-prizes-month-card" key={month}>
              <div className="mm-prizes-month-art">
                <span className="mm-prizes-month-label">MONTH</span>
                <span className="mm-prizes-month-number">{String(month).padStart(2, '0')}</span>
                <span className="mm-prizes-month-gift"><GiftIcon /></span>
                <span className="mm-prizes-month-spark" aria-hidden="true">✦</span>
              </div>
              <div className="mm-prizes-month-copy">
                <h3>Monthly Lucky Draw</h3>
                <p>{catalogue?.season
                  ? `${counts.get(month) ?? 0} ${counts.get(month) === 1 ? 'prize' : 'prizes'} listed`
                  : 'Details available when published'}</p>
                <Link className="mm-prizes-detail-link" href={`/rewards/monthly-prizes/${month}`}>
                  View Details <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="mm-prizes-terms mm-rewards-container" aria-labelledby="mm-prizes-terms-title">
        <div className="mm-prizes-terms-icon" aria-hidden="true"><GiftIcon /></div>
        <div>
          <h2 id="mm-prizes-terms-title">About your lucky draw participation</h2>
          <p>The public catalogue shows prizes configured for an active season. The member portal is authoritative for your installment-linked tokens, eligibility, draws and claims.</p>
          <p>Winning and fulfilment depend on the official rules. Holding a token does not guarantee a prize.</p>
          <Link href="/login" className="mm-rewards-button mm-rewards-button-dark">Open my member portal <span aria-hidden="true">↗</span></Link>
        </div>
      </section>
    </main>
  );
}
