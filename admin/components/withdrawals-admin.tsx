'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Row = Record<string, unknown>;
type Page<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };
type Policy = Row & { id: string; code: string; name: string; currencyCode: string; versions: Row[] };
type Detail = Row & { payoutAttempts: Row[] };

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function money(value: unknown, currency: unknown): string {
  const amount = Number(value ?? 0);
  const code = typeof currency === 'string' ? currency : '';
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

function tone(status: unknown) {
  const value = text(status).toUpperCase();
  if (/PAID|CONFIRMED|PUBLISHED/.test(value)) return 'success';
  if (/REJECTED|FAILED|CANCELLED/.test(value)) return 'danger';
  if (/REQUESTED|APPROVED|PROCESSING|INITIATED|DRAFT/.test(value)) return 'warning';
  return '';
}

export function WithdrawalsAdmin() {
  const router = useRouter();
  const [requests, setRequests] = useState<Page<Row> | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [provider, setProvider] = useState('MANUAL');
  const [providerReference, setProviderReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [policyCode, setPolicyCode] = useState('');
  const [policyName, setPolicyName] = useState('');
  const [policyCurrency, setPolicyCurrency] = useState('INR');
  const [versionPolicyId, setVersionPolicyId] = useState('');
  const [minAmount, setMinAmount] = useState('1');
  const [maxAmount, setMaxAmount] = useState('100000');
  const [feeMode, setFeeMode] = useState('FIXED');
  const [feeValue, setFeeValue] = useState('0');
  const [kycRequired, setKycRequired] = useState(true);
  const [maxPending, setMaxPending] = useState('1');
  const [allowedTypes, setAllowedTypes] = useState('UPI,BANK_REFERENCE,OTHER');
  const [effectiveFrom, setEffectiveFrom] = useState(() => {
    const value = new Date(Date.now() + 60_000);
    return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const suffix = statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : '';
      const [queue, policyRows] = await Promise.all([
        apiJson<Page<Row>>(`/api/backend/admin/withdrawals/requests?page=1&limit=25${suffix}`),
        apiJson<Policy[]>('/api/backend/admin/withdrawals/policies'),
      ]);
      setRequests(queue);
      setPolicies(policyRows);
      if (!versionPolicyId && policyRows[0]) setVersionPolicyId(policyRows[0].id);
    } catch (reasonValue) {
      if (reasonValue instanceof ApiClientError && reasonValue.status === 401) {
        router.replace('/login');
        return;
      }
      if (
        reasonValue instanceof ApiClientError &&
        reasonValue.status === 403 &&
        reasonValue.message.toLowerCase().includes('password')
      ) {
        router.replace('/change-password');
        return;
      }
      setError(reasonValue instanceof ApiClientError ? reasonValue.message : 'Unable to load withdrawal operations');
    } finally {
      setLoading(false);
    }
  }, [router, statusFilter, versionPolicyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedRow = useMemo(
    () => requests?.items.find((row) => text(row.id) === selectedId) ?? null,
    [requests, selectedId],
  );

  async function loadDetail(id: string) {
    setSelectedId(id);
    setError('');
    try {
      setDetail(await apiJson<Detail>(`/api/backend/admin/withdrawals/requests/${id}`));
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiClientError ? reasonValue.message : 'Unable to load withdrawal request');
    }
  }

  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setSuccess('Withdrawal operation completed.');
      await load();
      if (selectedId) await loadDetail(selectedId);
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiClientError ? reasonValue.message : 'Withdrawal operation failed');
    } finally {
      setBusy(false);
    }
  }

  async function createPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const created = await apiJson<Policy>('/api/backend/admin/withdrawals/policies', {
        method: 'POST',
        body: JSON.stringify({
          code: policyCode,
          name: policyName,
          currencyCode: policyCurrency,
          isDefault: false,
        }),
      });
      setVersionPolicyId(created.id);
      setPolicyCode('');
      setPolicyName('');
      setSuccess('Withdrawal policy created. Add and publish a version to activate it.');
      await load();
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiClientError ? reasonValue.message : 'Unable to create withdrawal policy');
    } finally {
      setBusy(false);
    }
  }

  async function createVersion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!versionPolicyId) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson(`/api/backend/admin/withdrawals/policies/${versionPolicyId}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(effectiveFrom).toISOString(),
          minAmount: Number(minAmount),
          maxAmount: Number(maxAmount),
          feeMode,
          feeValue: Number(feeValue),
          kycRequired,
          maxPendingRequests: Number(maxPending),
          allowedDestinationTypes: allowedTypes.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean),
          reviewRules: { manualApprovalRequired: true, providerExecutionMode: 'MANUAL_OR_ADAPTER' },
        }),
      });
      setSuccess('Draft policy version created. Review it below, then publish when ready.');
      await load();
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiClientError ? reasonValue.message : 'Unable to create policy version');
    } finally {
      setBusy(false);
    }
  }

  const latestAttempt = detail?.payoutAttempts?.[0] ?? null;
  const detailStatus = text(detail?.status ?? selectedRow?.status);

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">Mitra</span></div><div className="mm-brand-subtitle">Withdrawal operations</div></div></div>
        <nav style={{ display: 'flex', gap: 8 }}><Link className="mm-button secondary" href="/operations">Operations</Link><Link className="mm-button secondary" href="/kyc">KYC</Link><Link className="mm-button secondary" href="/security">Security</Link></nav>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row">
          <div><p className="mm-eyebrow">Reserved balance → payout → ledger</p><h1 className="mm-title">Withdrawals</h1><p className="mm-subtitle">Review member requests, execute provider-neutral payout attempts, and post the wallet debit only after a payout is confirmed.</p></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}><div className="mm-field" style={{ margin: 0 }}><label htmlFor="withdrawal-status-filter">Status</label><select className="mm-input" id="withdrawal-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All</option>{['REQUESTED','APPROVED','PROCESSING','PAYOUT_FAILED','PAID','REJECTED','CANCELLED'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></div><button className="mm-button" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {success ? <div className="mm-success" role="status">{success}</div> : null}

        <section className="mm-card" style={{ marginBottom: 20 }}>
          <div className="mm-card-head"><h2>Request queue</h2><span className="mm-chip">{requests?.total ?? 0} total</span></div>
          <div className="mm-card-body mm-table-wrap">
            {requests?.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Amount</th><th>Destination</th><th>Status</th><th>Requested</th><th></th></tr></thead><tbody>{requests.items.map((row) => <tr key={text(row.id)}><td><strong>{text(row.username)}</strong><br /><span>{text(row.email)}</span></td><td><strong>{money(row.amount, row.currencyCode)}</strong><br /><span>Net {money(row.netAmount, row.currencyCode)}</span></td><td>{text(row.destinationLabel)}<br /><span>{text(row.destinationType).replaceAll('_', ' ')}</span></td><td><span className={`mm-chip ${tone(row.status)}`}>{text(row.status).replaceAll('_', ' ')}</span></td><td>{row.requestedAt ? new Date(text(row.requestedAt)).toLocaleString() : '—'}</td><td><button className="mm-button secondary" type="button" onClick={() => void loadDetail(text(row.id))}>Open</button></td></tr>)}</tbody></table> : <div className="mm-empty">No withdrawal requests match this queue.</div>}
          </div>
        </section>

        {selectedId ? (
          <section className="mm-card" style={{ marginBottom: 20 }}>
            <div className="mm-card-head"><h2>Request detail</h2><span className={`mm-chip ${tone(detailStatus)}`}>{detailStatus.replaceAll('_', ' ')}</span></div>
            <div className="mm-card-body">
              {detail ? <>
                <div className="mm-grid two" style={{ marginBottom: 16 }}><div className="mm-list"><div className="mm-list-row"><span>Member</span><strong>{text(detail.username)}</strong></div><div className="mm-list-row"><span>Gross amount</span><strong>{money(detail.amount, detail.currencyCode)}</strong></div><div className="mm-list-row"><span>Fee / net</span><strong>{money(detail.feeAmount, detail.currencyCode)} / {money(detail.netAmount, detail.currencyCode)}</strong></div><div className="mm-list-row"><span>KYC snapshot</span><strong>{text(detail.kycStatusSnapshot)}</strong></div></div><div className="mm-list"><div className="mm-list-row"><span>Destination</span><strong>{text(detail.destinationLabel)}</strong></div><div className="mm-list-row"><span>Reference</span><strong>{text(detail.destinationReference)}</strong></div><div className="mm-list-row"><span>Policy</span><strong>{text(detail.policyCode)} v{text(detail.policyVersion)}</strong></div><div className="mm-list-row"><span>Ledger transaction</span><strong>{text(detail.ledgerTransactionId)}</strong></div></div></div>

                {detailStatus === 'REQUESTED' ? <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}><button className="mm-button" type="button" disabled={busy} onClick={() => void mutate(`/api/backend/admin/withdrawals/requests/${selectedId}/approve`, 'POST')}>Approve</button><div className="mm-field" style={{ margin: 0, minWidth: 280 }}><label htmlFor="withdrawal-reason">Reject / cancel reason</label><input className="mm-input" id="withdrawal-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div><button className="mm-button secondary" type="button" disabled={busy || reason.trim().length < 2} onClick={() => void mutate(`/api/backend/admin/withdrawals/requests/${selectedId}/reject`, 'POST', { reason })}>Reject</button></div> : null}

                {detailStatus === 'APPROVED' || detailStatus === 'PAYOUT_FAILED' ? <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}><div className="mm-field" style={{ margin: 0 }}><label htmlFor="withdrawal-provider">Provider</label><input className="mm-input" id="withdrawal-provider" value={provider} onChange={(event) => setProvider(event.target.value)} /></div><div className="mm-field" style={{ margin: 0 }}><label htmlFor="withdrawal-provider-ref">Provider reference</label><input className="mm-input" id="withdrawal-provider-ref" value={providerReference} onChange={(event) => setProviderReference(event.target.value)} /></div><button className="mm-button" type="button" disabled={busy || provider.trim().length < 2} onClick={() => void mutate(`/api/backend/admin/withdrawals/requests/${selectedId}/payout-attempts`, 'POST', { sourceKey: `admin-withdrawal-payout:${crypto.randomUUID()}`, provider, providerReference: providerReference || undefined })}>Start payout</button><div className="mm-field" style={{ margin: 0, minWidth: 260 }}><label htmlFor="withdrawal-cancel-reason">Cancel reason</label><input className="mm-input" id="withdrawal-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div><button className="mm-button secondary" type="button" disabled={busy || reason.trim().length < 2} onClick={() => void mutate(`/api/backend/admin/withdrawals/requests/${selectedId}/cancel`, 'POST', { reason })}>Cancel & release</button></div> : null}

                {detailStatus === 'PROCESSING' && latestAttempt ? <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}><div><strong>{text(latestAttempt.provider)}</strong><br /><span>{text(latestAttempt.providerReference)}</span></div><button className="mm-button" type="button" disabled={busy} onClick={() => void mutate(`/api/backend/admin/withdrawals/payout-attempts/${text(latestAttempt.id)}/confirm`, 'PATCH', { providerReference: providerReference || undefined })}>Confirm paid</button><div className="mm-field" style={{ margin: 0, minWidth: 280 }}><label htmlFor="withdrawal-failure-reason">Failure reason</label><input className="mm-input" id="withdrawal-failure-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div><button className="mm-button secondary" type="button" disabled={busy || reason.trim().length < 2} onClick={() => void mutate(`/api/backend/admin/withdrawals/payout-attempts/${text(latestAttempt.id)}/fail`, 'PATCH', { reason })}>Mark failed</button></div> : null}

                <div className="mm-list" style={{ marginTop: 18 }}>{detail.payoutAttempts.map((attempt) => <div className="mm-list-row" key={text(attempt.id)}><div><strong>{text(attempt.provider)}</strong><br /><span>{text(attempt.providerReference)}</span></div><span className={`mm-chip ${tone(attempt.status)}`}>{text(attempt.status)}</span></div>)}</div>
              </> : <div className="mm-empty">Loading request…</div>}
            </div>
          </section>
        ) : null}

        <div className="mm-grid two">
          <section className="mm-card">
            <div className="mm-card-head"><h2>Policies</h2><span className="mm-chip">Versioned configuration</span></div>
            <div className="mm-card-body">
              <form onSubmit={createPolicy} style={{ marginBottom: 20 }}><div className="mm-field"><label htmlFor="policy-code">Code</label><input className="mm-input" id="policy-code" value={policyCode} onChange={(event) => setPolicyCode(event.target.value)} required /></div><div className="mm-field"><label htmlFor="policy-name">Name</label><input className="mm-input" id="policy-name" value={policyName} onChange={(event) => setPolicyName(event.target.value)} required /></div><div className="mm-field"><label htmlFor="policy-currency">Currency</label><input className="mm-input" id="policy-currency" maxLength={3} value={policyCurrency} onChange={(event) => setPolicyCurrency(event.target.value.toUpperCase())} required /></div><button className="mm-button" type="submit" disabled={busy}>Create policy</button></form>
              <div className="mm-list">{policies.map((policy) => <div className="mm-list-row" key={policy.id}><div><strong>{policy.name}</strong><br /><span>{policy.code} · {policy.currencyCode}</span></div><div style={{ textAlign: 'right' }}>{policy.versions.map((version) => <div key={text(version.id)} style={{ marginBottom: 6 }}><span className={`mm-chip ${tone(version.lifecycle)}`}>v{text(version.version)} {text(version.lifecycle)}</span>{version.lifecycle === 'DRAFT' ? <button className="mm-button secondary" style={{ marginLeft: 6 }} type="button" disabled={busy} onClick={() => void mutate(`/api/backend/admin/withdrawals/policy-versions/${text(version.id)}/publish`, 'POST')}>Publish</button> : null}{version.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" style={{ marginLeft: 6 }} type="button" disabled={busy} onClick={() => void mutate(`/api/backend/admin/withdrawals/policy-versions/${text(version.id)}/retire`, 'POST')}>Retire</button> : null}</div>)}</div></div>)}</div>
            </div>
          </section>

          <section className="mm-card">
            <div className="mm-card-head"><h2>Create policy version</h2><span className="mm-chip">Draft first</span></div>
            <div className="mm-card-body"><form onSubmit={createVersion}><div className="mm-field"><label htmlFor="version-policy">Policy</label><select className="mm-input" id="version-policy" value={versionPolicyId} onChange={(event) => setVersionPolicyId(event.target.value)} required>{policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name} · {policy.currencyCode}</option>)}</select></div><div className="mm-field"><label htmlFor="version-effective">Effective from</label><input className="mm-input" id="version-effective" type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /></div><div className="mm-grid two"><div className="mm-field"><label htmlFor="version-min">Min amount</label><input className="mm-input" id="version-min" type="number" min="0.01" step="0.01" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} required /></div><div className="mm-field"><label htmlFor="version-max">Max amount</label><input className="mm-input" id="version-max" type="number" min="0.01" step="0.01" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} required /></div></div><div className="mm-grid two"><div className="mm-field"><label htmlFor="version-fee-mode">Fee mode</label><select className="mm-input" id="version-fee-mode" value={feeMode} onChange={(event) => setFeeMode(event.target.value)}><option value="FIXED">Fixed</option><option value="PERCENTAGE">Percentage</option></select></div><div className="mm-field"><label htmlFor="version-fee-value">Fee value</label><input className="mm-input" id="version-fee-value" type="number" min="0" step="0.0001" value={feeValue} onChange={(event) => setFeeValue(event.target.value)} required /></div></div><div className="mm-field"><label htmlFor="version-pending">Max pending requests</label><input className="mm-input" id="version-pending" type="number" min="1" max="100" value={maxPending} onChange={(event) => setMaxPending(event.target.value)} required /></div><div className="mm-field"><label htmlFor="version-types">Allowed destination types</label><input className="mm-input" id="version-types" value={allowedTypes} onChange={(event) => setAllowedTypes(event.target.value)} /></div><label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}><input type="checkbox" checked={kycRequired} onChange={(event) => setKycRequired(event.target.checked)} /> Require approved KYC</label><button className="mm-button" type="submit" disabled={busy || !versionPolicyId}>Create draft version</button></form></div>
          </section>
        </div>
      </main>
    </div>
  );
}
