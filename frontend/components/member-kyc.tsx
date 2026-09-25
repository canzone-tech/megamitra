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
};

type KycState = {
  profile: {
    status: string;
    approvedAt: string | null;
    lastSubmittedAt: string | null;
    lastReviewedAt: string | null;
    submissions: Submission[];
  };
  currentPolicy: {
    id: string;
    requirements: Record<string, unknown>;
    policy: { code: string; name: string; description: string | null };
  } | null;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function label(value: string): string {
  return value
    .replaceAll('.', ' · ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setNested(target: Record<string, unknown>, path: string, value: string) {
  const segments = path.split('.');
  let current = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const next = current[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  });
}

function statusTone(status: string): string {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED' || status === 'RESUBMISSION_REQUIRED') return 'danger';
  if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') return 'warning';
  return '';
}

export function MemberKyc() {
  const router = useRouter();
  const [state, setState] = useState<KycState | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [documentRefs, setDocumentRefs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await apiJson<KycState>('/api/backend/kyc/me'));
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
      setError(
        reason instanceof ApiClientError
          ? reason.message
          : 'Unable to load KYC status',
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const requiredFields = useMemo(
    () => strings(state?.currentPolicy?.requirements.fields),
    [state],
  );
  const requiredDocuments = useMemo(
    () => strings(state?.currentPolicy?.requirements.documents),
    [state],
  );
  const canSubmit =
    state?.profile.status === 'NOT_STARTED' ||
    state?.profile.status === 'REJECTED' ||
    state?.profile.status === 'RESUBMISSION_REQUIRED';

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state?.currentPolicy || !canSubmit) return;
    setBusy(true);
    setError('');
    setSuccess('');
    const data: Record<string, unknown> = {};
    requiredFields.forEach((field) => setNested(data, field, fields[field] ?? ''));
    const documents = requiredDocuments.map((type) => ({
      type,
      reference: documentRefs[type] ?? '',
    }));

    try {
      await apiJson('/api/backend/kyc/me/submissions', {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `member-kyc:${crypto.randomUUID()}`,
          data,
          documents,
        }),
      });
      setSuccess('KYC submitted successfully. Your review status is now tracked here.');
      await load();
    } catch (reason) {
      setError(
        reason instanceof ApiClientError
          ? reason.message
          : 'Unable to submit KYC',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/member">
          <span className="mm-brand-mark">M</span>
          <span>Mega<span className="mm-brand-accent">GoldenClub</span></span>
        </Link>
        <nav className="mm-nav">
          <Link className="mm-button light" href="/member">Dashboard</Link>
          <Link className="mm-button light" href="/member/security">Security</Link>
          <Link className="mm-button light" href="/">Public site</Link>
        </nav>
      </header>

      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div>
            <p className="mm-eyebrow">Identity verification</p>
            <h1 className="mm-title">KYC</h1>
            <p className="mm-subtitle">Complete the requested details and document references to submit your KYC for review.</p>
          </div>
          <button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {success ? <div className="mm-success" role="status">{success}</div> : null}

        {state ? (
          <div className="mm-wide-grid">
            <section className="mm-card">
              <div className="mm-card-head">
                <h2>Verification status</h2>
                <span className={`mm-chip ${statusTone(state.profile.status)}`}>{state.profile.status.replaceAll('_', ' ')}</span>
              </div>
              <div className="mm-card-body mm-list">
                <div className="mm-list-row"><span>Active policy</span><strong>{state.currentPolicy?.policy.name ?? 'No active policy'}</strong></div>
                <div className="mm-list-row"><span>Policy code</span><strong>{state.currentPolicy?.policy.code ?? '—'}</strong></div>
                <div className="mm-list-row"><span>Last submitted</span><strong>{state.profile.lastSubmittedAt ? new Date(state.profile.lastSubmittedAt).toLocaleString() : '—'}</strong></div>
                <div className="mm-list-row"><span>Approved</span><strong>{state.profile.approvedAt ? new Date(state.profile.approvedAt).toLocaleString() : '—'}</strong></div>
              </div>
            </section>

            <section className="mm-card">
              <div className="mm-card-head"><h2>{canSubmit ? 'Submit KYC' : 'Submission locked'}</h2><span className="mm-chip">Current requirements</span></div>
              <div className="mm-card-body">
                {!state.currentPolicy ? <div className="mm-empty">KYC submission is not available right now.</div> : canSubmit ? (
                  <form method="post" onSubmit={submit}>
                    {requiredFields.map((field) => (
                      <div className="mm-field" key={field}>
                        <label htmlFor={`kyc-field-${field}`}>{label(field)}</label>
                        <input className="mm-input" id={`kyc-field-${field}`} value={fields[field] ?? ''} onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.value }))} required />
                      </div>
                    ))}
                    {requiredDocuments.map((type) => (
                      <div className="mm-field" key={type}>
                        <label htmlFor={`kyc-document-${type}`}>{label(type)} document reference</label>
                        <input className="mm-input" id={`kyc-document-${type}`} value={documentRefs[type] ?? ''} onChange={(event) => setDocumentRefs((current) => ({ ...current, [type]: event.target.value }))} placeholder="Enter the reference for this document" required />
                      </div>
                    ))}
                    <button className="mm-button blue" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
                  </form>
                ) : <div className="mm-empty">Your current status does not accept another submission. A new submission becomes available after a rejection or resubmission request.</div>}
              </div>
            </section>

            <section className="mm-card" style={{ gridColumn: '1 / -1' }}>
              <div className="mm-card-head"><h2>Submission history</h2><span className="mm-chip">{state.profile.submissions.length} recent</span></div>
              <div className="mm-card-body">
                {state.profile.submissions.length ? <div className="mm-list">{state.profile.submissions.map((submission) => (
                  <div className="mm-list-row" key={submission.id}>
                    <div><strong>{submission.status.replaceAll('_', ' ')}</strong><br /><span>{new Date(submission.submittedAt).toLocaleString()}</span></div>
                    <div style={{ textAlign: 'right' }}>{submission.reviewReason ? <span>{submission.reviewReason}</span> : <span>{submission.reviewedAt ? `Reviewed ${new Date(submission.reviewedAt).toLocaleString()}` : 'Awaiting review'}</span>}</div>
                  </div>
                ))}</div> : <div className="mm-empty">No KYC submissions yet.</div>}
              </div>
            </section>
          </div>
        ) : loading ? <div className="mm-card mm-empty">Loading KYC status…</div> : null}
      </main>
    </div>
  );
}
