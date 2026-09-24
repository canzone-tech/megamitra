'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Row = Record<string, unknown>;
type Page<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };
type Dashboard = {
  user: { id: string; username: string; firstName: string | null; lastName: string | null; status: string };
  wallets: Row[];
  enrollments: { counts: Row[]; dues: Row[] };
  referralRewards: Row[];
  binary: { summary: Row; unitQueues: Row[] };
  luckyDraw: { summary: Row; claimCounts: Row[] };
};
type RewardsResponse = { wins: Page<Row>; eligibility: Page<Row> };
type Data = { dashboard: Dashboard; enrollments: Page<Row>; referrals: Page<Row>; rewards: RewardsResponse };

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function money(value: unknown, currency: unknown): string {
  const numeric = Number(value ?? 0);
  const code = typeof currency === 'string' && currency.length === 3 ? currency : '';
  if (!Number.isFinite(numeric)) return `${text(value)} ${code}`.trim();
  try {
    return new Intl.NumberFormat('en-IN', {
      style: code ? 'currency' : 'decimal',
      currency: code || undefined,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${code}`.trim();
  }
}

function countByStatus(rows: Row[], status: string): number {
  const row = rows.find((item) => String(item.status).toUpperCase() === status);
  return Number(row?.count ?? 0);
}

function firstAmount(rows: Row[], field: string): number {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

export function MemberDashboard() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboard, enrollments, referrals, rewards] = await Promise.all([
        apiJson<Dashboard>('/api/backend/member/dashboard'),
        apiJson<Page<Row>>('/api/backend/member/enrollments?page=1&limit=5'),
        apiJson<Page<Row>>('/api/backend/member/referral-rewards?page=1&limit=5'),
        apiJson<RewardsResponse>('/api/backend/member/rewards?page=1&limit=5'),
      ]);
      setData({ dashboard, enrollments, referrals, rewards });
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      if (reason instanceof ApiClientError && reason.status === 403 && reason.message.toLowerCase().includes('password')) {
        router.replace('/member/change-password');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load your dashboard');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const displayName = useMemo(() => {
    if (!data) return '';
    const full = [data.dashboard.user.firstName, data.dashboard.user.lastName].filter(Boolean).join(' ');
    return full || data.dashboard.user.username;
  }, [data]);

  async function logout() {
    await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const primaryWallet = data?.dashboard.wallets[0];
  const dues = data?.dashboard.enrollments.dues ?? [];
  const drawSummary = data?.dashboard.luckyDraw.summary ?? {};
  const binarySummary = data?.dashboard.binary.summary ?? {};

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/member"><span className="mm-brand-mark">M</span><span>Mega<span className="mm-brand-accent">Mitra</span></span></Link>
        <nav className="mm-nav"><Link className="mm-button light" href="/member/withdrawals">Withdrawals</Link><Link className="mm-button light" href="/member/kyc">KYC</Link><Link className="mm-button light" href="/member/security">Security</Link><Link className="mm-button light" href="/">Public site</Link><button className="mm-button" type="button" onClick={() => void logout()}>Sign out</button></nav>
      </header>

      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div><p className="mm-eyebrow">My MegaMitra</p><h1 className="mm-title">{data ? `Hello, ${displayName}` : 'Member dashboard'}</h1><p className="mm-subtitle">Your view is scoped to your authenticated account and derived from authoritative program, ledger and rewards records.</p></div>
          <button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {data ? (
          <>
            <section className="mm-dashboard-grid" aria-label="Member summary">
              <article className="mm-card mm-stat"><div className="mm-stat-label">Wallet balance</div><div className="mm-stat-value">{primaryWallet ? money(primaryWallet.balance, primaryWallet.currencyCode) : '—'}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Outstanding dues</div><div className="mm-stat-value">{money(firstAmount(dues, 'outstandingAmount'), dues[0]?.currencyCode)}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Binary pairs</div><div className="mm-stat-value">{text(binarySummary.pairCount ?? 0)}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Lucky-draw wins</div><div className="mm-stat-value">{text(drawSummary.winnerCount ?? 0)}</div></article>
            </section>

            <div className="mm-wide-grid">
              <section className="mm-card"><div className="mm-card-head"><h2>Program progress</h2><span className="mm-chip">{data.enrollments.total} enrollment{data.enrollments.total === 1 ? '' : 's'}</span></div><div className="mm-card-body">{data.enrollments.items.length ? <div className="mm-list">{data.enrollments.items.map((row) => <div className="mm-list-row" key={text(row.id)}><div><strong>{text(row.programName)}</strong><br /><span>{text(row.status)} · {text(row.enrollmentDate)}</span></div><div style={{ textAlign: 'right' }}><strong>{money(row.outstandingAmount, row.currencyCode)}</strong><br /><span>outstanding</span></div></div>)}</div> : <div className="mm-empty">No program enrollments yet.</div>}</div></section>
              <section className="mm-card"><div className="mm-card-head"><h2>Reward snapshot</h2><span className="mm-chip">Recorded facts</span></div><div className="mm-card-body mm-list"><div className="mm-list-row"><span>Referral rewards</span><strong>{data.referrals.total}</strong></div><div className="mm-list-row"><span>Eligible draw hooks</span><strong>{text(drawSummary.eligibleHookCount ?? 0)}</strong></div><div className="mm-list-row"><span>Draw entries</span><strong>{text(drawSummary.entrantCount ?? 0)}</strong></div><div className="mm-list-row"><span>Open prize claims</span><strong>{countByStatus(data.dashboard.luckyDraw.claimCounts, 'PENDING') + countByStatus(data.dashboard.luckyDraw.claimCounts, 'CLAIMED')}</strong></div></div></section>
            </div>

            <div className="mm-wide-grid">
              <section className="mm-card"><div className="mm-card-head"><h2>Recent referral rewards</h2><span className="mm-chip">{data.referrals.total} total</span></div><div className="mm-card-body">{data.referrals.items.length ? <div className="mm-list">{data.referrals.items.map((row) => <div className="mm-list-row" key={text(row.id)}><div><strong>{text(row.referredUsername)}</strong><br /><span>{text(row.status)}</span></div><strong>{money(row.netRewardAmount, row.currencyCode)}</strong></div>)}</div> : <div className="mm-empty">No referral rewards recorded.</div>}</div></section>
              <section className="mm-card"><div className="mm-card-head"><h2>Lucky-draw outcomes</h2><span className="mm-chip">{data.rewards.wins.total} win{data.rewards.wins.total === 1 ? '' : 's'}</span></div><div className="mm-card-body">{data.rewards.wins.items.length ? <div className="mm-list">{data.rewards.wins.items.map((row) => <div className="mm-list-row" key={text(row.winnerId)}><div><strong>{text(row.prizeTierName)}</strong><br /><span>{text(row.claimStatus ?? 'Awaiting claim record')}</span></div><span>{text(row.prizeKind)}</span></div>)}</div> : <div className="mm-empty">No draw wins recorded.</div>}</div></section>
            </div>
          </>
        ) : loading ? <div className="mm-card mm-empty">Loading your MegaMitra dashboard…</div> : null}
      </main>
    </div>
  );
}
