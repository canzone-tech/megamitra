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
  return JSON.stringify(value);
}

function date(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return text(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : text(value);
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
  return <span className={`mm-chip ${tone}`}>{status.replaceAll('_', ' ')}</span>;
}

function QueueCard({ title, total, action, children }: { title: string; total: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mm-card">
      <div className="mm-card-head">
        <h2>{title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{action}<span className="mm-chip">{total} total</span></div>
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
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load operations data');
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
      setError(reason instanceof ApiClientError ? reason.message : reason instanceof Error ? reason.message : 'Operation failed');
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
    return runAction(
      () => apiJson('/api/backend/admin/program-orchestration/process-pending?limit=25', { method: 'POST' }),
      'Pending program events processed.',
    );
  }

  function processReferralHooks() {
    return runAction(
      () => apiJson('/api/backend/admin/program-orchestration/referral-hooks-process-ready?limit=25', { method: 'POST' }),
      'Ready referral handoffs processed.',
    );
  }

  function processRefunds() {
    return runAction(
      () => apiJson('/api/backend/admin/program-orchestration/referral-refunds-process-pending?limit=25', { method: 'POST' }),
      'Pending referral refund evaluations processed.',
    );
  }

  function expirePrizeClaims() {
    return runAction(
      () => apiJson('/api/backend/admin/lucky-draw-fulfillment/claims/expire-pending?limit=100', { method: 'POST' }),
      'Expired prize claim windows reconciled.',
    );
  }

  function claimPrize(row: Row) {
    return runAction(
      () => apiJson(`/api/backend/admin/lucky-draw-fulfillment/claims/${row.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ occurredAt: new Date().toISOString(), metadata: { channel: 'admin-operations' } }),
      }),
      'Prize claim recorded.',
    );
  }

  function fulfillPrize(row: Row) {
    const isNonCash = String(row.prizeKind) !== 'CASH';
    const reference = window.prompt(isNonCash ? 'Delivery / fulfillment reference (required):' : 'External reference (optional):', '') ?? '';
    if (isNonCash && !reference.trim()) return Promise.resolve();
    if (!window.confirm(`Fulfill ${text(row.prizeTierName)} for ${text(row.username)}?`)) return Promise.resolve();
    return runAction(
      () => apiJson(`/api/backend/admin/lucky-draw-fulfillment/claims/${row.id}/fulfill`, {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `admin-prize-fulfillment:${crypto.randomUUID()}`,
          occurredAt: new Date().toISOString(),
          ...(reference.trim() ? { externalReference: reference.trim() } : {}),
          metadata: { channel: 'admin-operations' },
        }),
      }),
      'Prize fulfillment completed.',
    );
  }

  function cancelPrize(row: Row) {
    const reason = window.prompt('Prize claim cancellation reason:')?.trim();
    if (!reason) return Promise.resolve();
    return runAction(
      () => apiJson(`/api/backend/admin/lucky-draw-fulfillment/claims/${row.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ occurredAt: new Date().toISOString(), reason, metadata: { channel: 'admin-operations' } }),
      }),
      'Prize claim cancelled.',
    );
  }

  function reversePrize(row: Row) {
    const fulfillmentId = String(row.fulfillmentId ?? '');
    if (!fulfillmentId) return Promise.resolve();
    const reason = window.prompt('Fulfillment reversal reason:')?.trim();
    if (!reason) return Promise.resolve();
    if (!window.confirm('Reverse this fulfillment? Original fulfillment remains immutable and a reversal record will be created.')) return Promise.resolve();
    return runAction(
      () => apiJson(`/api/backend/admin/lucky-draw-fulfillment/fulfillments/${fulfillmentId}/reverse`, {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `admin-prize-reversal:${crypto.randomUUID()}`,
          occurredAt: new Date().toISOString(),
          reason,
          metadata: { channel: 'admin-operations' },
        }),
      }),
      'Prize fulfillment reversed.',
    );
  }

  function startProductFulfillment(row: Row) {
    if (String(row.status) !== 'CLAIMED') return Promise.resolve();
    const provider = window.prompt('Fulfillment provider / method:', 'MANUAL_ADMIN')?.trim();
    if (!provider || provider.length < 2) return Promise.resolve();
    const reference = window.prompt('Provider / delivery reference (optional):', '')?.trim() ?? '';
    return runAction(
      () => apiJson(`/api/backend/admin/entitlements/items/${row.id}/fulfillment-attempts`, {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `admin-product-fulfillment:${crypto.randomUUID()}`,
          provider,
          ...(reference ? { providerReference: reference } : {}),
          metadata: { channel: 'admin-operations' },
        }),
      }),
      'Product fulfillment attempt started.',
    );
  }

  function completeProductFulfillment(row: Row) {
    const attemptId = String(row.latestAttemptId ?? '');
    if (!attemptId) return Promise.resolve();
    const reference = window.prompt('Final provider / delivery reference (optional):', text(row.latestProviderReference) === '—' ? '' : text(row.latestProviderReference))?.trim() ?? '';
    if (!window.confirm(`Complete fulfillment for ${text(row.productName)}?`)) return Promise.resolve();
    return runAction(
      () => apiJson(`/api/backend/admin/entitlements/fulfillment-attempts/${attemptId}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ ...(reference ? { providerReference: reference } : {}), metadata: { channel: 'admin-operations' } }),
      }),
      'Product fulfillment completed.',
    );
  }

  function failProductFulfillment(row: Row) {
    const attemptId = String(row.latestAttemptId ?? '');
    if (!attemptId) return Promise.resolve();
    const reason = window.prompt('Fulfillment failure reason:')?.trim();
    if (!reason || reason.length < 2) return Promise.resolve();
    return runAction(
      () => apiJson(`/api/backend/admin/entitlements/fulfillment-attempts/${attemptId}/fail`, {
        method: 'PATCH',
        body: JSON.stringify({ reason, metadata: { channel: 'admin-operations' } }),
      }),
      'Product fulfillment attempt marked failed; entitlement remains claim-ready for retry.',
    );
  }

  const stats = data
    ? [
        ['Unprocessed events', data.summary.unprocessedBusinessEvents],
        ['Orchestration attention', data.summary.orchestrationAttention],
        ['Refund reconciliation', data.completion.refundReconciliationAttention],
        ['Withdrawal attention', data.completion.withdrawalAttention],
        ['Failed payouts', data.completion.failedPayouts],
        ['Product fulfillment', data.completion.entitlementFulfillmentAttention],
        ['Failed product attempts', data.completion.failedProductFulfillments],
        ['Open prize claims', data.summary.openPrizeClaims],
        ['Overdue prize claims', data.summary.overduePrizeClaims],
      ] as const
    : [];

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">GoldenClub</span></div><div className="mm-brand-subtitle">Operational completion</div></div></div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="mm-button secondary" href="/business-plan">Business plan</Link>
          <Link className="mm-button secondary" href="/entitlements">Entitlements</Link>
          <Link className="mm-button secondary" href="/withdrawals">Withdrawals</Link>
          <Link className="mm-button secondary" href="/kyc">KYC</Link>
          <button className="mm-button secondary" type="button" onClick={() => void logout()}>Sign out</button>
        </nav>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row">
          <div><p className="mm-eyebrow">Daily operations</p><h1 className="mm-title">Operations overview</h1><p className="mm-subtitle">Review refunds, payouts, product benefits, prize fulfillment and items that need attention in one place.</p></div>
          <button className="mm-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh queues'}</button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {message ? <div className="mm-success" role="status">{message}</div> : null}

        {data ? (
          <>
            <div className="mm-grid stats" style={{ marginBottom: 20 }}>
              {stats.map(([label, value]) => <div className="mm-card mm-stat" key={label}><div className="mm-stat-label">{label}</div><div className="mm-stat-value">{value}</div></div>)}
            </div>

            <div className="mm-grid two" style={{ marginBottom: 20 }}>
              <QueueCard title="Program orchestration" total={data.orchestration.total} action={<button className="mm-button secondary" type="button" disabled={busy} onClick={() => void processPending()}>Process pending</button>}>
                {data.orchestration.items.length ? <table className="mm-table"><thead><tr><th>Event</th><th>Member</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.orchestration.items.map((row) => <tr key={text(row.businessEventId)}><td><strong>{text(row.type).replaceAll('_', ' ')}</strong><br /><span>{date(row.occurredAt)}</span></td><td>{text(row.memberUsername)}</td><td><Status value={row.processingStatus} /></td><td>{['UNPROCESSED', 'FAILED', 'RECONCILIATION_REQUIRED'].includes(String(row.processingStatus)) ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void runAction(() => apiJson(`/api/backend/admin/program-orchestration/events/${row.businessEventId}/process`, { method: 'POST', body: '{}' }), 'Business event processed.')}>Process</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No orchestration rows.</div>}
              </QueueCard>

              <QueueCard title="Referral handoffs" total={data.referrals.total} action={<button className="mm-button secondary" type="button" disabled={busy} onClick={() => void processReferralHooks()}>Process ready</button>}>
                {data.referrals.items.length ? <table className="mm-table"><thead><tr><th>Referred</th><th>Sponsor</th><th>Basis</th><th>Status / action</th></tr></thead><tbody>{data.referrals.items.map((row) => <tr key={text(row.id)}><td>{text(row.referredUsername)}</td><td>{text(row.sponsorUsername)}</td><td>{text(row.basisAmount)} {text(row.currencyCode)}</td><td><Status value={row.status} />{String(row.status) === 'READY' ? <button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void runAction(() => apiJson(`/api/backend/admin/program-orchestration/referral-hooks/${row.id}/consume`, { method: 'POST' }), 'Referral handoff consumed.')}>Consume</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No referral handoffs.</div>}
              </QueueCard>
            </div>

            <section className="mm-card" style={{ marginBottom: 20 }}>
              <div className="mm-card-head"><h2>Refund & cancellation effects</h2><div style={{ display: 'flex', gap: 8 }}><button className="mm-button secondary" type="button" disabled={busy} onClick={() => void processRefunds()}>Process pending refunds</button><span className="mm-chip">{data.refunds.total} records</span></div></div>
              <div className="mm-card-body mm-table-wrap">{data.refunds.items.length ? <table className="mm-table"><thead><tr><th>Refund</th><th>Member</th><th>Amount</th><th>Referral effect</th><th>Status / action</th></tr></thead><tbody>{data.refunds.items.map((row) => <tr key={text(row.refundRecordId)}><td><strong>{text(row.refundRecordId).slice(0, 8)}</strong><br /><span>{date(row.occurredAt)} · {text(row.reason)}</span></td><td>{text(row.memberUsername)}</td><td>{text(row.refundAmount)} {text(row.currencyCode)}</td><td>{row.evaluationId ? <><strong>{text(row.reversalAmount)} {text(row.currencyCode)} reversed</strong><br /><span>{text(row.reasonCode)} · ledger {text(row.reversalLedgerTransactionId).slice(0, 8)}</span></> : <span>Evaluation pending</span>}</td><td><Status value={row.operationalStatus} />{row.businessEventId && ['ATTENTION', 'PENDING_EVALUATION'].includes(String(row.operationalStatus)) ? <button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void runAction(() => apiJson(`/api/backend/admin/program-orchestration/refund-events/${row.businessEventId}/reconcile-referral`, { method: 'POST' }), 'Referral refund reconciliation evaluated.')}>Reconcile</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No refund records.</div>}</div>
            </section>

            <div className="mm-grid two" style={{ marginBottom: 20 }}>
              <QueueCard title="Withdrawal & payout attention" total={data.withdrawals.total} action={<Link className="mm-button secondary" href="/withdrawals">Open payout desk</Link>}>
                {data.withdrawals.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Amount</th><th>Status</th><th>Latest payout attempt</th></tr></thead><tbody>{data.withdrawals.items.map((row) => <tr key={text(row.id)}><td><strong>{text(row.username)}</strong><br /><span>{text(row.destinationType)} · {text(row.destinationLabel)}</span></td><td>{text(row.netAmount)} {text(row.currencyCode)}<br /><span>fee {text(row.feeAmount)}</span></td><td><Status value={row.status} /><br /><span>{text(row.failureReason)}</span></td><td>{row.latestAttemptId ? <><Status value={row.latestAttemptStatus} /><br /><span>{text(row.latestProvider)} · {text(row.latestProviderReference)}</span><br /><span>{text(row.latestAttemptFailureReason)}</span></> : <span>No payout attempt</span>}</td></tr>)}</tbody></table> : <div className="mm-empty">No withdrawal requests need attention.</div>}
              </QueueCard>

              <QueueCard title="Product benefit fulfillment" total={data.entitlements.total} action={<Link className="mm-button secondary" href="/entitlements">Open entitlement desk</Link>}>
                {data.entitlements.items.length ? <table className="mm-table"><thead><tr><th>Member / product</th><th>Status</th><th>Latest attempt</th><th>Action</th></tr></thead><tbody>{data.entitlements.items.map((row) => {
                  const attemptStatus = String(row.latestAttemptStatus ?? '');
                  return <tr key={text(row.id)}><td><strong>{text(row.username)}</strong><br /><span>{text(row.productName)} · {text(row.productCode)}</span></td><td><Status value={row.status} /><br /><span>claim by {date(row.claimDeadline)}</span></td><td>{row.latestAttemptId ? <><Status value={attemptStatus} /><br /><span>{text(row.latestProvider)} · {text(row.latestProviderReference)}</span><br /><span>{text(row.latestAttemptFailureReason)}</span></> : <span>No fulfillment attempt</span>}</td><td>{String(row.status) === 'CLAIMED' && (!row.latestAttemptId || attemptStatus === 'FAILED') ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void startProductFulfillment(row)}>{attemptStatus === 'FAILED' ? 'Retry' : 'Start'}</button> : null}{String(row.status) === 'CLAIMED' && attemptStatus === 'INITIATED' ? <><button className="mm-button" disabled={busy} type="button" onClick={() => void completeProductFulfillment(row)}>Complete</button><button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void failProductFulfillment(row)}>Fail</button></> : null}{String(row.status) === 'GRANTED' ? <span>Waiting for member claim</span> : null}</td></tr>;
                })}</tbody></table> : <div className="mm-empty">No product benefits need fulfillment attention.</div>}
              </QueueCard>
            </div>

            <section className="mm-card" style={{ marginBottom: 20 }}>
              <div className="mm-card-head"><h2>Lucky draw prize fulfillment</h2><div style={{ display: 'flex', gap: 8 }}><button className="mm-button secondary" type="button" disabled={busy} onClick={() => void expirePrizeClaims()}>Expire overdue</button><span className="mm-chip">{data.claims.total} claims</span></div></div>
              <div className="mm-card-body mm-table-wrap">{data.claims.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Prize</th><th>Deadline</th><th>Status</th><th>Operational action</th></tr></thead><tbody>{data.claims.items.map((row) => <tr key={text(row.id)}><td>{text(row.username)}</td><td><strong>{text(row.prizeTierName)}</strong><br /><span>{text(row.prizeKind)}{row.cashAmount ? ` · ${text(row.cashAmount)} ${text(row.currencyCode)}` : ''}</span></td><td>{date(row.claimDeadline)}</td><td><Status value={row.status} />{row.reversalId ? <><br /><span>Reversed</span></> : null}</td><td>{String(row.status) === 'PENDING' ? <><button className="mm-button" disabled={busy} type="button" onClick={() => void claimPrize(row)}>Claim</button><button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void cancelPrize(row)}>Cancel</button></> : null}{String(row.status) === 'CLAIMED' ? <><button className="mm-button" disabled={busy} type="button" onClick={() => void fulfillPrize(row)}>Fulfill</button><button className="mm-button secondary" disabled={busy} type="button" style={{ marginLeft: 6 }} onClick={() => void cancelPrize(row)}>Cancel</button></> : null}{String(row.status) === 'FULFILLED' && row.fulfillmentId && !row.reversalId ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void reversePrize(row)}>Reverse</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No prize claims.</div>}</div>
            </section>

            <div className="mm-grid two" style={{ marginBottom: 20 }}>
              <QueueCard title="Lucky draws" total={data.draws.total}>
                {data.draws.items.length ? <table className="mm-table"><thead><tr><th>Policy</th><th>Draw at</th><th>Entries</th><th>Status</th></tr></thead><tbody>{data.draws.items.map((row) => <tr key={text(row.id)}><td><strong>{text(row.policyName)}</strong><br /><span>{text(row.policyCode)}</span></td><td>{date(row.drawAt)}</td><td>{text(row.eligibleEntryCount)}</td><td><Status value={row.status} /></td></tr>)}</tbody></table> : <div className="mm-empty">No draw instances.</div>}
              </QueueCard>

              <QueueCard title="Operational audit history" total={data.history.total}>
                {data.history.items.length ? <div className="mm-list">{data.history.items.map((row) => <div className="mm-list-row" key={text(row.id)}><div><strong>{text(row.description)}</strong><br /><span>{text(row.entityType)} · {text(row.entityId).slice(0, 12)} · {text(row.actorUsername)}</span><br /><span>{text(row.metadata)}</span></div><div style={{ textAlign: 'right' }}><Status value={row.action} /><br /><span>{date(row.createdAt)}</span></div></div>)}</div> : <div className="mm-empty">No matching operational audit records.</div>}
              </QueueCard>
            </div>
          </>
        ) : loading ? <div className="mm-card mm-empty">Loading MegaGoldenClub operations…</div> : null}
      </main>
    </div>
  );
}
