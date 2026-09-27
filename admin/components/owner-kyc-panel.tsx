'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { WorkspaceTabs } from '@/components/workspace-tabs';
import styles from './owner-portal.module.css';
import extension from './owner-portal-extension.module.css';

type Submission = {
  id: string;
  status: string;
  submittedAt: string;
  reviewReason: string | null;
  data: Record<string, unknown>;
  documents: unknown[];
  user: {
    username: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  policyVersion: {
    version: number;
    policy: { code: string; name: string };
  };
};

type SubmissionPage = {
  items: Submission[];
  total: number;
};

type PolicyVersion = {
  id: string;
  version: number;
  lifecycle: string;
};

type Policy = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  versions: PolicyVersion[];
};

function displayName(item: Submission) {
  return (
    [item.user.firstName, item.user.lastName].filter(Boolean).join(' ') ||
    item.user.username
  );
}

export function OwnerKycPanel() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<SubmissionPage | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [requiredFields, setRequiredFields] = useState('legalName,dateOfBirth,address');
  const [requiredDocuments, setRequiredDocuments] = useState('identity,address');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fail = useCallback((reasonValue: unknown) => {
    if (reasonValue instanceof ApiClientError && reasonValue.status === 401) {
      router.replace('/login');
      return;
    }
    if (
      reasonValue instanceof ApiClientError &&
      reasonValue.status === 403 &&
      /password/i.test(reasonValue.message)
    ) {
      router.replace('/change-password');
      return;
    }
    setError(
      reasonValue instanceof Error
        ? reasonValue.message
        : 'Unable to load KYC management',
    );
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [queue, policyRows] = await Promise.all([
        apiJson<SubmissionPage>('/api/backend/admin/kyc/submissions?page=1&limit=50'),
        apiJson<Policy[]>('/api/backend/admin/kyc/policies'),
      ]);
      setSubmissions(queue);
      setPolicies(policyRows);
      if (!selectedId && queue.items.length) setSelectedId(queue.items[0].id);
    } catch (reasonValue) {
      fail(reasonValue);
    } finally {
      setLoading(false);
    }
  }, [fail, selectedId]);

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
    setNotice('');
    try {
      await apiJson(`/api/backend${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setNotice('KYC configuration updated.');
      await load();
    } catch (reasonValue) {
      fail(reasonValue);
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!defaultPolicy) return;
    const fields = requiredFields.split(',').map((value) => value.trim()).filter(Boolean);
    const documents = requiredDocuments.split(',').map((value) => value.trim()).filter(Boolean);
    await action(`/admin/kyc/policies/${defaultPolicy.id}/versions`, 'POST', {
      effectiveFrom: effectiveFrom
        ? new Date(effectiveFrom).toISOString()
        : new Date().toISOString(),
      requirements: { fields, documents },
      reviewRules: { manualReviewRequired: true },
    });
  }

  return (
    <section id="kyc" className={extension.extension}>
      <div className={styles.card}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>✓</span>
            <div>
              <h2>Member KYC</h2>
              <small>Review and policy lifecycle stay inside Member Management</small>
            </div>
          </div>
          <button
            className={`${styles.button} ${styles.outline}`}
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'REFRESHING…' : 'REFRESH KYC'}
          </button>
        </div>
        {error ? <div className={`${styles.notice} ${styles.error}`}>{error}</div> : null}
        {notice ? <div className={`${styles.notice} ${styles.success}`}>{notice}</div> : null}

        <WorkspaceTabs
          ariaLabel="Member KYC sections"
          tabs={[
            { id: 'kyc-review', label: 'Review Queue', count: submissions?.total ?? 0 },
            { id: 'kyc-policy', label: 'KYC Policy', count: policies.length },
          ]}
        >
          {(activeTab) => <>
            {activeTab === 'kyc-review' ? (
              <div className={extension.split}>
                <div>
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionTitle}>
                      <span className={styles.sectionIcon}>●</span>
                      <h2>Review Queue</h2>
                    </div>
                    <span className={styles.tag}>{submissions?.total ?? 0} TOTAL</span>
                  </div>
                  {submissions?.items.length ? (
                    <div className={extension.list}>
                      {submissions.items.map((submission) => (
                        <button
                          key={submission.id}
                          type="button"
                          className={`${extension.listRow} ${selectedId === submission.id ? extension.selected : ''}`}
                          onClick={() => {
                            setSelectedId(submission.id);
                            setReason('');
                          }}
                        >
                          <span>
                            <b>{displayName(submission)}</b>
                            <small>{submission.user.username} • {new Date(submission.submittedAt).toLocaleString()}</small>
                          </span>
                          <span className={styles.tag}>{submission.status.replaceAll('_', ' ')}</span>
                        </button>
                      ))}
                    </div>
                  ) : <div className={styles.empty}>No KYC submissions.</div>}
                </div>

                <div>
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionTitle}>
                      <span className={styles.sectionIcon}>▣</span>
                      <h2>Selected Submission</h2>
                    </div>
                  </div>
                  {selected ? <>
                    <div className={styles.summary}>
                      <div><small>MEMBER</small><b>{displayName(selected)}</b></div>
                      <div><small>POLICY</small><b>{selected.policyVersion.policy.code} v{selected.policyVersion.version}</b></div>
                      <div><small>STATUS</small><b>{selected.status.replaceAll('_', ' ')}</b></div>
                      <div><small>EMAIL</small><b>{selected.user.email ?? '—'}</b></div>
                    </div>
                    <details className={extension.details}>
                      <summary>Submitted KYC data</summary>
                      <pre>{JSON.stringify(selected.data, null, 2)}</pre>
                    </details>
                    <details className={extension.details}>
                      <summary>Document references</summary>
                      <pre>{JSON.stringify(selected.documents, null, 2)}</pre>
                    </details>
                    {['SUBMITTED', 'UNDER_REVIEW'].includes(selected.status) ? <>
                      <div className={styles.field}>
                        <label>Review Reason / Notes</label>
                        <textarea className={styles.textarea} value={reason} onChange={(event) => setReason(event.target.value)} />
                      </div>
                      <div className={styles.buttonLine}>
                        {selected.status === 'SUBMITTED' ? (
                          <button className={`${styles.button} ${styles.outline}`} type="button" disabled={busy} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/start-review`, 'POST')}>START REVIEW</button>
                        ) : null}
                        <button className={styles.button} type="button" disabled={busy} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/review`, 'PATCH', { decision: 'APPROVED', reason: reason || undefined })}>APPROVE</button>
                        <button className={`${styles.button} ${styles.outline}`} type="button" disabled={busy || !reason.trim()} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/review`, 'PATCH', { decision: 'RESUBMISSION_REQUIRED', reason })}>REQUEST RESUBMISSION</button>
                        <button className={`${styles.button} ${styles.red}`} type="button" disabled={busy || !reason.trim()} onClick={() => void action(`/admin/kyc/submissions/${selected.id}/review`, 'PATCH', { decision: 'REJECTED', reason })}>REJECT</button>
                      </div>
                    </> : (
                      <div className={styles.notice}>Review finalized.{selected.reviewReason ? ` Reason: ${selected.reviewReason}` : ''}</div>
                    )}
                  </> : <div className={styles.empty}>Select a KYC submission from the queue.</div>}
                </div>
              </div>
            ) : null}

            {activeTab === 'kyc-policy' ? <>
              <div className={styles.sectionHead}>
                <div className={styles.sectionTitle}><span className={styles.sectionIcon}>⚙</span><h2>KYC Policy Lifecycle</h2></div>
                <span className={styles.tag}>{policies.length} POLICIES</span>
              </div>
              {policies.length ? (
                <div className={extension.list}>
                  {policies.map((policy) => (
                    <div className={extension.policyRow} key={policy.id}>
                      <div><b>{policy.name}</b><small>{policy.code}</small></div>
                      <div className={styles.buttonLine}>
                        {policy.isDefault ? <span className={styles.status}>DEFAULT</span> : (
                          <button className={`${styles.button} ${styles.outline}`} type="button" disabled={busy} onClick={() => void action(`/admin/kyc/policies/${policy.id}/default`, 'POST')}>SET DEFAULT</button>
                        )}
                        {policy.versions.map((version) =>
                          version.lifecycle === 'DRAFT' ? (
                            <button className={`${styles.button} ${styles.outline}`} type="button" key={version.id} disabled={busy} onClick={() => void action(`/admin/kyc/policy-versions/${version.id}/publish`, 'POST')}>PUBLISH v{version.version}</button>
                          ) : version.lifecycle === 'PUBLISHED' ? (
                            <button className={`${styles.button} ${styles.outline}`} type="button" key={version.id} disabled={busy} onClick={() => void action(`/admin/kyc/policy-versions/${version.id}/retire`, 'POST')}>RETIRE v{version.version}</button>
                          ) : null,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className={styles.empty}>No KYC policy configured.</div>}

              {defaultPolicy ? (
                <form className={extension.draftForm} method="post" onSubmit={createDraft}>
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionTitle}><span className={styles.sectionIcon}>+</span><h2>Create Next KYC Draft</h2></div>
                    <span className={styles.tag}>{defaultPolicy.code}</span>
                  </div>
                  <div className={styles.fields}>
                    <div className={styles.field}><label>Effective From</label><input className={styles.input} type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></div>
                    <div className={styles.field}><label>Required Fields (comma separated)</label><input className={styles.input} value={requiredFields} onChange={(event) => setRequiredFields(event.target.value)} required /></div>
                    <div className={styles.field}><label>Required Documents</label><input className={styles.input} value={requiredDocuments} onChange={(event) => setRequiredDocuments(event.target.value)} /></div>
                  </div>
                  <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>CREATE KYC DRAFT VERSION</button></div>
                </form>
              ) : null}
            </> : null}
          </>}
        </WorkspaceTabs>
      </div>
    </section>
  );
}
