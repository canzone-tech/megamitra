'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';

type PublicReceipt = {
  receiptNumber: string;
  purpose: 'INSTALLMENT' | 'EPIN_PURCHASE';
  amount: string;
  currencyCode: string;
  providerReference: string;
  status: string;
  details: Record<string, unknown> | string | null;
  submittedAt: string;
  reviewedAt: string | null;
  memberId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  seasonCode: string;
  seasonName: string;
};

function money(value: string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currencyCode} ${Number.isFinite(amount) ? amount.toFixed(2) : value}`;
  }
}

function dateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function detailsObject(value: PublicReceipt['details']): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function statusLabel(status: string) {
  if (status === 'PENDING_VERIFICATION' || status === 'PROCESSING') return 'PENDING VERIFICATION';
  if (status === 'CONFIRMED') return 'CONFIRMED / PAID';
  return status;
}

export function PublicPaymentReceipt({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReceipt(await apiJson<PublicReceipt>(`/api/backend/receipts/${encodeURIComponent(token)}`));
    } catch (reason) {
      setReceipt(null);
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load receipt');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const details = receipt ? detailsObject(receipt.details) : {};
  const memberName = receipt
    ? [receipt.firstName, receipt.lastName].filter(Boolean).join(' ') || receipt.username
    : '';

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/">
          <span className="mm-brand-mark">M</span>
          <span>Mega<span className="mm-brand-accent">GoldenClub</span></span>
        </Link>
        {receipt ? <span className="mm-portal-pill">Read-only public receipt</span> : null}
      </header>
      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div>
            <p className="mm-eyebrow">Payment receipt</p>
            <h1 className="mm-title">{receipt?.receiptNumber ?? 'Receipt verification'}</h1>
            <p className="mm-subtitle">This public link always shows the current verification state of the same payment submission.</p>
          </div>
          {receipt ? <button className="mm-button blue" type="button" onClick={() => window.print()}>Print</button> : null}
        </div>

        {loading ? <section className="mm-card"><div className="mm-card-body">Loading receipt…</div></section> : null}
        {error ? <div className="mm-error" role="alert">{error}</div> : null}

        {receipt ? <section className="mm-card">
          <div className="mm-card-head">
            <h2>{receipt.purpose === 'INSTALLMENT' ? 'Installment payment' : 'E-PIN purchase'}</h2>
            <span className="mm-chip">{statusLabel(receipt.status)}</span>
          </div>
          <div className="mm-card-body">
            <div className="mm-portal-metrics">
              <div className="mm-portal-metric"><span>Receipt number</span><strong>{receipt.receiptNumber}</strong><small>Permanent reference</small></div>
              <div className="mm-portal-metric"><span>Member / customer</span><strong>{memberName}</strong><small>Member ID: {receipt.memberId} • Username: {receipt.username}</small></div>
              <div className="mm-portal-metric"><span>Purpose</span><strong>{receipt.purpose.replace('_', ' ')}</strong><small>{receipt.seasonName} ({receipt.seasonCode})</small></div>
              <div className="mm-portal-metric"><span>Amount</span><strong>{money(receipt.amount, receipt.currencyCode)}</strong><small>QR / UPI submission</small></div>
              <div className="mm-portal-metric"><span>UTR / reference</span><strong>{receipt.providerReference}</strong><small>Payment reference submitted by member</small></div>
              <div className="mm-portal-metric"><span>Status</span><strong>{statusLabel(receipt.status)}</strong><small>{receipt.status === 'CONFIRMED' ? 'Payment verified' : receipt.status === 'REJECTED' ? 'Payment rejected' : 'Awaiting Super Admin verification'}</small></div>
              <div className="mm-portal-metric"><span>Submitted</span><strong>{dateTime(receipt.submittedAt)}</strong><small>Submission timestamp</small></div>
              <div className="mm-portal-metric"><span>Reviewed</span><strong>{dateTime(receipt.reviewedAt)}</strong><small>Verification timestamp</small></div>
            </div>

            <div className="mm-list">
              {receipt.purpose === 'INSTALLMENT' ? <div><strong>Installment details</strong><br />{String(details.installmentCount ?? '—')} installment(s) • {String(details.installmentAmount ?? '—')} each • {String(details.allocationMode ?? 'NEXT_UNPAID_SEQUENTIAL')}</div> : <div><strong>E-PIN details</strong><br />Quantity {String(details.quantity ?? '—')} • Value per PIN {String(details.valuePerPin ?? '—')} {receipt.currencyCode} • Session-bound after verification</div>}
            </div>
          </div>
        </section> : null}
      </main>
    </div>
  );
}
