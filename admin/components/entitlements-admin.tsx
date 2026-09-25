'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Row = Record<string, unknown>;
type Page<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };
type Policy = Row & { versions?: Row[] };
type Program = Row;

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '—';
}

function date(value: unknown): string {
  if (typeof value !== 'string') return text(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function internalCode(value: string): string {
  const base = value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'BENEFIT';
  return `${base}_${Date.now().toString(36).toUpperCase().slice(-5)}`.slice(0, 50);
}

function statusLabel(value: unknown): string {
  const status = text(value);
  if (status === 'GRANTED') return 'Ready to claim';
  if (status === 'CLAIMED') return 'Claimed';
  if (status === 'FULFILLED') return 'Delivered';
  if (status === 'CANCELLED') return 'Cancelled';
  if (status === 'EXPIRED') return 'Expired';
  if (status === 'PUBLISHED') return 'LIVE';
  if (status === 'DRAFT') return 'DRAFT CHANGES';
  if (status === 'RETIRED') return 'PREVIOUS';
  return status.replaceAll('_', ' ');
}

function grantSummary(value: unknown, products: Row[]): string {
  if (!Array.isArray(value) || !value.length) return 'No products configured';
  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Row : {};
    const product = products.find((entry) => String(entry.code) === String(row.productCode));
    return `${text(product?.name ?? row.productCode)} × ${text(row.quantity ?? 1)}`;
  }).join(', ');
}

