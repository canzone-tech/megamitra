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

type DrawToken = {
  token: string;
  installmentSequence: number | null;
  status: string;
  drawId: string | null;
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

function drawTokens(details: Record<string, unknown>): DrawToken[] {
  if (!Array.isArray(details.drawTokens)) return [];
  return details.drawTokens.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const token = typeof item.token === 'string' ? item.token : '';
    if (!/^[1-9][0-9]{4}$/.test(token)) return [];
    return [{
      token,
      installmentSequence: typeof item.installmentSequence === 'number' ? item.installmentSequence : null,
      status: typeof item.status === 'string' ? item.status : 'AVAILABLE',
      drawId: typeof item.drawId === 'string' ? item.drawId : null,
    }];
  });
}

function statusLabel(status: string) {
  if (status === 'PENDING_VERIFICATION' || status === 'PROCESSING') return 'PENDING VERIFICATION';
  if (status === 'CONFIRMED') return 'CONFIRMED / PAID';
  return status;
}

function statusTone(status: string) {
  if (status === 'CONFIRMED') return 'success';
  if (status === 'REJECTED') return 'danger';
  return 'warning';
}

function tokenStatusLabel(token: DrawToken) {
  if (token.status === 'USED') return 'Used in scheduled draw';
  if (token.status === 'RETIRED') return 'Retired — never reusable';
  return 'Available for scheduled draw';
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
  const tokens = drawTokens(details);
  const memberName = receipt
    ? [receipt.firstName, receipt.lastName].filter(Boolean).join(' ') || receipt.username
    : '';
  const installmentAmount = receipt && typeof details.installmentAmount === 'string'
    ? money(details.installmentAmount, receipt.currencyCode)
    : '—';
  const installmentCount = typeof details.installmentCount === 'number'
    ? details.installmentCount
    : Number(details.installmentCount ?? 0);

  return (
    <div className="mm-receipt-page">
      <header className="mm-site-header mm-receipt-header">
        <Link className="mm-brand" href="/">
          <span className="mm-brand-mark">M</span>
          <span>Mega<span className="mm-brand-accent">GoldenClub</span></span>
        </Link>
        {receipt ? <span className="mm-receipt-public-pill">Read-only public receipt</span> : null}
      </header>

      <main className="mm-receipt-main">
        <section className="mm-receipt-hero">
          <div>
            <p className="mm-eyebrow">Payment receipt</p>
            <h1>{receipt?.receiptNumber ?? 'Receipt verification'}</h1>
            <p>This public link always shows the current verification state of the same payment submission.</p>
          </div>
          {receipt ? (
            <button className="mm-button blue mm-receipt-print" type="button" onClick={() => window.print()}>
              Print / Save PDF
            </button>
          ) : null}
        </section>

        {loading ? <section className="mm-card mm-receipt-loading">Loading receipt…</section> : null}
        {error ? <div className="mm-error" role="alert">{error}</div> : null}

        {receipt ? (
          <article className="mm-card mm-receipt-document">
            <div className="mm-receipt-document-head">
              <div>
                <span className="mm-receipt-overline">Official payment record</span>
                <h2>{receipt.purpose === 'INSTALLMENT' ? 'Installment Payment Receipt' : 'E-PIN Purchase Receipt'}</h2>
                <p>{receipt.seasonName} • {receipt.seasonCode}</p>
              </div>
              <span className={`mm-receipt-status ${statusTone(receipt.status)}`}>
                {statusLabel(receipt.status)}
              </span>
            </div>

            {receipt.purpose === 'INSTALLMENT' ? (
              <section className="mm-receipt-token-panel" aria-labelledby="lucky-draw-token-heading">
                <div className="mm-receipt-token-copy">
                  <span className="mm-receipt-overline">Lucky draw identity</span>
                  <h3 id="lucky-draw-token-heading">5-digit permanent draw token{tokens.length > 1 ? 's' : ''}</h3>
                  <p>Every issued token is unique across all sessions and draws and is never recycled.</p>
                </div>

                {receipt.status === 'CONFIRMED' && tokens.length > 0 ? (
                  <div className="mm-receipt-token-grid">
                    {tokens.map((item) => (
                      <div className="mm-receipt-token-card" key={item.token}>
                        <span>Installment {item.installmentSequence ?? '—'}</span>
                        <strong className="mm-receipt-token-number">{item.token}</strong>
                        <small>{tokenStatusLabel(item)}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`mm-receipt-token-message ${receipt.status === 'REJECTED' ? 'danger' : ''}`}>
                    {receipt.status === 'REJECTED'
                      ? 'Rejected installment submissions do not receive a lucky draw token.'
                      : receipt.status === 'CONFIRMED'
                        ? 'No draw token is available for this confirmed receipt. Please contact support with the receipt number.'
                        : 'A lucky draw token is issued only after Super Admin verifies and confirms this installment payment.'}
                  </div>
                )}
              </section>
            ) : null}

            <section className="mm-receipt-info-grid" aria-label="Receipt information">
              <div><span>Receipt number</span><strong>{receipt.receiptNumber}</strong><small>Permanent payment reference</small></div>
              <div><span>Member / customer</span><strong>{memberName}</strong><small>Member ID: {receipt.memberId} • Username: {receipt.username}</small></div>
              <div><span>Payment purpose</span><strong>{receipt.purpose.replace('_', ' ')}</strong><small>{receipt.seasonName} ({receipt.seasonCode})</small></div>
              <div><span>Amount</span><strong>{money(receipt.amount, receipt.currencyCode)}</strong><small>QR / UPI submission</small></div>
              <div><span>UTR / transaction reference</span><strong>{receipt.providerReference}</strong><small>Reference submitted by member</small></div>
              <div><span>Status</span><strong>{statusLabel(receipt.status)}</strong><small>{receipt.status === 'CONFIRMED' ? 'Payment verified' : receipt.status === 'REJECTED' ? 'Payment rejected' : 'Awaiting Super Admin verification'}</small></div>
              <div><span>Submitted</span><strong>{dateTime(receipt.submittedAt)}</strong><small>Submission timestamp</small></div>
              <div><span>Reviewed</span><strong>{dateTime(receipt.reviewedAt)}</strong><small>Verification timestamp</small></div>
            </section>

            <section className="mm-receipt-payment-summary">
              <h3>{receipt.purpose === 'INSTALLMENT' ? 'Installment allocation' : 'E-PIN purchase details'}</h3>
              {receipt.purpose === 'INSTALLMENT' ? (
                <div className="mm-receipt-summary-row">
                  <div><span>Installments in this payment</span><strong>{Number.isFinite(installmentCount) && installmentCount > 0 ? installmentCount : '—'}</strong></div>
                  <div><span>Amount per installment</span><strong>{installmentAmount}</strong></div>
                  <div><span>Allocation</span><strong>{String(details.allocationMode ?? 'NEXT_UNPAID_SEQUENTIAL').replaceAll('_', ' ')}</strong></div>
                </div>
              ) : (
                <div className="mm-receipt-summary-row">
                  <div><span>Quantity</span><strong>{String(details.quantity ?? '—')}</strong></div>
                  <div><span>Value per E-PIN</span><strong>{String(details.valuePerPin ?? '—')} {receipt.currencyCode}</strong></div>
                  <div><span>Assignment</span><strong>Session-bound after verification</strong></div>
                </div>
              )}

              {receipt.purpose === 'INSTALLMENT' && tokens.length > 0 ? (
                <div className="mm-receipt-allocation-list">
                  {tokens.map((item) => (
                    <div key={`allocation-${item.token}`}>
                      <span>Installment {item.installmentSequence ?? '—'}</span>
                      <strong>Token {item.token}</strong>
                      <small>{tokenStatusLabel(item)}</small>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <footer className="mm-receipt-footer">
              <strong>MegaGoldenClub</strong>
              <span>This is a system-generated read-only receipt. Use the receipt number and public link for verification.</span>
            </footer>
          </article>
        ) : null}
      </main>
    </div>
  );
}
