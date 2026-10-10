'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberHeader } from '@/components/member-header';

type Payment = {
  receiptNumber: string; occurredAt: string; mode: string; reference: string | null;
  allocatedAmount: string; refundedAmount: string; netAmount: string;
};
type Token = { token: string; status: string; printedReference: string | null };
type Installment = {
  sequence: number; dueDate: string; amount: string; netPaid: string; balance: string;
  status: 'PAID' | 'PARTIAL' | 'UNPAID'; payments: Payment[]; drawTokens: Token[];
};
type Enrollment = {
  id: string; seasonCode: string; seasonName: string; status: string; currencyCode: string;
  installmentCount: number; installmentAmount: string; paidCount: number;
  totalPaid: string; outstanding: string; installments: Installment[];
};
type History = { enrollments: Enrollment[] };

function money(value: string, currencyCode: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode }).format(Number(value));
}
function monthLabel(dueDate: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC', month: 'long', year: 'numeric',
  }).format(new Date(dueDate + 'T12:00:00Z'));
}
function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(date.slice(0, 10) + 'T12:00:00Z'));
}

export function MemberInstallments() {
  const router = useRouter();
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiJson<History>('/api/backend/member/installments'));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      if (reason instanceof ApiClientError && reason.status === 403 && /password/i.test(reason.message)) {
        router.replace('/member/change-password');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load installment history');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="mm-member-shell">
      <MemberHeader />
      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div>
            <p className="mm-eyebrow">My program payments</p>
            <h1 className="mm-title">Monthwise installments</h1>
            <p className="mm-subtitle">Your monthly due dates, confirmed allocations, payment receipts and Lucky Draw Tokens.</p>
            <span className="mm-portal-pill">Recorded payment history</span>
          </div>
          <button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {data ? data.enrollments.length ? data.enrollments.map((enrollment) => (
          <section className="mm-card mm-installment-card" key={enrollment.id} aria-label={enrollment.seasonName + ' monthwise installments'}>
            <div className="mm-card-head">
              <div><h2>{enrollment.seasonName}</h2><span className="mm-metric-detail">{enrollment.seasonCode} · {enrollment.status} enrollment</span></div>
              <span className="mm-chip">{enrollment.paidCount}/{enrollment.installmentCount} paid</span>
            </div>
            <div className="mm-card-body">
              <div className="mm-installment-summary">
                <div><span>Monthly EMI</span><strong>{money(enrollment.installmentAmount, enrollment.currencyCode)}</strong></div>
                <div><span>Confirmed EMI payments</span><strong>{money(enrollment.totalPaid, enrollment.currencyCode)}</strong></div>
                <div><span>EMI outstanding</span><strong>{money(enrollment.outstanding, enrollment.currencyCode)}</strong></div>
              </div>
              <div className="mm-installment-list">
                {enrollment.installments.map((installment) => (
                  <article className="mm-installment-row" key={installment.sequence}>
                    <div className="mm-installment-row-top">
                      <div>
                        <strong>Month {installment.sequence} — {monthLabel(installment.dueDate)}</strong>
                        <span>Due {dateLabel(installment.dueDate)} · EMI {money(installment.amount, enrollment.currencyCode)}</span>
                      </div>
                      <span className={'mm-chip ' + (installment.status === 'PAID' ? 'success' : installment.status === 'PARTIAL' ? 'warning' : '')}>
                        {installment.status}
                      </span>
                    </div>
                    <div className="mm-installment-amounts">
                      <span>Paid: <strong>{money(installment.netPaid, enrollment.currencyCode)}</strong></span>
                      <span>Balance: <strong>{money(installment.balance, enrollment.currencyCode)}</strong></span>
                    </div>
                    {installment.payments.length ? (
                      <div className="mm-installment-receipts">
                        {installment.payments.map((payment, index) => (
                          <div key={payment.receiptNumber + '-' + index}>
                            <strong>Receipt {payment.receiptNumber}</strong>
                            <span>{payment.mode} · {dateLabel(payment.occurredAt)} · Net {money(payment.netAmount, enrollment.currencyCode)}</span>
                            {payment.reference ? <small>Transaction reference: {payment.reference}</small> : null}
                            {Number(payment.refundedAmount) > 0 ? <small>Refunded: {money(payment.refundedAmount, enrollment.currencyCode)}</small> : null}
                          </div>
                        ))}
                      </div>
                    ) : <p className="mm-installment-empty">No confirmed payment recorded for this month.</p>}
                    {installment.drawTokens.length ? (
                      <div className="mm-installment-tokens">
                        {installment.drawTokens.map((token) => (
                          <div key={token.token}>
                            <span>Lucky Draw Token ({token.status})</span>
                            <strong>{token.token}</strong>
                            {token.printedReference ? <small>{token.printedReference}</small> : null}
                          </div>
                        ))}
                      </div>
                    ) : installment.status === 'PAID' ? (
                      <p className="mm-installment-token-missing">Lucky Draw Token not yet linked. Please contact Super Admin for reconciliation.</p>
                    ) : null}
                  </article>
                ))}
              </div>
              <div className="mm-portal-actions">
                <Link className="mm-button blue" href="/member/payments">Pay upcoming installments</Link>
                <Link className="mm-button light" href="/member">Back to dashboard</Link>
              </div>
              <p className="mm-referral-note">Totals above cover monthly EMIs only. Registration fee, if any, is accounted for separately in your enrollment dues.</p>
            </div>
          </section>
        )) : <section className="mm-card mm-empty">No session enrollment or installment schedule yet.</section> : loading ? <div className="mm-card mm-empty">Loading monthwise installments…</div> : null}
      </main>
    </div>
  );
}
