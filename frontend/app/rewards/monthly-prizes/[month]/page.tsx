import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readPublishedPrizes } from '@/lib/public-prizes';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  return { title: `Month ${month} Lucky Draw Prizes | MegaGoldenClub` };
}

function approximateValue(value: string, currencyCode: string): string | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currencyCode)) return null;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: currencyCode, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return null;
  }
}

export default async function MonthPrizeDetailsPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const { month: rawMonth } = await params;
  if (!/^(?:[1-9]|[1-5][0-9]|60)$/.test(rawMonth)) notFound();
  const month = Number(rawMonth);
  const catalogue = await readPublishedPrizes();
  const monthCount = catalogue?.season?.totalMonths ?? 18;
  if (month > monthCount) notFound();
  const prizes = (catalogue?.prizes ?? []).filter((prize) => prize.monthNumber === month);
  const label = `Month ${String(month).padStart(2, '0')}`;

  return (
    <main id="main-content" className="mm-rewards-main">
      <section className="mm-prizes-hero mm-prizes-detail-hero" aria-labelledby="mm-prize-detail-heading">
        <div className="mm-rewards-container mm-prizes-detail-hero-inner">
          <div>
            <Link className="mm-prizes-back" href="/rewards/monthly-prizes">‹ All Monthly Prizes</Link>
            <span className="mm-rewards-eyebrow">ACTIVE SEASON PRIZE CATALOGUE</span>
            <h1 id="mm-prize-detail-heading">{label}<br /><span>Lucky Draw Prizes</span></h1>
            <p>View every prize configured for this month in the Admin Prize Catalogue, with available images, descriptions and winner quantities.</p>
            <p className="mm-prizes-hero-disclaimer">These are prize listings, not winner announcements. Participation and prize fulfilment depend on published rules; no prize is guaranteed.</p>
          </div>
          <div className="mm-prizes-detail-medallion" aria-hidden="true"><span>MONTH</span><strong>{String(month).padStart(2, '0')}</strong><small>PRIZE COLLECTION</small></div>
        </div>
      </section>

      <section className="mm-prizes-section mm-rewards-container" aria-labelledby="mm-prize-list-heading">
        <div className="mm-rewards-section-head">
          <span className="mm-rewards-kicker">{catalogue?.season?.name ?? 'MONTHLY PRIZE DETAILS'}</span>
          <h2 id="mm-prize-list-heading">Prizes for <span>{label}.</span></h2>
          <p>{prizes.length === 1 ? '1 prize' : `${prizes.length} prizes`} configured for this month.</p>
        </div>
        {!catalogue?.season ? (
          <p className="mm-prizes-availability mm-prizes-empty" role="status">No active season catalogue is available right now. Check again after season activation.</p>
        ) : prizes.length === 0 ? (
          <p className="mm-prizes-availability mm-prizes-empty" role="status">No active prizes are listed for this month. Please check back later.</p>
        ) : (
          <div className="mm-prizes-detail-grid">
            {prizes.map((prize) => {
              const value = prize.nominalValue ? approximateValue(prize.nominalValue, prize.currencyCode) : null;
              return <article className="mm-prizes-detail-card" key={prize.prizeCode}>
                <div className="mm-prizes-detail-image">
                  {prize.imageMediaId ? (
                    <Image src={`/api/public-prize-media/${prize.imageMediaId}`}
                      alt={prize.name} width={450} height={310} unoptimized />
                  ) : (
                    <div className="mm-prizes-detail-placeholder">
                      <svg aria-hidden="true" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="12" y="26" width="40" height="27" rx="3"/><path d="M9 19h46v11H9M32 19v34M23 19C9 17 12 3 20 4c7 2 12 15 12 15Z"/></svg>
                      <span>No image supplied</span>
                    </div>
                  )}
                </div>
                <div className="mm-prizes-detail-copy">
                  <span className="mm-prizes-detail-category">{prize.category}</span>
                  <h3>{prize.name}</h3>
                  {prize.description && <p>{prize.description}</p>}
                  <dl className="mm-prizes-detail-facts">
                    <div><dt>Planned winners</dt><dd>{prize.winnerCount}</dd></div>
                    {value && <div><dt>Approximate value</dt><dd>{value}</dd></div>}
                  </dl>
                </div>
              </article>;
            })}
          </div>
        )}
        <nav className="mm-prizes-month-navigation" aria-label="Browse monthly prize details">
          {month > 1 && <Link href={`/rewards/monthly-prizes/${month - 1}`}>← Previous month</Link>}
          <Link href="/rewards/monthly-prizes">All monthly prize rounds</Link>
          {month < monthCount && <Link href={`/rewards/monthly-prizes/${month + 1}`}>Next month →</Link>}
        </nav>
      </section>
    </main>
  );
}