export function EntitlementsAdmin() {
  const router = useRouter();
  const [products, setProducts] = useState<Row[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [entitlements, setEntitlements] = useState<Page<Row> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [productName, setProductName] = useState('');
  const [productKind, setProductKind] = useState('GOODS');
  const [productValue, setProductValue] = useState('');
  const [productCurrency, setProductCurrency] = useState('INR');

  const [policyName, setPolicyName] = useState('');
  const [policyProgramId, setPolicyProgramId] = useState('');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date(Date.now() - 60_000).toISOString().slice(0, 16));
  const [minimumPaidInstallments, setMinimumPaidInstallments] = useState('0');
  const [minimumPaidAmount, setMinimumPaidAmount] = useState('');
  const [requireCompleted, setRequireCompleted] = useState(true);
  const [excludeWinner, setExcludeWinner] = useState(false);
  const [claimWindowDays, setClaimWindowDays] = useState('30');
  const [grantProductCode, setGrantProductCode] = useState('');
  const [grantQuantity, setGrantQuantity] = useState('1');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextProducts, nextPrograms, nextPolicies, nextEntitlements] = await Promise.all([
        apiJson<Row[]>('/api/backend/admin/entitlements/products'),
        apiJson<Program[]>('/api/backend/admin/programs'),
        apiJson<Policy[]>('/api/backend/admin/entitlements/policies'),
        apiJson<Page<Row>>('/api/backend/admin/entitlements/items?page=1&limit=50'),
      ]);
      setProducts(nextProducts);
      setPrograms(nextPrograms);
      setPolicies(nextPolicies);
      setEntitlements(nextEntitlements);
      setSelectedPolicyId((current) => current || String(nextPolicies[0]?.id ?? ''));
      setGrantProductCode((current) => current || String(nextProducts[0]?.code ?? ''));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      if (reason instanceof ApiClientError && reason.status === 403 && reason.message.toLowerCase().includes('password')) {
        router.replace('/change-password');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load product benefits');
    } finally {
      setLoading(false);
    }
  }, [router]);

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
      setError(reason instanceof ApiClientError ? reason.message : reason instanceof Error ? reason.message : 'Unable to save changes');
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
          code: internalCode(productName),
          name: productName.trim(),
          kind: productKind,
          ...(productValue ? { nominalValue: Number(productValue), currencyCode: productCurrency } : {}),
        }),
      });
      setProductName('');
      setProductValue('');
    }, 'Product saved.');
  }

  async function createPolicy(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const created = await apiJson<Row>('/api/backend/admin/entitlements/policies', {
        method: 'POST',
        body: JSON.stringify({
          code: internalCode(policyName),
          name: policyName.trim(),
          ...(policyProgramId ? { programId: policyProgramId } : {}),
          isDefault: true,
        }),
      });
      setSelectedPolicyId(String(created.id));
      setPolicyName('');
      setPolicyProgramId('');
    }, 'Benefit plan created. Add the eligibility settings below, then make it live when ready.');
  }

  async function createVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPolicyId) {
      setError('Choose a benefit plan first.');
      return;
    }
    if (!grantProductCode) {
      setError('Choose the product or benefit members should receive.');
      return;
    }
    await runAction(async () => {
      await apiJson(`/api/backend/admin/entitlements/policies/${selectedPolicyId}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(effectiveFrom).toISOString(),
          minimumPaidInstallments: Number(minimumPaidInstallments),
          ...(minimumPaidAmount ? { minimumPaidAmount: Number(minimumPaidAmount) } : {}),
          requireEnrollmentCompleted: requireCompleted,
          excludeAnyLuckyDrawWinner: excludeWinner,
          ...(claimWindowDays ? { claimWindowDays: Number(claimWindowDays) } : {}),
          grantItems: [{ productCode: grantProductCode, quantity: Math.max(1, Number(grantQuantity) || 1) }],
          rules: { configuredFrom: 'admin-web' },
        }),
      });
    }, 'Draft benefit rules saved. Members are not affected until you make them live.');
  }

  async function fulfill(entitlementId: string) {
    const reference = window.prompt('Delivery reference (optional):', '') ?? '';
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
    }, 'Product marked as delivered.');
  }

  async function cancel(entitlementId: string) {
    const reason = window.prompt('Why is this benefit being cancelled?');
    if (!reason) return;
    await runAction(async () => {
      await apiJson(`/api/backend/admin/entitlements/items/${entitlementId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    }, 'Benefit cancelled.');
  }

  async function logout() {
    await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">GoldenClub</span></div><div className="mm-brand-subtitle">Products & member benefits</div></div></div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Link className="mm-button secondary" href="/operations">Dashboard</Link><Link className="mm-button secondary" href="/business-plan">Business setup</Link><Link className="mm-button secondary" href="/withdrawals">Withdrawals</Link><Link className="mm-button secondary" href="/kyc">KYC</Link><button className="mm-button secondary" type="button" onClick={() => void logout()}>Sign out</button></nav>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row"><div><p className="mm-eyebrow">Member benefits</p><h1 className="mm-title">Products & benefits</h1><p className="mm-subtitle">Choose what members receive, when they become eligible and track delivery from one simple page.</p></div><button className="mm-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {message ? <div className="mm-success" role="status">{message}</div> : null}

        <div className="mm-grid two" style={{ marginBottom: 20 }}>
          <section className="mm-card"><div className="mm-card-head"><h2>Add a product or benefit</h2><span className="mm-chip">{products.length} saved</span></div><form method="post" className="mm-card-body mm-form" onSubmit={(event) => void createProduct(event)}><label>Product name<input minLength={2} maxLength={120} value={productName} onChange={(event) => setProductName(event.target.value)} required /></label><label>Type<select value={productKind} onChange={(event) => setProductKind(event.target.value)}><option value="GOODS">Physical product</option><option value="SERVICE">Service</option><option value="BENEFIT">Member benefit</option><option value="BUNDLE">Bundle</option><option value="OTHER">Other</option></select></label><div className="mm-grid two"><label>Approx. value (optional)<input type="number" min="0" step="0.01" value={productValue} onChange={(event) => setProductValue(event.target.value)} /></label><label>Currency<input maxLength={3} value={productCurrency} onChange={(event) => setProductCurrency(event.target.value.toUpperCase())} /></label></div><button className="mm-button" disabled={busy || productName.trim().length < 2} type="submit">Save product</button></form></section>

          <section className="mm-card"><div className="mm-card-head"><h2>Create a benefit plan</h2><span className="mm-chip">{policies.length} saved</span></div><form method="post" className="mm-card-body mm-form" onSubmit={(event) => void createPolicy(event)}><label>Benefit plan name<input minLength={2} maxLength={120} value={policyName} onChange={(event) => setPolicyName(event.target.value)} required /></label><label>Apply to membership plan<select value={policyProgramId} onChange={(event) => setPolicyProgramId(event.target.value)}><option value="">All membership plans</option>{programs.map((program) => <option value={String(program.id)} key={String(program.id)}>{text(program.name)}</option>)}</select></label><button className="mm-button" disabled={busy || policyName.trim().length < 2} type="submit">Create benefit plan</button></form></section>
        </div>

        <section className="mm-card" style={{ marginBottom: 20 }}>
          <div className="mm-card-head"><div><h2>Who receives the benefit?</h2><p className="mm-note">Save changes as a draft first. Make them live only after reviewing the rules.</p></div><span className="mm-chip">Safe draft → live</span></div>
          <div className="mm-card-body">
            <form method="post" className="mm-form" onSubmit={(event) => void createVersion(event)}>
              <label>Benefit plan<select value={selectedPolicyId} onChange={(event) => setSelectedPolicyId(event.target.value)} required><option value="">Choose benefit plan</option>{policies.map((policy) => <option value={String(policy.id)} key={String(policy.id)}>{text(policy.name)}</option>)}</select></label>
              <div className="mm-grid two">
                <label>Starts from<input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /></label>
                <label>Claim within (days)<input type="number" min="0" max="36500" value={claimWindowDays} onChange={(event) => setClaimWindowDays(event.target.value)} /></label>
                <label>Minimum paid installments<input type="number" min="0" max="1000" value={minimumPaidInstallments} onChange={(event) => setMinimumPaidInstallments(event.target.value)} /></label>
                <label>Minimum amount paid (optional)<input type="number" min="0" step="0.01" value={minimumPaidAmount} onChange={(event) => setMinimumPaidAmount(event.target.value)} /></label>
                <label>Product / benefit to give<select value={grantProductCode} onChange={(event) => setGrantProductCode(event.target.value)} required><option value="">Choose product</option>{products.map((product) => <option value={String(product.code)} key={String(product.id)}>{text(product.name)}</option>)}</select></label>
                <label>Quantity<input type="number" min="1" max="1000" step="1" value={grantQuantity} onChange={(event) => setGrantQuantity(event.target.value)} required /></label>
              </div>
              <label><input type="checkbox" checked={requireCompleted} onChange={(event) => setRequireCompleted(event.target.checked)} /> Member must complete the membership plan first</label>
              <label><input type="checkbox" checked={excludeWinner} onChange={(event) => setExcludeWinner(event.target.checked)} /> Do not give this benefit to members who already won a lucky draw</label>
              <button className="mm-button" disabled={busy || !selectedPolicyId || !grantProductCode} type="submit">Save draft rules</button>
            </form>

            {selectedPolicy ? <div className="mm-list" style={{ marginTop: 18 }}>{(selectedPolicy.versions ?? []).map((version) => <div className="mm-list-row" key={String(version.id)}><div><strong>{statusLabel(version.lifecycle)}</strong><br /><span>From {date(version.effectiveFrom)} · after {text(version.minimumPaidInstallments)} paid installment(s)</span><br /><span>Benefit: {grantSummary(version.grantItems, products)}</span></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{version.lifecycle === 'DRAFT' ? <button className="mm-button" type="button" disabled={busy} onClick={() => void runAction(async () => { if (!window.confirm('Make these member benefit rules live now?')) return; await apiJson(`/api/backend/admin/entitlements/policy-versions/${version.id}/publish`, { method: 'POST' }); }, 'Benefit rules are now live.')}>Make live</button> : null}{version.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" type="button" disabled={busy} onClick={() => void runAction(async () => { if (!window.confirm('Stop using these benefit rules for new eligibility? Existing history will remain unchanged.')) return; await apiJson(`/api/backend/admin/entitlements/policy-versions/${version.id}/retire`, { method: 'POST' }); }, 'Benefit rules stopped for new eligibility.')}>Stop using</button> : null}</div></div>)}</div> : null}
          </div>
        </section>

        <section className="mm-card" style={{ marginBottom: 20 }}><div className="mm-card-head"><h2>Automatic benefit creation</h2><span className="mm-chip">Recommended</span></div><div className="mm-card-body"><p className="mm-note">Use Business setup → Automatic rules to choose when eligible member benefits should be created. The owner does not need to enter enrollment or policy IDs manually.</p><Link className="mm-button" href="/business-plan">Open automatic rules</Link></div></section>

        <section className="mm-card"><div className="mm-card-head"><h2>Member benefit delivery</h2><span className="mm-chip">{entitlements?.total ?? 0} total</span></div><div className="mm-card-body mm-table-wrap">{entitlements?.items.length ? <table className="mm-table"><thead><tr><th>Member</th><th>Product</th><th>Membership</th><th>Status</th><th>Granted</th><th>Action</th></tr></thead><tbody>{entitlements.items.map((row) => <tr key={String(row.id)}><td><strong>{text(row.username)}</strong><br /><span>{text(row.email)}</span></td><td>{text(row.productName)}<br /><span>Qty {text(row.quantity)}</span></td><td>{text(row.programName)}</td><td><span className="mm-chip">{statusLabel(row.status)}</span></td><td>{date(row.grantedAt)}</td><td>{row.status === 'CLAIMED' ? <button className="mm-button" disabled={busy} type="button" onClick={() => void fulfill(String(row.id))}>Mark delivered</button> : null}{row.status === 'GRANTED' || row.status === 'CLAIMED' ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void cancel(String(row.id))}>Cancel benefit</button> : null}</td></tr>)}</tbody></table> : <div className="mm-empty">No member benefits recorded yet.</div>}</div></section>
      </main>
    </div>
  );
}
