'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Row = Record<string, unknown>;
type Page<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };
type Policy = Row & { versions?: Row[] };

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

export function EntitlementsAdmin() {
  const router = useRouter();
  const [products, setProducts] = useState<Row[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [entitlements, setEntitlements] = useState<Page<Row> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [productKind, setProductKind] = useState('BENEFIT');
  const [productValue, setProductValue] = useState('');
  const [productCurrency, setProductCurrency] = useState('INR');

  const [policyCode, setPolicyCode] = useState('');
  const [policyName, setPolicyName] = useState('');
  const [policyProgramId, setPolicyProgramId] = useState('');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date(Date.now() - 60_000).toISOString().slice(0, 16));
  const [minimumPaidInstallments, setMinimumPaidInstallments] = useState('0');
  const [minimumPaidAmount, setMinimumPaidAmount] = useState('');
  const [requireCompleted, setRequireCompleted] = useState(true);
  const [excludeWinner, setExcludeWinner] = useState(false);
  const [claimWindowDays, setClaimWindowDays] = useState('30');
  const [grantItemsText, setGrantItemsText] = useState('[{"productCode":"CONSUMER_PRODUCT_BENEFIT","quantity":1}]');

  const [generationEnrollmentId, setGenerationEnrollmentId] = useState('');
  const [generationPolicyVersionId, setGenerationPolicyVersionId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextProducts, nextPolicies, nextEntitlements] = await Promise.all([
        apiJson<Row[]>('/api/backend/admin/entitlements/products'),
        apiJson<Policy[]>('/api/backend/admin/entitlements/policies'),
        apiJson<Page<Row>>('/api/backend/admin/entitlements/items?page=1&limit=50'),
      ]);
      setProducts(nextProducts);
      setPolicies(nextPolicies);
      setEntitlements(nextEntitlements);
      if (!selectedPolicyId && nextPolicies[0]?.id) setSelectedPolicyId(String(nextPolicies[0].id));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load product entitlement administration');
    } finally {
      setLoading(false);
    }
  }, [router, selectedPolicyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => String(policy.id) === selectedPolicyId),
    [policies, selectedPolicyId],
  );

  async function runAction(action: () => Promise<void>, successMessage: string) {
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

  async function createProduct(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await apiJson('/api/backend/admin/entitlements/products', {
        method: 'POST',
        body: JSON.stringify({
          code: productCode,
          name: productName,
          kind: productKind,
          ...(productValue ? { nominalValue: Number(productValue), currencyCode: productCurrency } : {}),
        }),
      });
      setProductCode('');
      setProductName('');
      setProductValue('');
    }, 'Catalog product created.');
  }

  async function createPolicy(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const created = await apiJson<Row>('/api/backend/admin/entitlements/policies', {
        method: 'POST',
        body: JSON.stringify({
          code: policyCode,
          name: policyName,
          ...(policyProgramId ? { programId: policyProgramId } : {}),
          isDefault: true,
        }),
      });
      setSelectedPolicyId(String(created.id));
      setPolicyCode('');
      setPolicyName('');
      setPolicyProgramId('');
    }, 'Entitlement policy created.');
  }

  async function createVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPolicyId) {
      setError('Choose an entitlement policy first.');
      return;
    }
    await runAction(async () => {
      const grantItems = JSON.parse(grantItemsText) as unknown;
      await apiJson(`/api/backend/admin/entitlements/policies/${selectedPolicyId}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(effectiveFrom).toISOString(),
          minimumPaidInstallments: Number(minimumPaidInstallments),
          ...(minimumPaidAmount ? { minimumPaidAmount: Number(minimumPaidAmount) } : {}),
          requireEnrollmentCompleted: requireCompleted,
          excludeAnyLuckyDrawWinner: excludeWinner,
          ...(claimWindowDays ? { claimWindowDays: Number(claimWindowDays) } : {}),
          grantItems,
          rules: { configuredFrom: 'admin-web' },
        }),
      });
    }, 'Entitlement policy draft created.');
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const result = await apiJson<Row>('/api/backend/admin/entitlements/generate', {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `admin-entitlement:${crypto.randomUUID()}`,
          enrollmentId: generationEnrollmentId,
          ...(generationPolicyVersionId ? { policyVersionId: generationPolicyVersionId } : {}),
        }),
      });
      setMessage(`Generation result: ${text(result.status)} · ${text(result.generatedCount)} new entitlement(s).`);
    }, 'Entitlement generation evaluated.');
  }

  async function fulfill(entitlementId: string) {
    const reference = window.prompt('Delivery / fulfillment reference (optional):', '') ?? '';
    await runAction(async () => {
      const attempt = await apiJson<Row>(`/api/backend/admin/entitlements/items/${entitlementId}/fulfillment-attempts`, {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `manual-fulfillment:${crypto.randomUUID()}`,
          provider: 'MANUAL_ADMIN',
          ...(reference ? { providerReference: reference } : {}),
        }),
      });
      await apiJson(`/api/backend/admin/entitlements/fulfillment-attempts/${attempt.id}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ ...(reference ? { providerReference: reference } : {}), metadata: { channel: 'admin-web' } }),
      });
    }, 'Entitlement marked fulfilled.');
  }

  async function cancel(entitlementId: string) {
    const reason = window.prompt('Cancellation reason:');
    if (!reason) return;
    await runAction(async () => {
      await apiJson(`/api/backend/admin/entitlements/items/${entitlementId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    }, 'Entitlement cancelled.');
  }

  async function logout() {
    await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">Mitra</span></div><div className="mm-brand-subtitle">Products & entitlements</div></div></div>
        <nav style={{ display: 'flex', gap: 8 }}><Link className="mm-button secondary" href="/operations">Operations</Link><Link className="mm-button secondary" href="/withdrawals">Withdrawals</Link><Link className="mm-button secondary" href="/kyc">KYC</Link><button className="mm-button secondary" type="button" onClick={() => void logout()}>Sign out</button></nav>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row"><div><p className="mm-eyebrow">Configurable consumer rewards</p><h1 className="mm-title">Product entitlement control</h1><p className="mm-subtitle">Catalog items, published entitlement rules, eligibility generation, member claims and provider-neutral fulfillment are kept auditable and versioned.</p></div><button className="mm-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {message ? <div className="mm-success" role="status">{message}</div> : null}

        <div className="mm-grid two" style={{ marginBottom: 20 }}>
          <section className="mm-card"><div className="mm-card-head"><h2>New catalog product</h2><span className="mm-chip">{products.length} products</span></div><form className="mm-card-body mm-form" onSubmit={(event) => void createProduct(event)}><label>Code<input value={productCode} onChange={(event) => setProductCode(event.target.value)} required /></label><label>Name<input value={productName} onChange={(event) => setProductName(event.target.value)} required /></label><label>Kind<select value={productKind} onChange={(event) => setProductKind(event.target.value)}><option>GOODS</option><option>SERVICE</option><option>BENEFIT</option><option>BUNDLE</option><option>OTHER</option></select></label><div className="mm-grid two"><label>Nominal value<input type="number" min="0" step="0.01" value={productValue} onChange={(event) => setProductValue(event.target.value)} /></label><label>Currency<input maxLength={3} value={productCurrency} onChange={(event) => setProductCurrency(event.target.value.toUpperCase())} /></label></div><button className="mm-button" disabled={busy} type="submit">Create product</button></form></section>
          <section className="mm-card"><div className="mm-card-head"><h2>New entitlement policy</h2><span className="mm-chip">{policies.length} policies</span></div><form className="mm-card-body mm-form" onSubmit={(event) => void createPolicy(event)}><label>Code<input value={policyCode} onChange={(event) => setPolicyCode(event.target.value)} required /></label><label>Name<input value={policyName} onChange={(event) => setPolicyName(event.target.value)} required /></label><label>Program ID <span>(optional; blank = global)</span><input value={policyProgramId} onChange={(event) => setPolicyProgramId(event.target.value)} /></label><button className="mm-button" disabled={busy} type="submit">Create default policy</button></form></section>
        </div>

        <section className="mm-card" style={{ marginBottom: 20 }}><div className="mm-card-head"><h2>Versioned entitlement rules</h2><span className="mm-chip">DRAFT → PUBLISHED → RETIRED</span></div><div className="mm-card-body"><form className="mm-form" onSubmit={(event) => void createVersion(event)}><label>Policy<select value={selectedPolicyId} onChange={(event) => setSelectedPolicyId(event.target.value)} required><option value="">Choose policy</option>{policies.map((policy) => <option value={String(policy.id)} key={String(policy.id)}>{text(policy.code)} · {text(policy.name)}</option>)}</select></label><div className="mm-grid two"><label>Effective from<input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /></label><label>Claim window days<input type="number" min="0" value={claimWindowDays} onChange={(event) => setClaimWindowDays(event.target.value)} /></label><label>Minimum paid installments<input type="number" min="0" value={minimumPaidInstallments} onChange={(event) => setMinimumPaidInstallments(event.target.value)} /></label><label>Minimum paid amount<input type="number" min="0" step="0.01" value={minimumPaidAmount} onChange={(event) => setMinimumPaidAmount(event.target.value)} /></label></div><label><input type="checkbox" checked={requireCompleted} onChange={(event) => setRequireCompleted(event.target.checked)} /> Require completed enrollment</label><label><input type="checkbox" checked={excludeWinner} onChange={(event) => setExcludeWinner(event.target.checked)} /> Exclude members with any lucky-draw win</label><label>Grant items JSON<textarea rows={4} value={grantItemsText} onChange={(event) => setGrantItemsText(event.target.value)} /></label><button className="mm-button" disabled={busy || !selectedPolicyId} type="submit">Create draft version</button></form>
          {selectedPolicy ? <div className="mm-list" style={{ marginTop: 18 }}>{(selectedPolicy.versions ?? []).map((version) => <div className="mm-list-row" key={String(version.id)}><div><strong>v{text(version.version)} · {text(version.lifecycle)}</strong><br /><span>From {date(version.effectiveFrom)} · {text(version.minimumPaidInstallments)} paid installment(s)</span><br /><span>{text(version.grantItems)}</span></div><div style={{ display: 'flex', gap: 8 }}>{version.lifecycle === 'DRAFT' ? <button className="mm-button" type="button" disabled={busy} onClick={() => void runAction(async () => { await apiJson(`/api/backend/admin/entitlements/policy-versions/${version.id}/publish`, { method: 'POST' }); }, 'Policy version published.')}>Publish</button> : null}{version.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" type="button" disabled={busy} onClick={() => void runAction(async () => { await apiJson(`/api/backend/admin/entitlements/policy-versions/${version.id}/retire`, { method: 'POST' }); }, 'Policy version retired.')}>Retire</button> : null}</div></div>)}</div> : null}
        </div></section>

        <section className="mm-card" style={{ marginBottom: 20 }}><div className="mm-card-head"><h2>Generate from enrollment</h2><span className="mm-chip">Idempotent evaluation</span></div><form className="mm-card-body mm-form" onSubmit={(event) => void generate(event)}><div className="mm-grid two"><label>Enrollment ID<input value={generationEnrollmentId} onChange={(event) => setGenerationEnrollmentId(event.target.value)} required /></label><label>Policy version ID <span>(optional; uses active default)</span><input value={generationPolicyVersionId} onChange={(event) => setGenerationPolicyVersionId(event.target.value)} /></label></div><button className="mm-button" disabled={busy} type="submit">Evaluate & generate</button></form></section>

        <section className="mm-card"><div className="mm-card-head"><h2>Entitlement queue</h2><span className="mm-chip">{entitlements?.total ?? 0} total</span></div><div className="mm-card-body mm-table-wrap">{entitlements?.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Product</th><th>Program</th><th>Status</th><th>Granted</th><th>Action</th></tr></thead><tbody>{entitlements.items.map((row) => <tr key={String(row.id)}><td><strong>{text(row.username)}</strong><br /><span>{text(row.email)}</span></td><td>{text(row.productName)}<br /><span>{text(row.productCode)} · Qty {text(row.quantity)}</span></td><td>{text(row.programName)}<br /><span>{text(row.policyCode)} v{text(row.policyVersion)}</span></td><td><span className="mm-chip">{text(row.status)}</span></td><td>{date(row.grantedAt)}</td><td>{row.status === 'CLAIMED' ? <button className="mm-button" disabled={busy} type="button" onClick={() => void fulfill(String(row.id))}>Fulfill</button> : null}{row.status === 'GRANTED' || row.status === 'CLAIMED' ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void cancel(String(row.id))}>Cancel</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No entitlements recorded yet.</div>}</div></section>
      </main>
    </div>
  );
}
