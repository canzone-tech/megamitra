'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Row = Record<string, unknown>;
type Data = { items: Row[]; counts: Row[] };

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

function money(value: unknown, currency: unknown): string {
  const amount = Number(value);
  const code = typeof currency === 'string' ? currency : '';
  if (!Number.isFinite(amount)) return '—';
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

function count(data: Data | null, status: string) {
  return Number(data?.counts.find((row) => String(row.status) === status)?.count ?? 0);
}

export function MemberEntitlements() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiJson<Data>('/api/backend/entitlements/me'));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load product entitlements');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function claim(id: string) {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await apiJson(`/api/backend/entitlements/me/${id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ metadata: { channel: 'member-web' } }),
      });
      setMessage('Product benefit claimed. Fulfillment status will appear here.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to claim entitlement');
    } finally {
      setBusyId('');
    }
  }

  async function logout() {
    await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/member"><span className="mm-brand-mark">M</span><span>Mega<span className="mm-brand-accent">Mitra</span></span></Link>
        <nav className="mm-nav"><Link className="mm-button light" href="/member/entitlements">Products</Link><Link className="mm-button light" href="/member/withdrawals">Withdrawals</Link><Link className="mm-button light" href="/member/kyc">KYC</Link><Link className="mm-button light" href="/member/security">Security</Link><button className="mm-button" type="button" onClick={() => void logout()}>Sign out</button></nav>
      </header>

      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div><p className="mm-eyebrow">Consumer rewards</p><h1 className="mm-title">My product benefits</h1><p className="mm-subtitle">Entitlements are generated from published MegaMitra rules and your verified program state. Historical grants keep the product and eligibility snapshot used when they were created.</p></div>
          <button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {message ? <div className="mm-success" role="status">{message}</div> : null}

        {data ? (
          <>
            <section className="mm-dashboard-grid" aria-label="Entitlement summary">
              <article className="mm-card mm-stat"><div className="mm-stat-label">Available</div><div className="mm-stat-value">{count(data, 'GRANTED')}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Claimed</div><div className="mm-stat-value">{count(data, 'CLAIMED')}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Fulfilled</div><div className="mm-stat-value">{count(data, 'FULFILLED')}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Expired / cancelled</div><div className="mm-stat-value">{count(data, 'EXPIRED') + count(data, 'CANCELLED')}</div></article>
            </section>

            <section className="mm-card" style={{ marginTop: 20 }}>
              <div className="mm-card-head"><h2>Entitlement history</h2><span className="mm-chip">{data.items.length} recorded</span></div>
              <div className="mm-card-body">
                {data.items.length ? <div className="mm-list">{data.items.map((row) => {
                  const snapshot = row.productSnapshot && typeof row.productSnapshot === 'object' ? row.productSnapshot as Row : {};
                  const id = String(row.id);
                  return <div className="mm-list-row" key={id} style={{ alignItems: 'flex-start' }}><div><strong>{text(row.productName ?? snapshot.name)}</strong><br /><span>{text(row.programName)} · Qty {text(row.quantity)}</span><br /><span>Granted {date(row.grantedAt)}{row.claimDeadline ? ` · Claim by ${date(row.claimDeadline)}` : ''}</span><br /><span>{money(row.nominalValue ?? snapshot.nominalValue, row.currencyCode ?? snapshot.currencyCode)}</span></div><div style={{ textAlign: 'right' }}><span className="mm-chip">{text(row.status)}</span>{row.status === 'GRANTED' ? <div style={{ marginTop: 10 }}><button className="mm-button blue" type="button" disabled={busyId === id} onClick={() => void claim(id)}>{busyId === id ? 'Claiming…' : 'Claim benefit'}</button></div> : null}</div></div>;
                })}</div> : <div className="mm-empty">No product entitlements have been generated for your account yet.</div>}
              </div>
            </section>
          </>
        ) : loading ? <div className="mm-card mm-empty">Loading product benefits…</div> : null}
      </main>
    </div>
  );
}
