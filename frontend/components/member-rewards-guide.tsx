'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberHeader } from '@/components/member-header';

type Tier = { code: string; name: string; newDirect: number; newTeam: number; hours: number; cash: string; monthly: string; months: number; trip: string | null };
type Achievement = { tierCode: string; tierName: string; achievedAt: string; cashAmount: string; monthlyAmount: string; monthlyMonths: number; paidMonths: number; tripDescription: string | null; tripStatus: string };
type Prize = { monthNumber: number; prizeCode: string; category: string; name: string; description: string | null; winnerCount: number; nominalValue: string | null; currencyCode: string };
type Draw = { monthNumber: number; status: string; drawAt: string };
type Token = { monthNumber: number; token: string; status: string };
type Season = { id: string; code: string; name: string; status: string; enrolledAt: string; currencyCode: string; rankPolicy: { version: number; tiers: Tier[] } | null; achievements: Achievement[]; prizes: Prize[]; draws: Draw[]; tokens: Token[] };
type Win = { winnerId: string; drawId: string; prizeTierName: string; prizeKind: string; claimStatus: string | null; claimDeadline: string | null; wonAt: string };
type Guide = { seasons: Season[]; wins: Win[] };

function amount(value: string, code: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code || 'INR' }).format(Number(value));
}
function date(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', dateStyle: 'medium' }).format(parsed) : '—';
}
function deadline(hours: number) {
  return hours < 24 ? hours + ' hours after joining' : hours / 24 + ' days after joining';
}

