'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
type BinaryResponse = { queueSummary: Row[]; settlements: Page<Row>; pairMatches: Page<Row> };
type PortalOverview = {
  dashboard: Dashboard;
  enrollments: Page<Row>;
  walletHistory: Page<Row>;
  referralRewards: Page<Row>;
  binary: BinaryResponse;
  rewards: RewardsResponse;
  directReferralCount: number;
  enrollmentProgress: Row[];
  binaryPlanContext: Row[];
};
type WithdrawalOverview = {
  currencyCode: string;
  wallet: Row;
  requests: Row[];
};
type EntitlementOverview = { items: Row[]; counts: Row[] };
type Data = PortalOverview & {
  withdrawals: WithdrawalOverview | null;
  entitlements: EntitlementOverview | null;
};

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, currency: unknown): string {
  const amount = numeric(value);
  const code = typeof currency === 'string' && currency.length === 3 ? currency : '';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: code ? 'currency' : 'decimal',
      currency: code || undefined,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`.trim();
  }
}

function dateTime(value: unknown): string {
  if (typeof value !== 'string') return text(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function countByStatus(rows: Row[], status: string): number {
  const row = rows.find((item) => String(item.status).toUpperCase() === status);
  return numeric(row?.count);
}

function firstAmount(rows: Row[], field: string): number {
  return rows.reduce((sum, row) => sum + numeric(row[field]), 0);
}

function statusTone(status: unknown): string {
  const value = String(status ?? '').toUpperCase();
  if (['PAID', 'FULFILLED', 'APPROVED', 'POSTED', 'ELIGIBLE', 'COMPLETED'].includes(value)) return 'success';
  if (['REJECTED', 'CANCELLED', 'PAYOUT_FAILED', 'FAILED', 'EXPIRED'].includes(value)) return 'danger';
  if (['REQUESTED', 'APPROVED_PENDING', 'PROCESSING', 'PENDING', 'CLAIMED'].includes(value)) return 'warning';
  return '';
}

function entitlementCount(data: EntitlementOverview | null, status: string): number {
  return numeric(data?.counts.find((row) => String(row.status).toUpperCase() === status)?.count);
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
      const overview = await apiJson<PortalOverview>('/api/backend/member/portal-overview');
      const primaryCurrency =
        typeof overview.dashboard.wallets[0]?.currencyCode === 'string'
          ? String(overview.dashboard.wallets[0].currencyCode)
          : 'INR';
      const [withdrawals, entitlements] = await Promise.all([
        apiJson<WithdrawalOverview>(
          `/api/backend/withdrawals/me?currencyCode=${encodeURIComponent(primaryCurrency)}`,
        ),
        apiJson<EntitlementOverview>('/api/backend/entitlements/me'),
      ]);
      setData({ ...overview, withdrawals, entitlements });
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      if (
        reason instanceof ApiClientError &&
        reason.status === 403 &&
        reason.message.toLowerCase().includes('password')
      ) {
        router.replace('/member/change-password');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load your dashboard');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
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
  const latestSettlement = data?.binary.settlements.items[0] ?? {};
  const latestPlanVersionId = String(
    latestSettlement.planVersionId ?? data?.binary.queueSummary[0]?.planVersionId ?? '',
  );
  const binaryContext =
    data?.binaryPlanContext.find((row) => String(row.planVersionId) === latestPlanVersionId) ??
    data?.binaryPlanContext[0] ??
    {};
  const leftQueue = data?.binary.queueSummary.find((row) => String(row.side) === 'LEFT') ?? {};
  const rightQueue = data?.binary.queueSummary.find((row) => String(row.side) === 'RIGHT') ?? {};
  const qualifyingUnit = numeric(binaryContext.qualifyingUnit);
  const leftAvailableUnits = numeric(leftQueue.availableUnits);
  const rightAvailableUnits = numeric(rightQueue.availableUnits);
  const dailyPairCap =
    binaryContext.dailyPairCap === null || binaryContext.dailyPairCap === undefined
      ? null
      : numeric(binaryContext.dailyPairCap);
  const configuredPairPayout = numeric(binaryContext.pairPayoutAmount);
  const dailyEarningCap = dailyPairCap === null ? null : dailyPairCap * configuredPairPayout;
  const latestWithdrawal = data?.withdrawals?.requests[0];

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/member">
          <span className="mm-brand-mark">M</span>
          <span>Mega<span className="mm-brand-accent">Mitra</span></span>
        </Link>
        <nav className="mm-nav" aria-label="Member navigation">
          <Link className="mm-button light" href="/member/entitlements">Products</Link>
          <Link className="mm-button light" href="/member/withdrawals">Withdrawals</Link>
          <Link className="mm-button light" href="/member/kyc">KYC</Link>
          <Link className="mm-button light" href="/member/security">Security</Link>
          <Link className="mm-button light" href="/">Public site</Link>
          <button className="mm-button" type="button" onClick={() => void logout()}>Sign out</button>
        </nav>
      </header>

      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div>
            <p className="mm-eyebrow">My MegaMitra</p>
            <h1 className="mm-title">{data ? `Hello, ${displayName}` : 'Member dashboard'}</h1>
            <p className="mm-subtitle">Program progress, binary settlement, wallet, referrals, payouts and rewards from your authenticated MegaMitra records.</p>
            <span className="mm-portal-pill">Authoritative account view</span>
          </div>
          <button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}

        {data ? (
          <>
            <section className="mm-dashboard-grid" aria-label="Member summary">
              <article className="mm-card mm-stat">
                <div className="mm-stat-label">Wallet balance</div>
                <div className="mm-stat-value">{primaryWallet ? money(primaryWallet.balance, primaryWallet.currencyCode) : '—'}</div>
                <span className="mm-metric-detail">Immutable ledger balance</span>
              </article>
              <article className="mm-card mm-stat">
                <div className="mm-stat-label">Outstanding dues</div>
                <div className="mm-stat-value">{money(firstAmount(dues, 'outstandingAmount'), dues[0]?.currencyCode)}</div>
                <span className="mm-metric-detail">Across active program obligations</span>
              </article>
              <article className="mm-card mm-stat">
                <div className="mm-stat-label">Payable binary pairs</div>
                <div className="mm-stat-value">{text(binarySummary.payablePairCount ?? 0)}</div>
                <span className="mm-metric-detail">{money(binarySummary.payoutAmount, latestSettlement.currencyCode ?? binaryContext.currencyCode)} recorded payout</span>
              </article>
              <article className="mm-card mm-stat">
                <div className="mm-stat-label">Available to withdraw</div>
                <div className="mm-stat-value">{data.withdrawals ? money(data.withdrawals.wallet.availableBalance, data.withdrawals.currencyCode) : '—'}</div>
                <span className="mm-metric-detail">After pending payout reservations</span>
              </article>
            </section>

            <div className="mm-portal-grid">
              <section className="mm-card">
                <div className="mm-card-head">
                  <h2>Binary performance</h2>
                  <span className="mm-chip">Published plan context</span>
                </div>
                <div className="mm-card-body">
                  <div className="mm-portal-metrics">
                    <div className="mm-portal-metric"><span>Left available</span><strong>{leftAvailableUnits} unit{leftAvailableUnits === 1 ? '' : 's'}</strong><small>{qualifyingUnit ? `${text(leftAvailableUnits * qualifyingUnit)} qualified volume` : 'Current qualifying queue'}</small></div>
                    <div className="mm-portal-metric"><span>Right available</span><strong>{rightAvailableUnits} unit{rightAvailableUnits === 1 ? '' : 's'}</strong><small>{qualifyingUnit ? `${text(rightAvailableUnits * qualifyingUnit)} qualified volume` : 'Current qualifying queue'}</small></div>
                    <div className="mm-portal-metric"><span>Latest matched / paid</span><strong>{text(latestSettlement.pairCountCalculated ?? 0)} / {text(latestSettlement.pairCountPayable ?? 0)}</strong><small>{latestSettlement.settlementLocalDate ? `Settlement ${text(latestSettlement.settlementLocalDate)}` : 'No settlement recorded yet'}</small></div>
                    <div className="mm-portal-metric"><span>Latest earnings</span><strong>{money(latestSettlement.payoutAmount, latestSettlement.currencyCode ?? binaryContext.currencyCode)}</strong><small>{dailyEarningCap === null ? 'No daily pair cap configured' : `Daily cap ${money(dailyEarningCap, binaryContext.currencyCode)}`}</small></div>
                    <div className="mm-portal-metric"><span>Carry forward · left</span><strong>{text(latestSettlement.leftUnitsCarryAfter ?? leftAvailableUnits)}</strong><small>{Boolean(binaryContext.carryForwardEnabled) ? 'Carry-forward enabled' : 'Current available units'}</small></div>
                    <div className="mm-portal-metric"><span>Carry forward · right</span><strong>{text(latestSettlement.rightUnitsCarryAfter ?? rightAvailableUnits)}</strong><small>{dailyPairCap === null ? 'Daily pair cap: unlimited' : `Daily pair cap: ${dailyPairCap}`}</small></div>
                  </div>
                </div>
              </section>

              <section className="mm-card">
                <div className="mm-card-head"><h2>Program progress</h2><span className="mm-chip">{data.enrollments.total} enrollment{data.enrollments.total === 1 ? '' : 's'}</span></div>
                <div className="mm-card-body">
                  {data.enrollments.items.length ? <div className="mm-list">{data.enrollments.items.map((row) => {
                    const progress = data.enrollmentProgress.find((item) => String(item.enrollmentId) === String(row.id)) ?? {};
                    const totalInstallments = numeric(row.installmentCountSnapshot ?? progress.installmentCount);
                    const paidInstallments = numeric(progress.paidInstallments);
                    const obligation = numeric(row.registrationFeeSnapshot) + numeric(row.installmentAmountSnapshot) * totalInstallments;
                    const netPaid = Math.max(0, numeric(row.appliedAmount) - numeric(row.refundedAmount));
                    const progressPercent = obligation > 0 ? Math.min(100, Math.max(0, (netPaid / obligation) * 100)) : 0;
                    return <div className="mm-list-row" key={text(row.id)} style={{ display: 'block' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}><div><strong>{text(row.programName)}</strong><br /><span>{text(row.status)} · enrolled {text(row.enrollmentDate)}</span></div><div style={{ textAlign: 'right' }}><strong>{paidInstallments}/{totalInstallments} installments</strong><br /><span>{money(row.outstandingAmount, row.currencyCode)} outstanding</span></div></div>
                      <div className="mm-progress-track" aria-label={`${Math.round(progressPercent)} percent financial progress`}><div className="mm-progress-fill" style={{ width: `${progressPercent}%` }} /></div>
                      <span className="mm-metric-detail">Net paid {money(netPaid, row.currencyCode)} of {money(obligation, row.currencyCode)}{progress.nextUnpaidDueDate ? ` · next unpaid due ${text(progress.nextUnpaidDueDate)}` : ''}</span>
                    </div>;
                  })}</div> : <div className="mm-empty">No program enrollments yet.</div>}
                </div>
              </section>
            </div>

            <div className="mm-portal-grid">
              <section className="mm-card">
                <div className="mm-card-head"><h2>Wallet ledger</h2><span className="mm-chip">{data.walletHistory.total} entries</span></div>
                <div className="mm-card-body mm-portal-table-wrap">
                  {data.walletHistory.items.length ? <table className="mm-portal-table"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Direction</th><th>Amount</th></tr></thead><tbody>{data.walletHistory.items.map((row) => <tr key={text(row.entryId)}><td>{dateTime(row.occurredAt)}</td><td>{text(row.transactionType).replaceAll('_', ' ')}</td><td>{text(row.description)}</td><td><span className={`mm-chip ${String(row.direction) === 'CREDIT' ? 'success' : 'warning'}`}>{text(row.direction)}</span></td><td><strong>{money(row.amount, row.currencyCode)}</strong></td></tr>)}</tbody></table> : <div className="mm-empty">No wallet ledger entries recorded.</div>}
                </div>
              </section>

              <section className="mm-card">
                <div className="mm-card-head"><h2>Payout status</h2><Link className="mm-button light" href="/member/withdrawals">Manage</Link></div>
                <div className="mm-card-body">
                  {data.withdrawals ? <div className="mm-list">
                    <div className="mm-list-row"><span>Ledger balance</span><strong>{money(data.withdrawals.wallet.balance, data.withdrawals.currencyCode)}</strong></div>
                    <div className="mm-list-row"><span>Reserved</span><strong>{money(data.withdrawals.wallet.reservedAmount, data.withdrawals.currencyCode)}</strong></div>
                    <div className="mm-list-row"><span>Available</span><strong>{money(data.withdrawals.wallet.availableBalance, data.withdrawals.currencyCode)}</strong></div>
                    <div className="mm-list-row"><span>Latest request</span>{latestWithdrawal ? <span className={`mm-chip ${statusTone(latestWithdrawal.status)}`}>{text(latestWithdrawal.status).replaceAll('_', ' ')}</span> : <strong>None</strong>}</div>
                  </div> : <div className="mm-empty">Payout overview is unavailable.</div>}
                </div>
              </section>
            </div>

            <div className="mm-portal-grid">
              <section className="mm-card">
                <div className="mm-card-head"><h2>Direct referrals & rewards</h2><span className="mm-chip">{data.directReferralCount} direct</span></div>
                <div className="mm-card-body">
                  {data.referralRewards.items.length ? <div className="mm-list">{data.referralRewards.items.map((row) => <div className="mm-list-row" key={text(row.id)}><div><strong>{text(row.referredUsername)}</strong><br /><span>{dateTime(row.occurredAt)} · {text(row.status)}</span></div><strong>{money(row.netRewardAmount, row.currencyCode)}</strong></div>)}</div> : <div className="mm-empty">No referral reward events recorded.</div>}
                </div>
              </section>

              <section className="mm-card">
                <div className="mm-card-head"><h2>Draws & product benefits</h2><div className="mm-portal-actions"><Link className="mm-button light" href="/member/entitlements">Products</Link></div></div>
                <div className="mm-card-body">
                  <div className="mm-portal-metrics" style={{ marginBottom: 14 }}>
                    <div className="mm-portal-metric"><span>Draw entries</span><strong>{text(drawSummary.entrantCount ?? 0)}</strong><small>{text(drawSummary.eligibleHookCount ?? 0)} eligible hooks</small></div>
                    <div className="mm-portal-metric"><span>Draw wins</span><strong>{text(drawSummary.winnerCount ?? 0)}</strong><small>{countByStatus(data.dashboard.luckyDraw.claimCounts, 'PENDING') + countByStatus(data.dashboard.luckyDraw.claimCounts, 'CLAIMED')} open claims</small></div>
                    <div className="mm-portal-metric"><span>Benefits available</span><strong>{entitlementCount(data.entitlements, 'GRANTED')}</strong><small>Generated by published entitlement rules</small></div>
                    <div className="mm-portal-metric"><span>Benefits fulfilled</span><strong>{entitlementCount(data.entitlements, 'FULFILLED')}</strong><small>{entitlementCount(data.entitlements, 'CLAIMED')} currently claimed</small></div>
                  </div>
                  {data.rewards.wins.items.length ? <div className="mm-list">{data.rewards.wins.items.slice(0, 3).map((row) => <div className="mm-list-row" key={text(row.winnerId)}><div><strong>{text(row.prizeTierName)}</strong><br /><span>{dateTime(row.wonAt)}</span></div><span className={`mm-chip ${statusTone(row.claimStatus)}`}>{text(row.claimStatus ?? 'RECORDED')}</span></div>)}</div> : <div className="mm-empty">No draw wins recorded.</div>}
                </div>
              </section>
            </div>
          </>
        ) : loading ? <div className="mm-card mm-empty">Loading your MegaMitra dashboard…</div> : null}
      </main>
    </div>
  );
}
