'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { OwnerManagementShell } from './owner-management-shell';
import styles from './owner-portal.module.css';

type Submission = {
  id: string;
  receiptNumber: string;
  publicToken: string;
  purpose: 'INSTALLMENT' | 'EPIN_PURCHASE';
  amount: string;
  currencyCode: string;
  providerReference: string;
  paymentProofDataUrl: string;
  status: string;
  details: Record<string, unknown> | string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  epinQuantity: number | null;
  username: string;
  firstName: string | null;
  lastName: string | null;
  seasonCode: string;
  seasonName: string;
  reviewedByUsername: string | null;
};
type PaymentSettings = {
  upiId: string | null;
  payeeName: string | null;
  qrImageDataUrl: string | null;
  instructions: string | null;
  enabled: boolean | number;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
function money(value: string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currencyCode} ${Number.isFinite(amount) ? amount.toFixed(2) : value}`;
  }
}
function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
function statusLabel(status: string) {
  if (status === 'PENDING_VERIFICATION' || status === 'PROCESSING') return 'PENDING VERIFICATION';
  if (status === 'CONFIRMED') return 'CONFIRMED / PAID';
  return status;
}
function detailsObject(value: Submission['details']): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
async function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('QR image must be an image');
  const result = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Unable to read QR image'));
    reader.readAsDataURL(file);
  });
  if (result.length > 120_000) throw new Error('QR image is too large. Please use a smaller image.');
  return result;
}

export function MemberPaymentVerificationPortal() {
  const router = useRouter();
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [rows, setRows] = useState<Submission[]>([]);
  const [status, setStatus] = useState('PENDING_VERIFICATION');
  const [purpose, setPurpose] = useState('');
  const [qrImageDataUrl, setQrImageDataUrl] = useState('');
  const [busyId, setBusyId] = useState('');
  const [busySettings, setBusySettings] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleError = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      router.push('/login');
      return;
    }
    if (reason instanceof ApiClientError && reason.status === 403 && /password/i.test(reason.message)) {
      router.push('/change-password');
      return;
    }
    setError(reason instanceof Error ? reason.message : 'Request failed');
  }, [router]);

  const load = useCallback(async () => {
    setError('');
    try {
      const query = new URLSearchParams();
      if (status) query.set('status', status);
      if (purpose) query.set('purpose', purpose);
      const [nextSettings, nextRows] = await Promise.all([
        apiJson<PaymentSettings>('/api/backend/admin/member-payments/settings'),
        apiJson<Submission[]>(`/api/backend/admin/member-payments/submissions?${query.toString()}`),
      ]);
      setSettings(nextSettings);
      setQrImageDataUrl(nextSettings.qrImageDataUrl ?? '');
      setRows(nextRows);
    } catch (reason) {
      handleError(reason);
    }
  }, [handleError, purpose, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function review(row: Submission, decision: 'APPROVE' | 'REJECT') {
    const note = window.prompt(decision === 'REJECT' ? 'Rejection note (required)' : 'Verification note (optional)', '');
    if (note === null) return;
    if (decision === 'REJECT' && !note.trim()) return setError('Add a rejection note before rejecting the payment.');
    setBusyId(row.id); setError(''); setNotice('');
    try {
      await apiJson(`/api/backend/admin/member-payments/submissions/${encodeURIComponent(row.id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      });
      setNotice(decision === 'APPROVE'
        ? `${row.receiptNumber} confirmed. The same public receipt now shows CONFIRMED / PAID.`
        : `${row.receiptNumber} rejected. The same public receipt now shows REJECTED.`);
      await load();
    } catch (reason) { handleError(reason); } finally { setBusyId(''); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusySettings(true); setError(''); setNotice('');
    try {
      await apiJson('/api/backend/admin/member-payments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          upiId: String(form.get('upiId') ?? '').trim() || undefined,
          payeeName: String(form.get('payeeName') ?? '').trim() || undefined,
          qrImageDataUrl: qrImageDataUrl || undefined,
          instructions: String(form.get('instructions') ?? '').trim() || undefined,
          enabled: form.get('enabled') === 'on',
        }),
      });
      setNotice('Member QR / UPI payment settings updated.');
      await load();
    } catch (reason) { handleError(reason); } finally { setBusySettings(false); }
  }

  return (
    <OwnerManagementShell title="Member Payment Verification" currentSection="member-payments">
      <div className={styles.hero}><h1>Member Payment Verification</h1><p>Review QR / UPI installment and E-PIN purchase submissions. Approval and rejection are restricted to Super Admin.</p><span className={styles.pill}>UTR + SCREENSHOT • AUDITED REVIEW</span></div>
      {error ? <div className={classNames(styles.notice, styles.error)} role="alert">{error}</div> : null}
      {notice ? <div className={classNames(styles.notice, styles.success)} role="status">{notice}</div> : null}

      <div className={styles.card}>
        <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>₹</span><h2>QR / UPI Settings</h2></div><small>Super Admin only</small></div>
        {settings ? <form method="post" onSubmit={saveSettings}>
          <div className={styles.fields}>
            <div className={styles.field}><label>UPI ID</label><input className={styles.input} name="upiId" defaultValue={settings.upiId ?? ''} /></div>
            <div className={styles.field}><label>Payee name</label><input className={styles.input} name="payeeName" defaultValue={settings.payeeName ?? ''} /></div>
            <div className={styles.field}><label>QR image</label><input className={styles.input} type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(setQrImageDataUrl).catch(handleError); }} /></div>
            <div className={styles.field}><label>Enabled</label><input name="enabled" type="checkbox" defaultChecked={Boolean(settings.enabled)} /></div>
            <div className={classNames(styles.field, styles.full)}><label>Member instructions</label><textarea className={styles.input} name="instructions" defaultValue={settings.instructions ?? ''} rows={3} /></div>
          </div>
          {qrImageDataUrl ? <div className={styles.notice}><img src={qrImageDataUrl} alt="Configured payment QR" style={{ width: 180, maxWidth: '100%', height: 'auto' }} /></div> : null}
          <div className={styles.buttonLine}><button className={styles.button} disabled={busySettings}>{busySettings ? 'SAVING…' : 'SAVE PAYMENT SETTINGS'}</button></div>
        </form> : <div className={styles.empty}>Loading payment settings…</div>}
      </div>

      <div className={styles.card}>
        <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>✅</span><h2>Verification Queue</h2></div><small>{rows.length} submission(s)</small></div>
        <div className={styles.fields}>
          <div className={styles.field}><label>Status</label><select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value)}><option value="PENDING_VERIFICATION">Pending verification</option><option value="CONFIRMED">Confirmed / paid</option><option value="REJECTED">Rejected</option><option value="">All</option></select></div>
          <div className={styles.field}><label>Purpose</label><select className={styles.select} value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="">All purposes</option><option value="INSTALLMENT">Installment</option><option value="EPIN_PURCHASE">E-PIN purchase</option></select></div>
        </div>
        {rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>RECEIPT / MEMBER</th><th>PURPOSE / SESSION</th><th>AMOUNT / UTR</th><th>PROOF</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row) => {
          const details = detailsObject(row.details);
          const memberName = [row.firstName, row.lastName].filter(Boolean).join(' ') || row.username;
          return <tr key={row.id}>
            <td><b>{row.receiptNumber}</b><br />{memberName}<br /><small>{row.username}</small></td>
            <td>{row.purpose.replace('_', ' ')}<br />{row.seasonName} ({row.seasonCode})<br /><small>{row.purpose === 'INSTALLMENT' ? `${String(details.installmentCount ?? '—')} installment(s)` : `${String(details.quantity ?? row.epinQuantity ?? '—')} E-PIN(s)`}</small></td>
            <td><b>{money(row.amount, row.currencyCode)}</b><br />UTR {row.providerReference}<br /><small>{dateTime(row.submittedAt)}</small></td>
            <td>{row.paymentProofDataUrl ? <a href={row.paymentProofDataUrl} target="_blank" rel="noreferrer"><img src={row.paymentProofDataUrl} alt={`Payment proof ${row.receiptNumber}`} style={{ width: 96, maxHeight: 96, objectFit: 'contain' }} /></a> : '—'}</td>
            <td className={row.status === 'CONFIRMED' ? styles.status : row.status === 'REJECTED' ? styles.statusOff : ''}>{statusLabel(row.status)}{row.reviewedByUsername ? <><br /><small>by {row.reviewedByUsername}</small></> : null}</td>
            <td>{row.status === 'PENDING_VERIFICATION' ? <div className={styles.buttonLine}><button className={styles.button} type="button" disabled={busyId === row.id} onClick={() => void review(row, 'APPROVE')}>APPROVE</button><button className={classNames(styles.button, styles.red)} type="button" disabled={busyId === row.id} onClick={() => void review(row, 'REJECT')}>REJECT</button></div> : <small>{row.reviewNote || dateTime(row.reviewedAt)}</small>}</td>
          </tr>;
        })}</tbody></table></div> : <div className={styles.empty}>No matching member payment submissions.</div>}
      </div>
    </OwnerManagementShell>
  );
}