export function MemberRewardsGuide() {
  const router = useRouter();
  const [data, setData] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await apiJson<Guide>('/api/backend/member/rewards-guide'));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) { router.replace('/login'); return; }
      if (reason instanceof ApiClientError && reason.status === 403 && /password/i.test(reason.message)) { router.replace('/member/change-password'); return; }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load rewards and lucky draw');
    } finally { setLoading(false); }
  }, [router]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <div className="mm-member-shell">
    <MemberHeader />
    <main className="mm-member-main">
      <div className="mm-member-hero">
        <div>
          <p className="mm-eyebrow">Member success guide</p>
          <h1 className="mm-title">Rewards & Lucky Draw</h1>
          <p className="mm-subtitle">Learn the published joining-date achievement goals, your earned rewards and official monthwise draw prizes.</p>
          <span className="mm-portal-pill">Season-based official information</span>
        </div>
        <button className="mm-button blue" disabled={loading} type="button" onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {error ? <div className="mm-error" role="alert">{error}</div> : null}
      {data ? data.seasons.length ? data.seasons.map((season) => {
        const months = [...new Set([...season.prizes.map((p) => p.monthNumber), ...season.draws.map((d) => d.monthNumber), ...season.tokens.map((t) => t.monthNumber)])].sort((a,b) => a-b);
        return <div key={season.id}>
          <section className="mm-card mm-reward-guide-card">
            <div className="mm-card-head"><h2>{season.name} — Rank achievement goals</h2><span className="mm-chip">Published policy {season.rankPolicy ? 'v' + season.rankPolicy.version : 'not available'}</span></div>
            <div className="mm-card-body">
              <p>Joined: {date(season.enrolledAt)}. These are the published targets for your session. Each level uses fresh qualified direct and team members from the previous achieved level, with all deadlines anchored to your original paid joining date.</p>
              {season.rankPolicy?.tiers.length ? <div className="mm-reward-guide-grid">{season.rankPolicy.tiers.map((tier) => {
                const achieved = season.achievements.find((item) => item.tierCode === tier.code);
                return <article className="mm-reward-guide-item" key={tier.code}>
                  <h3>{tier.name} {achieved ? <span className="mm-chip success">Achieved</span> : <span className="mm-chip">Target</span>}</h3>
                  <p><strong>{tier.newDirect} new direct</strong> + <strong>{tier.newTeam} new team</strong> members</p>
                  <p>Deadline: {deadline(tier.hours)}</p>
                  <p>Cash bonus: <strong>{amount(tier.cash, season.currencyCode)}</strong></p>
                  {Number(tier.monthly) > 0 ? <p>Monthly income: {amount(tier.monthly, season.currencyCode)} for up to {tier.months} months, subject to eligible payments and rank rules</p> : null}
                  {tier.trip ? <p>Family trip: {tier.trip} (fulfilment is managed by Admin)</p> : null}
                  {achieved ? <p><strong>Achieved {date(achieved.achievedAt)}.</strong> {achieved.monthlyMonths ? achieved.paidMonths + '/' + achieved.monthlyMonths + ' monthly rewards recorded.' : ''} {achieved.tripDescription ? 'Trip status: ' + achieved.tripStatus + '.' : ''}</p> : null}
                </article>;
              })}</div> : <p>No published achievement goals for this session. Unpublished administrative drafts are not shown.</p>}
              <p className="mm-reward-disclaimer">Targets are not guarantees of earnings. Qualification verifies payment, active membership, fresh referrals and timing. Gold and Diamond monthly incomes cannot run simultaneously; qualification follows the published policy version.</p>
              <div className="mm-portal-actions"><Link className="mm-button light" href="/member">My referral ID & invite link</Link><Link className="mm-button light" href="/member/installments">My installment history</Link></div>
            </div>
          </section>

          <section className="mm-card mm-reward-guide-card">
            <div className="mm-card-head"><h2>{season.name} — Monthly Lucky Draw prizes</h2><span className="mm-chip">{months.length} configured months</span></div>
            <div className="mm-card-body">
              <p>Your eligible, confirmed installment creates a permanent token for that month. Winning is determined only after the official draw and verification process—not by merely holding a token.</p>
              {months.length ? <div className="mm-reward-guide-grid">{months.map((month) => {
                const draw = season.draws.find((d) => d.monthNumber === month);
                const prizes = season.prizes.filter((p) => p.monthNumber === month);
                const tokens = season.tokens.filter((t) => t.monthNumber === month);
                return <article className="mm-reward-guide-item" key={month}>
                  <h3>Month {month} <span className="mm-chip">{draw?.status ?? 'Not scheduled'}</span></h3>
                  {draw ? <p>Draw date: <strong>{date(draw.drawAt)}</strong></p> : <p>Official draw date has not been scheduled yet.</p>}
                  <p>Your tokens: <strong>{tokens.length ? tokens.map((t) => t.token).join(', ') : 'No token yet'}</strong></p>
                  <div className="mm-reward-prizes">{prizes.map((prize) => <div key={prize.prizeCode}>
                    <strong>{prize.name}</strong> · {prize.winnerCount} winner{prize.winnerCount === 1 ? '' : 's'}
                    {prize.description ? <p>{prize.description}</p> : null}
                    {prize.nominalValue ? <small>Configured nominal value: {amount(prize.nominalValue, prize.currencyCode)}</small> : null}
                  </div>)}</div>
                  {!prizes.length ? <p>Prize details are not published for this month.</p> : null}
                </article>;
              })}</div> : <p>No published prize schedule is available for this session yet.</p>}
              <p className="mm-reward-disclaimer">The catalogue describes possible prizes; it does not confer an individual benefit. If you win, your verified win and claim will appear below.</p>
              <Link className="mm-button light" href="/member/installments">View installment-linked tokens</Link>
            </div>
          </section>
        </div>;
      }) : <section className="mm-card"><div className="mm-card-body">No active or completed enrolled season found. Rewards become visible after eligible paid registration.</div></section> : loading ? <div className="mm-card mm-empty">Loading member reward information…</div> : null}
      {data ? <section className="mm-card mm-reward-guide-card">
        <div className="mm-card-head"><h2>My Lucky Draw wins & claims</h2><span className="mm-chip">{data.wins.length} wins</span></div>
        <div className="mm-card-body">{data.wins.length ?
          <div className="mm-reward-guide-grid">{data.wins.map((win) => <article className="mm-reward-guide-item" key={win.winnerId}>
            <h3>{win.prizeTierName}</h3><p>Won: {date(win.wonAt)}</p>
            <p>Claim status: <strong>{win.claimStatus ?? 'Awaiting claim registration'}</strong></p>
            {win.claimDeadline ? <p>Claim by: {date(win.claimDeadline)}</p> : null}
          </article>)}</div> : <p>No draw wins recorded yet. You can still follow upcoming draws and your tokens above.</p>}
        </div>
      </section> : null}
    </main>
  </div>;
}
