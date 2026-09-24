'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Submission = {
  id: string;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  data: Record<string, unknown>;
  documents: unknown[];
  user: {
    username: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  policyVersion: {
    id: string;
    version: number;
    policy: { code: string; name: string };
  };
};

type Page<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type PolicyVersion = {
  id: string;
  version: number;
  lifecycle: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  requirements: Record<string, unknown>;
};

type Policy = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  versions: PolicyVersion[];
};

function tone(status: string): string {
  if (status === 'APPROVED' || status === 'PUBLISHED') return 'success';
  if (status === 'REJECTED' || status === 'RESUBMISSION_REQUIRED' || status === 'RETIRED') return 'danger';
  if (status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'DRAFT') return 'warning';
  return '';
}

function memberName(submission: Submission): string {
  const full = [submission.user.firstName, submission.user.lastName].filter(Boolean).join(' ');
  return full || submission.user.username;
}

export function KycAdmin() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Page<Submission> | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [requiredFields, setRequiredFields] = useState('legalName,dateOfBirth,address');
  const [requiredDocuments, setRequiredDocuments] = useState('identity,address');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [queue, policyRows] = await Promise.all([
        apiJson<Page<Submission>>('/api/backend/admin/kyc/submissions?page=1&limit=50'),
        apiJson<Policy[]>('/api/backend/admin/kyc/policies'),
      ]);
      setSubmissions(queue);
      setPolicies(policyRows);
      if (!selectedId && queue.items.length) setSelectedId(queue.items[0].id);
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
      setError(reasonValue instanceof ApiClientError ? reasonValue.message : 'Unable to load KYC administration');
    } finally {
      setLoading(false);
    }
  }, [router, selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = useMemo(
    () => submissions?.items.find((item) => item.id === selectedId) ?? null,
    [selectedId, submissions],
  );
  const defaultPolicy = policies.find((policy) => policy.isDefault) ?? null;

  async function action(path: string, method: 'POST' | 'PATCH', body?: unknown) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson(`/api/backend${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setSuccess('KYC administration updated successfully.');
      await load();
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiClientError ? reasonValue.message : 'Unable to update KYC');
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!defaultPolicy) return;
    const from = effectiveFrom ? new Date(effectiveFrom).toISOString() : new Date().toISOString();
    const fields = requiredFields.split(',').map((value) => value.trim()).filter(Boolean);
    const documents = requiredDocuments.split(',').map((value) => value.trim()).filter(Boolean);
    await action(`/admin/kyc/policies/${defaultPolicy.id}/versions`, 'POST', {
      effectiveFrom: from,
      requirements: { fields, documents },
      reviewRules: { manualReviewRequired: true },
    });
  }

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <Link className="mm-brand" href="/operations"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">Mitra</span></div><div className="mm-brand-subtitle">Admin KYC</div></div></Link>
        <nav style={{ display: 'flex', gap: 8 }}><Link className="mm-button secondary" href="/operations">Operations</Link><Link className="mm-button secondary" href="/security">Security</Link></nav>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row">
          <div><p className="mm-eyebrow">Identity controls</p><h1 className="mm-title">KYC review & policy</h1><p className="mm-subtitle">Review member submissions against immutable published requirement versions. Decisions and policy lifecycle actions are audited.</p></div>
          <button className="mm-button" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {success ? <div className="mm-success" role="status">{success}</div> : null}

        <div className="mm-grid two">
          <section className="mm-card">
            <div className="mm-card-head"><h2>Review queue</h2><span className="mm-chip">{submissions?.total ?? 0} total</span></div>
            <div className="mm-card-body">
              {submissions?.items.length ? <div className="mm-list">{submissions.items.map((submission) => (
                <button type="button" className="mm-list-row" style={{ width: '100%', textAlign: 'left', background: selectedId === submission.id ? 'rgba(26, 78, 155, 0.06)' : 'transparent', border: 0, cursor: 'pointer' }} key={submission.id} onClick={() => { setSelectedId(submission.id); setReason(''); }}>
                  <div><strong>{memberName(submission)}</strong><br /><span>{submission.user.username} · {new Date(submission.submittedAt).toLocaleString()}</span></div>
                  <span className={`mm-chip ${tone(submission.status)}`}>{submission.status.replaceAll('_', ' ')}</span>
                </button>
              ))}</div> : <div className="mm-empty">No KYC submissions.</div>}
            </div>
          </section>

          <section className="mm-card">
            <div className="mm-card-head"><h2>Selected submission</h2>{selected ? <span className={`mm-chip ${tone(selected.status)}`}>{selected.status.replaceAll('_', ' ')}</span> : null}</div>
            <div className="mm-card-body">
              {selected ? <>
                <div className="mm-list" style={{ marginBottom: 16 }}>
                  <div className="mm-list-row"><span>Member</span><strong>{memberName(selected)}</strong></div>
                  <div className="mm-list-row"><span>Policy</span><strong>{selected.policyVersion.policy.code} v{selected.policyVersion.version}</strong></div>
                  <div className="mm-list-row"><span>Email</span><strong>{selected.user.email ?? '—'}</strong></div>
                </div>
                <p><strong>Submitted data</strong></p>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(selected.data, null, 2)}</pre>
                <p><strong>Document references</strong></p>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(selected.documents, null, 2)}</pre>
                {selected.status === 'SUBMITTED' || selected.status === 'UNDER_REVIEW' ? <>
                  <div className="mm-field"><label htmlFor="kyc-review-reason">Review reason / notes</label><textarea className="mm-input" id="kyc-review-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {selected.status === 'SUBMITTED' ? <button className="mm-button secondary" type="button" disabled={busy} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/start-review`, 'POST')}>Start review</button> : null}
                    <button className="mm-button" type="button" disabled={busy} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/review`, 'PATCH', { decision: 'APPROVED', reason: reason || undefined })}>Approve</button>
                    <button className="mm-button secondary" type="button" disabled={busy || !reason.trim()} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/review`, 'PATCH', { decision: 'RESUBMISSION_REQUIRED', reason })}>Request resubmission</button>
                    <button className="mm-button secondary" type="button" disabled={busy || !reason.trim()} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/review`, 'PATCH', { decision: 'REJECTED', reason })}>Reject</button>
                  </div>
                </> : <div className="mm-empty">This review is finalized.{selected.reviewReason ? ` Reason: ${selected.reviewReason}` : ''}</div>}
              </> : <div className="mm-empty">Select a submission from the queue.</div>}
            </div>
          </section>
        </div>

        <section className="mm-card" style={{ marginTop: 20 }}>
          <div className="mm-card-head"><h2>KYC policy lifecycle</h2><span className="mm-chip">{policies.length} polic{policies.length === 1 ? 'y' : 'ies'}</span></div>
          <div className="mm-card-body">
            {policies.length ? <div className="mm-list">{policies.map((policy) => (
              <div key={policy.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--mm-border)' }}>
                <div className="mm-list-row"><div><strong>{policy.name}</strong><br /><span>{policy.code}</span></div><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{policy.isDefault ? <span className="mm-chip success">DEFAULT</span> : <button className="mm-button secondary" type="button" disabled={busy} onClick={() => void action(`/admin/kyc/policies/${policy.id}/default`, 'POST')}>Set default</button>}</div></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>{policy.versions.map((version) => <span className={`mm-chip ${tone(version.lifecycle)}`} key={version.id}>v{version.version} · {version.lifecycle}</span>)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>{policy.versions.map((version) => version.lifecycle === 'DRAFT' ? <button className="mm-button secondary" type="button" disabled={busy} key={`publish-${version.id}`} onClick={() => void action(`/admin/kyc/policy-versions/${version.id}/publish`, 'POST')}>Publish v{version.version}</button> : version.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" type="button" disabled={busy} key={`retire-${version.id}`} onClick={() => void action(`/admin/kyc/policy-versions/${version.id}/retire`, 'POST')}>Retire v{version.version}</button> : null)}</div>
              </div>
            ))}</div> : <div className="mm-empty">No KYC policies configured.</div>}
          </div>
        </section>

        {defaultPolicy ? <section className="mm-card" style={{ marginTop: 20 }}>
          <div className="mm-card-head"><h2>Create next draft</h2><span className="mm-chip">{defaultPolicy.code}</span></div>
          <div className="mm-card-body"><form onSubmit={createDraft}>
            <div className="mm-field"><label htmlFor="kyc-effective-from">Effective from</label><input className="mm-input" id="kyc-effective-from" type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></div>
            <div className="mm-field"><label htmlFor="kyc-required-fields">Required fields (comma separated)</label><input className="mm-input" id="kyc-required-fields" value={requiredFields} onChange={(event) => setRequiredFields(event.target.value)} required /></div>
            <div className="mm-field"><label htmlFor="kyc-required-documents">Required document types (comma separated)</label><input className="mm-input" id="kyc-required-documents" value={requiredDocuments} onChange={(event) => setRequiredDocuments(event.target.value)} /></div>
            <button className="mm-button" type="submit" disabled={busy}>Create draft version</button>
          </form></div>
        </section> : null}
      </main>
    </div>
  );
}
