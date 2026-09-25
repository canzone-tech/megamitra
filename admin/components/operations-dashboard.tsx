'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Summary = {
  unprocessedBusinessEvents: number;
  orchestrationAttention: number;
  referralHandoffsAttention: number;
  openDraws: number;
  openPrizeClaims: number;
  overduePrizeClaims: number;
};

type CompletionSummary = {
  refundReconciliationAttention: number;
  withdrawalAttention: number;
  failedPayouts: number;
  entitlementFulfillmentAttention: number;
  failedProductFulfillments: number;
};

type Page<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };
type Row = Record<string, unknown>;

type DashboardData = {
  summary: Summary;
  completion: CompletionSummary;
  orchestration: Page<Row>;
  referrals: Page<Row>;
  draws: Page<Row>;
  claims: Page<Row>;
  refunds: Page<Row>;
  withdrawals: Page<Row>;
  entitlements: Page<Row>;
  history: Page<Row>;
};

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '—';
}

function date(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return text(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : text(value);
}

function eventLabel(value: unknown): string {
  const labels: Record<string, string> = {
    ENROLLMENT_CREATED: 'Member joined',
    PAYMENT_CONFIRMED: 'Payment received',
    PAYMENT_FAILED: 'Payment failed',
    REFUND_CONFIRMED: 'Refund confirmed',
    ENROLLMENT_COMPLETED: 'Membership completed',
    ENROLLMENT_REOPENED: 'Membership reopened',
  };
  return labels[text(value)] ?? text(value).replaceAll('_', ' ').toLowerCase();
}

function statusLabel(value: unknown): string {
  const status = text(value).toUpperCase();
  const labels: Record<string, string> = {
    UNPROCESSED: 'Waiting',
    READY: 'Ready',
    PENDING: 'Waiting',
    PENDING_EVALUATION: 'Needs review',
    ATTENTION: 'Needs review',
    RECONCILIATION_REQUIRED: 'Needs review',
    PROCESSING: 'In progress',
    INITIATED: 'In progress',
    REQUESTED: 'Requested',
    APPROVED: 'Approved',
    CLAIMED: 'Claimed',
    GRANTED: 'Ready to claim',
    FULFILLED: 'Delivered',
    PAID: 'Paid',
    POSTED: 'Paid',
    CONFIRMED: 'Confirmed',
    PROCESSED: 'Done',
    CONSUMED: 'Done',
    DRAWN: 'Draw completed',
    FAILED: 'Needs attention',
    PAYOUT_FAILED: 'Payment failed',
    CANCELLED: 'Cancelled',
    OVERDUE: 'Overdue',
    EXPIRED: 'Expired',
    SCHEDULED: 'Scheduled',
    SNAPSHOTTED: 'Entries locked',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

function Status({ value }: { value: unknown }) {
  const status = text(value).toUpperCase();
  const tone = /FAILED|RECONCILIATION|OVERDUE|CANCELLED|ATTENTION/.test(status)
    ? 'danger'
    : /READY|PENDING|SCHEDULED|SNAPSHOTTED|CLAIMED|REQUESTED|APPROVED|PROCESSING|INITIATED|UNPROCESSED/.test(status)
      ? 'warning'
      : /PROCESSED|CONSUMED|DRAWN|FULFILLED|PAID|POSTED|CONFIRMED/.test(status)
        ? 'success'
        : '';
  return <span className={`mm-chip ${tone}`}>{statusLabel(value)}</span>;
}

function QueueCard({ title, total, action, children }: { title: string; total: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mm-card">
      <div className="mm-card-head">
        <h2>{title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{action}<span className="mm-chip">{total} total</span></div>
      </div>
      <div className="mm-card-body mm-table-wrap">{children}</div>
    </section>
  );
}

export function OperationsDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summary, completion, orchestration, referrals, draws, claims, refunds, withdrawals, entitlements, history] = await Promise.all([
        apiJson<Summary>('/api/backend/admin/operations/summary'),
        apiJson<CompletionSummary>('/api/backend/admin/operations/completion-summary'),
        apiJson<Page<Row>>('/api/backend/admin/operations/orchestration?page=1&limit=8'),
        apiJson<Page<Row>>('/api/backend/admin/operations/referral-handoffs?page=1&limit=8'),
        apiJson<Page<Row>>('/api/backend/admin/operations/draws?page=1&limit=8'),
        apiJson<Page<Row>>('/api/backend/admin/operations/prize-claims?page=1&limit=12'),
        apiJson<Page<Row>>('/api/backend/admin/operations/refunds?page=1&limit=12'),
        apiJson<Page<Row>>('/api/backend/admin/operations/withdrawal-attention?page=1&limit=12'),
        apiJson<Page<Row>>('/api/backend/admin/operations/entitlement-attention?page=1&limit=12'),
        apiJson<Page<Row>>('/api/backend/admin/operations/history?page=1&limit=20'),
      ]);
      setData({ summary, completion, orchestration, referrals, draws, claims, refunds, withdrawals, entitlements, history });
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      if (reason instanceof ApiClientError && reason.status === 403 && reason.message.toLowerCase().includes('password')) {
        router.replace('/change-password');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successMessage);
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : reason instanceof Error ? reason.message : 'Action could not be completed');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  function processPending() {
    if (!window.confirm('Run all waiting automatic member updates now?')) return Promise.resolve();
    return runAction(() => apiJson('/api/backend/admin/program-orchestration/process-pending?limit=25', { method: 'POST' }), 'Waiting member updates processed.');
  }

  function processReferralHooks() {
    if (!window.confirm('Process all referral rewards that are ready now?')) return Promise.resolve();
    return runAction(() => apiJson('/api/backend/admin/program-orchestration/referral-hooks-process-ready?limit=25', { method: 'POST' }), 'Ready referral rewards processed.');
  }

  function processRefunds() {
    if (!window.confirm('Review all waiting refund effects now?')) return Promise.resolve();
    return runAction(() => apiJson('/api/backend/admin/program-orchestration/referral-refunds-process-pending?limit=25', { method: 'POST' }), 'Waiting refund effects reviewed.');
  }

  function expirePrizeClaims() {
    if (!window.confirm('Close prize claims whose claim deadline has passed?')) return Promise.resolve();
    return runAction(() => apiJson('/api/backend/admin/lucky-draw-fulfillment/claims/expire-pending?limit=100', { method: 'POST' }), 'Expired prize claims closed.');
  }

  function claimPrize(row: Row) {
    return runAction(() => apiJson(`/api/backend/admin/lucky-draw-fulfillment/claims/${row.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ occurredAt: new Date().toISOString(), metadata: { channel: 'admin-operations' } }),
    }), 'Prize claim recorded.');
  }

  function fulfillPrize(row: Row) {
    const isNonCash = String(row.prizeKind) !== 'CASH';
    const reference = window.prompt(isNonCash ? 'Delivery reference (required):' : 'Payment reference (optional):', '') ?? '';
    if (isNonCash && !reference.trim()) return Promise.resolve();
    if (!window.confirm(`Mark ${text(row.prizeTierName)} for ${text(row.username)} as delivered?`)) return Promise.resolve();
    return runAction(() => apiJson(`/api/backend/admin/lucky-draw-fulfillment/claims/${row.id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({ sourceKey: `admin-prize-fulfillment:${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), ...(reference.trim() ? { externalReference: reference.trim() } : {}), metadata: { channel: 'admin-operations' } }),
    }), 'Prize marked as delivered.');
  }

  function cancelPrize(row: Row) {
    const reason = window.prompt('Why is this prize claim being cancelled?')?.trim();
    if (!reason) return Promise.resolve();
    return runAction(() => apiJson(`/api/backend/admin/lucky-draw-fulfillment/claims/${row.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ occurredAt: new Date().toISOString(), reason, metadata: { channel: 'admin-operations' } }),
    }), 'Prize claim cancelled.');
  }

  function reversePrize(row: Row) {
    const fulfillmentId = String(row.fulfillmentId ?? '');
    if (!fulfillmentId) return Promise.resolve();
    const reason = window.prompt('Why should this completed prize delivery be reversed?')?.trim();
    if (!reason) return Promise.resolve();
    if (!window.confirm('Undo this completed prize delivery? The original delivery will stay in history.')) return Promise.resolve();
    return runAction(() => apiJson(`/api/backend/admin/lucky-draw-fulfillment/fulfillments/${fulfillmentId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ sourceKey: `admin-prize-reversal:${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), reason, metadata: { channel: 'admin-operations' } }),
    }), 'Prize delivery reversed.');
  }

  function startProductFulfillment(row: Row) {
    if (String(row.status) !== 'CLAIMED') return Promise.resolve();
    const reference = window.prompt('Delivery reference (optional):', '')?.trim() ?? '';
    return runAction(() => apiJson(`/api/backend/admin/entitlements/items/${row.id}/fulfillment-attempts`, {
      method: 'POST',
      body: JSON.stringify({ sourceKey: `admin-product-fulfillment:${crypto.randomUUID()}`, provider: 'MANUAL_ADMIN', ...(reference ? { providerReference: reference } : {}), metadata: { channel: 'admin-operations' } }),
    }), 'Product delivery started.');
  }

  function completeProductFulfillment(row: Row) {
    const attemptId = String(row.latestAttemptId ?? '');
    if (!attemptId) return Promise.resolve();
    const reference = window.prompt('Final delivery reference (optional):', text(row.latestProviderReference) === '—' ? '' : text(row.latestProviderReference))?.trim() ?? '';
    if (!window.confirm(`Mark ${text(row.productName)} as delivered?`)) return Promise.resolve();
    return runAction(() => apiJson(`/api/backend/admin/entitlements/fulfillment-attempts/${attemptId}/complete`, {
      method: 'PATCH',
      body: JSON.stringify({ ...(reference ? { providerReference: reference } : {}), metadata: { channel: 'admin-operations' } }),
    }), 'Product marked as delivered.');
  }

  function failProductFulfillment(row: Row) {
    const attemptId = String(row.latestAttemptId ?? '');
    if (!attemptId) return Promise.resolve();
    const reason = window.prompt('Why could this product not be delivered?')?.trim();
    if (!reason || reason.length < 2) return Promise.resolve();
    return runAction(() => apiJson(`/api/backend/admin/entitlements/fulfillment-attempts/${attemptId}/fail`, {
      method: 'PATCH',
      body: JSON.stringify({ reason, metadata: { channel: 'admin-operations' } }),
    }), 'Delivery issue saved; the product can be retried.');
  }

  const stats = data ? [
    ['Waiting updates', data.summary.unprocessedBusinessEvents],
    ['Updates needing review', data.summary.orchestrationAttention],
    ['Refunds needing review', data.completion.refundReconciliationAttention],
    ['Withdrawals needing review', data.completion.withdrawalAttention],
    ['Payouts to retry', data.completion.failedPayouts],
    ['Products to deliver', data.completion.entitlementFulfillmentAttention],
    ['Delivery issues', data.completion.failedProductFulfillments],
    ['Open prize claims', data.summary.openPrizeClaims],
    ['Overdue prize claims', data.summary.overduePrizeClaims],
  ] as const : [];

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">GoldenClub</span></div><div className="mm-brand-subtitle">Owner dashboard</div></div></div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="mm-button secondary" href="/business-plan">Business setup</Link>
          <Link className="mm-button secondary" href="/entitlements">Product benefits</Link>
          <Link className="mm-button secondary" href="/withdrawals">Withdrawals</Link>
          <Link className="mm-button secondary" href="/kyc">KYC</Link>
          <button className="mm-button secondary" type="button" onClick={() => void logout()}>Sign out</button>
        </nav>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row">
          <div><p className="mm-eyebrow">Today</p><h1 className="mm-title">Business overview</h1><p className="mm-subtitle">See what needs attention today—member updates, referral rewards, refunds, withdrawals, product deliveries and prize claims.</p></div>
          <button className="mm-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {message ? <div className="mm-success" role="status">{message}</div> : null}

        {data ? <>
          <div className="mm-grid stats" style={{ marginBottom: 20 }}>
            {stats.map(([label, value]) => <div className="mm-card mm-stat" key={label}><div className="mm-stat-label">{label}</div><div className="mm-stat-value">{value}</div></div>)}
          </div>

          <div className="mm-grid two" style={{ marginBottom: 20 }}>
            <QueueCard title="Automatic member updates" total={data.orchestration.total} action={<button className="mm-button secondary" type="button" disabled={busy || !data.orchestration.total} onClick={() => void processPending()}>Run waiting updates</button>}>
              {data.orchestration.items.length ? <table className="mm-table"><thead><tr><th>What happened</th><th>Member</th><th>Status</th><th></th></tr></thead><tbody>{data.orchestration.items.map((row) => <tr key={text(row.businessEventId)}><td><strong>{eventLabel(row.type)}</strong><br /><span>{date(row.occurredAt)}</span></td><td>{text(row.memberUsername)}</td><td><Status value={row.processingStatus} /></td><td>{['UNPROCESSED', 'FAILED', 'RECONCILIATION_REQUIRED'].includes(String(row.processingStatus)) ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void runAction(() => apiJson(`/api/backend/admin/program-orchestration/events/${row.businessEventId}/process`, { method: 'POST', body: '{}' }), 'Member update completed.')}>Run now</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No member updates waiting.</div>}
            </QueueCard>

            <QueueCard title="Referral rewards" total={data.referrals.total} action={<button className="mm-button secondary" type="button" disabled={busy || !data.referrals.total} onClick={() => void processReferralHooks()}>Process ready rewards</button>}>
              {data.referrals.items.length ? <table className="mm-table"><thead><tr><th>New member</th><th>Referrer</th><th>Qualifying amount</th><th>Status</th></tr></thead><tbody>{data.referrals.items.map((row) => <tr key={text(row.id)}><td>{text(row.referredUsername)}</td><td>{text(row.sponsorUsername)}</td><td>{text(row.basisAmount)} {text(row.currencyCode)}</td><td><Status value={row.status} />{String(row.status) === 'READY' ? <button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void runAction(() => apiJson(`/api/backend/admin/program-orchestration/referral-hooks/${row.id}/consume`, { method: 'POST' }), 'Referral reward processed.')}>Process reward</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No referral rewards waiting.</div>}
            </QueueCard>
          </div>

          <section className="mm-card" style={{ marginBottom: 20 }}>
            <div className="mm-card-head"><h2>Refunds & cancellations</h2><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="mm-button secondary" type="button" disabled={busy || !data.refunds.total} onClick={() => void processRefunds()}>Review waiting refunds</button><span className="mm-chip">{data.refunds.total} total</span></div></div>
            <div className="mm-card-body mm-table-wrap">{data.refunds.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Refund amount</th><th>Referral reward effect</th><th>Status</th></tr></thead><tbody>{data.refunds.items.map((row) => <tr key={text(row.refundRecordId)}><td><strong>{text(row.memberUsername)}</strong><br /><span>{date(row.occurredAt)} · {text(row.reason)}</span></td><td>{text(row.refundAmount)} {text(row.currencyCode)}</td><td>{row.evaluationId ? <span>{text(row.reversalAmount)} {text(row.currencyCode)} reversed</span> : <span>Waiting for review</span>}</td><td><Status value={row.operationalStatus} />{row.businessEventId && ['ATTENTION', 'PENDING_EVALUATION'].includes(String(row.operationalStatus)) ? <button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void runAction(() => apiJson(`/api/backend/admin/program-orchestration/refund-events/${row.businessEventId}/reconcile-referral`, { method: 'POST' }), 'Refund effect reviewed.')}>Review</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No refunds to review.</div>}</div>
          </section>

          <div className="mm-grid two" style={{ marginBottom: 20 }}>
            <QueueCard title="Withdrawals & payouts" total={data.withdrawals.total} action={<Link className="mm-button secondary" href="/withdrawals">Open withdrawals</Link>}>
              {data.withdrawals.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Amount</th><th>Status</th><th>Payment</th></tr></thead><tbody>{data.withdrawals.items.map((row) => <tr key={text(row.id)}><td><strong>{text(row.username)}</strong><br /><span>{text(row.destinationLabel)}</span></td><td>{text(row.netAmount)} {text(row.currencyCode)}<br /><span>Fee {text(row.feeAmount)}</span></td><td><Status value={row.status} /><br /><span>{text(row.failureReason)}</span></td><td>{row.latestAttemptId ? <><Status value={row.latestAttemptStatus} /><br /><span>{text(row.latestProviderReference)}</span></> : <span>Not started</span>}</td></tr>)}</tbody></table> : <div className="mm-empty">No withdrawals need attention.</div>}
            </QueueCard>

            <QueueCard title="Member product deliveries" total={data.entitlements.total} action={<Link className="mm-button secondary" href="/entitlements">Open product benefits</Link>}>
              {data.entitlements.items.length ? <table className="mm-table"><thead><tr><th>Member / product</th><th>Status</th><th>Delivery</th><th></th></tr></thead><tbody>{data.entitlements.items.map((row) => {
                const attemptStatus = String(row.latestAttemptStatus ?? '');
                return <tr key={text(row.id)}><td><strong>{text(row.username)}</strong><br /><span>{text(row.productName)}</span></td><td><Status value={row.status} /><br /><span>Claim by {date(row.claimDeadline)}</span></td><td>{row.latestAttemptId ? <><Status value={attemptStatus} /><br /><span>{text(row.latestProviderReference)}</span><br /><span>{text(row.latestAttemptFailureReason)}</span></> : <span>Not started</span>}</td><td>{String(row.status) === 'CLAIMED' && (!row.latestAttemptId || attemptStatus === 'FAILED') ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void startProductFulfillment(row)}>{attemptStatus === 'FAILED' ? 'Retry delivery' : 'Start delivery'}</button> : null}{String(row.status) === 'CLAIMED' && attemptStatus === 'INITIATED' ? <><button className="mm-button" disabled={busy} type="button" onClick={() => void completeProductFulfillment(row)}>Mark delivered</button><button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void failProductFulfillment(row)}>Delivery issue</button></> : null}{String(row.status) === 'GRANTED' ? <span>Waiting for member claim</span> : null}</td></tr>;
              })}</tbody></table> : <div className="mm-empty">No products need delivery attention.</div>}
            </QueueCard>
          </div>

          <section className="mm-card" style={{ marginBottom: 20 }}>
            <div className="mm-card-head"><h2>Prize claims & delivery</h2><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="mm-button secondary" type="button" disabled={busy || !data.claims.total} onClick={() => void expirePrizeClaims()}>Close expired claims</button><span className="mm-chip">{data.claims.total} claims</span></div></div>
            <div className="mm-card-body mm-table-wrap">{data.claims.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Prize</th><th>Claim by</th><th>Status</th><th></th></tr></thead><tbody>{data.claims.items.map((row) => <tr key={text(row.id)}><td>{text(row.username)}</td><td><strong>{text(row.prizeTierName)}</strong><br /><span>{row.cashAmount ? `${text(row.cashAmount)} ${text(row.currencyCode)}` : text(row.prizeKind).toLowerCase()}</span></td><td>{date(row.claimDeadline)}</td><td><Status value={row.status} />{row.reversalId ? <><br /><span>Delivery reversed</span></> : null}</td><td>{String(row.status) === 'PENDING' ? <><button className="mm-button" disabled={busy} type="button" onClick={() => void claimPrize(row)}>Record claim</button><button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void cancelPrize(row)}>Cancel</button></> : null}{String(row.status) === 'CLAIMED' ? <><button className="mm-button" disabled={busy} type="button" onClick={() => void fulfillPrize(row)}>Mark delivered</button><button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void cancelPrize(row)}>Cancel</button></> : null}{String(row.status) === 'FULFILLED' && row.fulfillmentId && !row.reversalId ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void reversePrize(row)}>Undo delivery</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No prize claims waiting.</div>}</div>
          </section>

          <div className="mm-grid two" style={{ marginBottom: 20 }}>
            <QueueCard title="Lucky draws" total={data.draws.total}>
              {data.draws.items.length ? <table className="mm-table"><thead><tr><th>Draw plan</th><th>Draw date</th><th>Eligible entries</th><th>Status</th></tr></thead><tbody>{data.draws.items.map((row) => <tr key={text(row.id)}><td><strong>{text(row.policyName)}</strong></td><td>{date(row.drawAt)}</td><td>{text(row.eligibleEntryCount)}</td><td><Status value={row.status} /></td></tr>)}</tbody></table> : <div className="mm-empty">No draws scheduled yet.</div>}
            </QueueCard>

            <QueueCard title="Recent activity" total={data.history.total}>
              {data.history.items.length ? <div className="mm-list">{data.history.items.map((row) => <div className="mm-list-row" key={text(row.id)}><div><strong>{text(row.description)}</strong><br /><span>{text(row.actorUsername)}</span></div><div style={{ textAlign: 'right' }}><Status value={row.action} /><br /><span>{date(row.createdAt)}</span></div></div>)}</div> : <div className="mm-empty">No recent activity.</div>}
            </QueueCard>
          </div>
        </> : loading ? <div className="mm-card mm-empty">Loading business overview…</div> : null}
      </main>
    </div>
  );
}
