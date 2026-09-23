'use client';

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

type Page<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };
type Row = Record<string, unknown>;

type DashboardData = {
  summary: Summary;
  orchestration: Page<Row>;
  referrals: Page<Row>;
  draws: Page<Row>;
  claims: Page<Row>;
};

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function date(value: unknown): string {
  if (typeof value !== 'string') return text(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function Status({ value }: { value: unknown }) {
  const status = text(value).toUpperCase();
  const tone = /FAILED|RECONCILIATION|OVERDUE|CANCELLED/.test(status)
    ? 'danger'
    : /READY|PENDING|SCHEDULED|SNAPSHOTTED|CLAIMED/.test(status)
      ? 'warning'
      : /PROCESSED|CONSUMED|DRAWN|FULFILLED/.test(status)
        ? 'success'
        : '';
  return <span className={`mm-chip ${tone}`}>{status}</span>;
}

function QueueCard({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mm-card">
      <div className="mm-card-head">
        <h2>{title}</h2>
        <span className="mm-chip">{total} total</span>
      </div>
      <div className="mm-card-body mm-table-wrap">{children}</div>
    </section>
  );
}

export function OperationsDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summary, orchestration, referrals, draws, claims] = await Promise.all([
        apiJson<Summary>('/api/backend/admin/operations/summary'),
        apiJson<Page<Row>>('/api/backend/admin/operations/orchestration?page=1&limit=6'),
        apiJson<Page<Row>>('/api/backend/admin/operations/referral-handoffs?page=1&limit=6'),
        apiJson<Page<Row>>('/api/backend/admin/operations/draws?page=1&limit=6'),
        apiJson<Page<Row>>('/api/backend/admin/operations/prize-claims?page=1&limit=6'),
      ]);
      setData({ summary, orchestration, referrals, draws, claims });
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
    void load();
  }, [load]);

  async function logout() {
    await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const stats = data
    ? [
        ['Unprocessed events', data.summary.unprocessedBusinessEvents, 'var(--mm-blue-700)'],
        ['Orchestration attention', data.summary.orchestrationAttention, 'var(--mm-gold-500)'],
        ['Referral handoffs', data.summary.referralHandoffsAttention, 'var(--mm-magenta-600)'],
        ['Open draws', data.summary.openDraws, 'var(--mm-green-600)'],
        ['Open claims', data.summary.openPrizeClaims, '#7a55c7'],
        ['Overdue claims', data.summary.overduePrizeClaims, 'var(--mm-red-600)'],
      ] as const
    : [];

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand">
          <span className="mm-brand-mark">M</span>
          <div>
            <div>Mega<span className="mm-brand-accent">Mitra</span></div>
            <div className="mm-brand-subtitle">Admin operations</div>
          </div>
        </div>
        <button className="mm-button secondary" type="button" onClick={() => void logout()}>Sign out</button>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row">
          <div>
            <p className="mm-eyebrow">Operational truth</p>
            <h1 className="mm-title">Control room</h1>
            <p className="mm-subtitle">Read-only queues from authoritative events, hooks, draws and fulfillment records. Business actions remain in their dedicated APIs.</p>
          </div>
          <button className="mm-button" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh queues'}
          </button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {data ? (
          <>
            <div className="mm-grid stats" style={{ marginBottom: 20 }}>
              {stats.map(([label, value, accent]) => (
                <div className="mm-card mm-stat" style={{ '--accent': accent } as React.CSSProperties} key={label}>
                  <div className="mm-stat-label">{label}</div>
                  <div className="mm-stat-value">{value}</div>
                </div>
              ))}
            </div>

            <div className="mm-grid two">
              <QueueCard title="Program orchestration" total={data.orchestration.total}>
                {data.orchestration.items.length ? (
                  <table className="mm-table"><thead><tr><th>Event</th><th>Member</th><th>Status</th><th>Occurred</th></tr></thead><tbody>
                    {data.orchestration.items.map((row) => <tr key={text(row.businessEventId)}><td><strong>{text(row.type)}</strong><br /><span>{text(row.businessEventId).slice(0, 8)}</span></td><td>{text(row.memberUsername)}</td><td><Status value={row.processingStatus} /></td><td>{date(row.occurredAt)}</td></tr>)}
                  </tbody></table>
                ) : <div className="mm-empty">No orchestration rows.</div>}
              </QueueCard>

              <QueueCard title="Referral handoffs" total={data.referrals.total}>
                {data.referrals.items.length ? (
                  <table className="mm-table"><thead><tr><th>Referred</th><th>Sponsor</th><th>Basis</th><th>Status</th></tr></thead><tbody>
                    {data.referrals.items.map((row) => <tr key={text(row.id)}><td>{text(row.referredUsername)}</td><td>{text(row.sponsorUsername)}</td><td>{text(row.basisAmount)} {text(row.currencyCode)}</td><td><Status value={row.status} /></td></tr>)}
                  </tbody></table>
                ) : <div className="mm-empty">No referral handoffs.</div>}
              </QueueCard>

              <QueueCard title="Lucky draws" total={data.draws.total}>
                {data.draws.items.length ? (
                  <table className="mm-table"><thead><tr><th>Policy</th><th>Draw at</th><th>Entries</th><th>Status</th></tr></thead><tbody>
                    {data.draws.items.map((row) => <tr key={text(row.id)}><td><strong>{text(row.policyName)}</strong><br /><span>{text(row.policyCode)}</span></td><td>{date(row.drawAt)}</td><td>{text(row.eligibleEntryCount)}</td><td><Status value={row.status} /></td></tr>)}
                  </tbody></table>
                ) : <div className="mm-empty">No draw instances.</div>}
              </QueueCard>

              <QueueCard title="Prize claims" total={data.claims.total}>
                {data.claims.items.length ? (
                  <table className="mm-table"><thead><tr><th>Member</th><th>Prize</th><th>Deadline</th><th>Status</th></tr></thead><tbody>
                    {data.claims.items.map((row) => <tr key={text(row.id)}><td>{text(row.username)}</td><td>{text(row.prizeTierName)}<br /><span>{text(row.prizeKind)}</span></td><td>{date(row.claimDeadline)}</td><td><Status value={row.status} /></td></tr>)}
                  </tbody></table>
                ) : <div className="mm-empty">No prize claims.</div>}
              </QueueCard>
            </div>
          </>
        ) : loading ? <div className="mm-card mm-empty">Loading MegaMitra operations…</div> : null}
      </main>
    </div>
  );
}
