'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Destination = {
  id: string;
  type: string;
  label: string;
  reference: string;
  status: string;
  isDefault: boolean | number;
};

type WithdrawalRequest = {
  id: string;
  status: string;
  amount: string | number;
  feeAmount: string | number;
  netAmount: string | number;
  currencyCode: string;
  requestedAt: string;
  destinationLabel: string;
  rejectionReason?: string | null;
  failureReason?: string | null;
  cancellationReason?: string | null;
};

type Policy = {
  id: string;
  policyCode: string;
  policyName: string;
  minAmount: string | number;
  maxAmount: string | number;
  feeMode: string;
  feeValue: string | number;
  minimumFee: string | number | null;
  maximumFee: string | number | null;
  kycRequired: boolean | number;
  maxPendingRequests: number;
  dailyAmountLimit: string | number | null;
  monthlyAmountLimit: string | number | null;
  allowedDestinationTypes: string[];
};

type Overview = {
  currencyCode: string;
  kycStatus: string;
  policy: Policy | null;
  wallet: {
    accountId: string | null;
    balance: string | number;
    reservedAmount: string | number;
    availableBalance: string | number;
  };
  destinations: Destination[];
  requests: WithdrawalRequest[];
};

function money(value: string | number | null | undefined, currency: string) {
  const amount = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function statusTone(status: string) {
  if (status === 'PAID') return 'success';
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'PAYOUT_FAILED') return 'danger';
  if (status === 'REQUESTED' || status === 'APPROVED' || status === 'PROCESSING') return 'warning';
  return '';
}

export function MemberWithdrawals() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [destinationType, setDestinationType] = useState('UPI');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [destinationReference, setDestinationReference] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await apiJson<Overview>(
        `/api/backend/withdrawals/me?currencyCode=${encodeURIComponent(currencyCode)}`,
      );
      setData(next);
      const active = next.destinations.filter((destination) => destination.status === 'ACTIVE');
      if (!selectedDestination || !active.some((destination) => destination.id === selectedDestination)) {
        const preferred = active.find((destination) => Boolean(destination.isDefault)) ?? active[0];
        setSelectedDestination(preferred?.id ?? '');
      }
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
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load withdrawals');
    } finally {
      setLoading(false);
    }
  }, [currencyCode, router, selectedDestination]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeDestinations = useMemo(
    () => data?.destinations.filter((destination) => destination.status === 'ACTIVE') ?? [],
    [data],
  );

  async function createDestination(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson('/api/backend/withdrawals/me/destinations', {
        method: 'POST',
        body: JSON.stringify({
          type: destinationType,
          label: destinationLabel,
          reference: destinationReference,
          isDefault: activeDestinations.length === 0,
        }),
      });
      setDestinationLabel('');
      setDestinationReference('');
      setSuccess('Withdrawal destination added.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to add withdrawal destination');
    } finally {
      setBusy(false);
    }
  }

  async function createRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDestination) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson('/api/backend/withdrawals/me/requests', {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `member-withdrawal:${crypto.randomUUID()}`,
          destinationId: selectedDestination,
          amount: Number(amount),
          currencyCode,
        }),
      });
      setAmount('');
      setSuccess('Withdrawal request submitted for review. The amount is now reserved from available balance.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to submit withdrawal request');
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(id: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson(`/api/backend/withdrawals/me/requests/${id}/cancel`, { method: 'POST' });
      setSuccess('Withdrawal request cancelled and reservation released.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to cancel withdrawal request');
    } finally {
      setBusy(false);
    }
  }

  async function deactivateDestination(id: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson(`/api/backend/withdrawals/me/destinations/${id}`, { method: 'DELETE' });
      setSuccess('Withdrawal destination deactivated.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to deactivate withdrawal destination');
    } finally {
      setBusy(false);
    }
  }

  const kycReady = data?.kycStatus === 'APPROVED' || !Boolean(data?.policy?.kycRequired);

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/member"><span className="mm-brand-mark">M</span><span>Mega<span className="mm-brand-accent">GoldenClub</span></span></Link>
        <nav className="mm-nav"><Link className="mm-button light" href="/member">Dashboard</Link><Link className="mm-button light" href="/member/kyc">KYC</Link><Link className="mm-button light" href="/member/security">Security</Link><Link className="mm-button light" href="/">Public site</Link></nav>
      </header>

      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div><p className="mm-eyebrow">Wallet payout</p><h1 className="mm-title">Withdrawals</h1><p className="mm-subtitle">When you submit a withdrawal, the requested amount is held while it is reviewed. Your balance updates when the payout is completed.</p></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}><div className="mm-field" style={{ margin: 0 }}><label htmlFor="withdrawal-currency">Currency</label><input className="mm-input" id="withdrawal-currency" maxLength={3} value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></div><button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {success ? <div className="mm-success" role="status">{success}</div> : null}

        {data ? (
          <>
            <section className="mm-dashboard-grid">
              <article className="mm-card mm-stat"><div className="mm-stat-label">Wallet balance</div><div className="mm-stat-value">{money(data.wallet.balance, data.currencyCode)}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Reserved</div><div className="mm-stat-value">{money(data.wallet.reservedAmount, data.currencyCode)}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">Available</div><div className="mm-stat-value">{money(data.wallet.availableBalance, data.currencyCode)}</div></article>
              <article className="mm-card mm-stat"><div className="mm-stat-label">KYC</div><div className="mm-stat-value" style={{ fontSize: 22 }}>{data.kycStatus.replaceAll('_', ' ')}</div></article>
            </section>

            <div className="mm-wide-grid">
              <section className="mm-card">
                <div className="mm-card-head"><h2>Withdrawal limits & fees</h2><span className={`mm-chip ${kycReady ? 'success' : 'warning'}`}>{data.policy?.policyCode ?? 'Unavailable'}</span></div>
                <div className="mm-card-body">
                  {data.policy ? <div className="mm-list">
                    <div className="mm-list-row"><span>Amount range</span><strong>{money(data.policy.minAmount, data.currencyCode)} – {money(data.policy.maxAmount, data.currencyCode)}</strong></div>
                    <div className="mm-list-row"><span>Fee</span><strong>{data.policy.feeMode === 'PERCENTAGE' ? `${data.policy.feeValue}%` : money(data.policy.feeValue, data.currencyCode)}</strong></div>
                    <div className="mm-list-row"><span>KYC required</span><strong>{Boolean(data.policy.kycRequired) ? 'Yes' : 'No'}</strong></div>
                    <div className="mm-list-row"><span>Pending requests allowed</span><strong>{data.policy.maxPendingRequests}</strong></div>
                  </div> : <div className="mm-empty">No active default withdrawal policy is available for {data.currencyCode}.</div>}
                </div>
              </section>

              <section className="mm-card">
                <div className="mm-card-head"><h2>Request withdrawal</h2><span className="mm-chip">Held while processing</span></div>
                <div className="mm-card-body">
                  {!data.policy ? <div className="mm-empty">Withdrawals are not available for this currency right now.</div> : !kycReady ? <div className="mm-empty">This policy requires approved KYC. Complete KYC before requesting a withdrawal.</div> : !activeDestinations.length ? <div className="mm-empty">Add an active payout destination first.</div> : (
                    <form method="post" onSubmit={createRequest}>
                      <div className="mm-field"><label htmlFor="withdrawal-destination">Destination</label><select className="mm-input" id="withdrawal-destination" value={selectedDestination} onChange={(event) => setSelectedDestination(event.target.value)} required>{activeDestinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.label} · {destination.type.replaceAll('_', ' ')}</option>)}</select></div>
                      <div className="mm-field"><label htmlFor="withdrawal-amount">Amount ({data.currencyCode})</label><input className="mm-input" id="withdrawal-amount" type="number" min={Number(data.policy.minAmount)} max={Number(data.policy.maxAmount)} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div>
                      <button className="mm-button blue" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit withdrawal'}</button>
                    </form>
                  )}
                </div>
              </section>
            </div>

            <div className="mm-wide-grid">
              <section className="mm-card">
                <div className="mm-card-head"><h2>Payout destinations</h2><span className="mm-chip">Saved destinations</span></div>
                <div className="mm-card-body">
                  <form method="post" onSubmit={createDestination}>
                    <div className="mm-field"><label htmlFor="destination-type">Type</label><select className="mm-input" id="destination-type" value={destinationType} onChange={(event) => setDestinationType(event.target.value)}><option value="UPI">UPI</option><option value="BANK_REFERENCE">Bank reference</option><option value="OTHER">Other</option></select></div>
                    <div className="mm-field"><label htmlFor="destination-label">Label</label><input className="mm-input" id="destination-label" value={destinationLabel} onChange={(event) => setDestinationLabel(event.target.value)} placeholder="Primary payout" required /></div>
                    <div className="mm-field"><label htmlFor="destination-reference">UPI ID / account reference</label><input className="mm-input" id="destination-reference" value={destinationReference} onChange={(event) => setDestinationReference(event.target.value)} placeholder="Enter the payout reference for this destination" required /></div>
                    <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add destination'}</button>
                  </form>
                  <div className="mm-list" style={{ marginTop: 16 }}>{data.destinations.map((destination) => <div className="mm-list-row" key={destination.id}><div><strong>{destination.label}</strong><br /><span>{destination.type.replaceAll('_', ' ')} · {destination.reference}</span></div><div style={{ textAlign: 'right' }}><span className={`mm-chip ${destination.status === 'ACTIVE' ? 'success' : ''}`}>{destination.status}</span>{destination.status === 'ACTIVE' ? <button className="mm-button light" style={{ marginLeft: 8 }} type="button" disabled={busy} onClick={() => void deactivateDestination(destination.id)}>Deactivate</button> : null}</div></div>)}</div>
                </div>
              </section>

              <section className="mm-card">
                <div className="mm-card-head"><h2>Request history</h2><span className="mm-chip">{data.requests.length} recent</span></div>
                <div className="mm-card-body">
                  {data.requests.length ? <div className="mm-list">{data.requests.map((request) => <div className="mm-list-row" key={request.id}><div><strong>{money(request.amount, request.currencyCode)}</strong><br /><span>{request.destinationLabel} · Net {money(request.netAmount, request.currencyCode)} · Fee {money(request.feeAmount, request.currencyCode)}</span><br /><span>{new Date(request.requestedAt).toLocaleString()}</span>{request.rejectionReason || request.failureReason || request.cancellationReason ? <><br /><span>{request.rejectionReason ?? request.failureReason ?? request.cancellationReason}</span></> : null}</div><div style={{ textAlign: 'right' }}><span className={`mm-chip ${statusTone(request.status)}`}>{request.status.replaceAll('_', ' ')}</span>{request.status === 'REQUESTED' ? <button className="mm-button light" style={{ marginLeft: 8 }} type="button" disabled={busy} onClick={() => void cancelRequest(request.id)}>Cancel</button> : null}</div></div>)}</div> : <div className="mm-empty">No withdrawal requests yet.</div>}
                </div>
              </section>
            </div>
          </>
        ) : loading ? <div className="mm-card mm-empty">Loading withdrawals…</div> : null}
      </main>
    </div>
  );
}
