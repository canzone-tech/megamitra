'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { WorkspaceTabs } from '@/components/workspace-tabs';
import { OwnerManagementShell } from './owner-management-shell';
import styles from './owner-portal.module.css';

export type OwnerControlSection = 'reports' | 'notifications' | 'support';
type Row = Record<string, unknown>;
type ReportPayload = { code: string; generatedAt: string; rowCount: number; rows: Row[] };

const API = '/api/backend/admin/owner-portal';
const TITLES: Record<OwnerControlSection, string> = {
  reports: 'Reports & Analytics',
  notifications: 'Notifications',
  support: 'Support & Help Centre',
};

function text(value: unknown, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}
function dateTime(value: unknown) {
  const raw = text(value, '');
  return raw ? raw.replace('T', ' ').slice(0, 19) : '—';
}
function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
function formString(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}
function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <div className={classNames(styles.field, full && styles.full)}><label>{label}</label>{children}</div>;
}
function Hero({ title, subtitle, pill }: { title: string; subtitle: string; pill?: string }) {
  return <div className={styles.hero}><h1>{title}</h1><p>{subtitle}</p>{pill ? <span className={styles.pill}>{pill}</span> : null}</div>;
}
function SectionHead({ icon, title, note }: { icon: string; title: string; note?: string }) {
  return <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>{icon}</span><h2>{title}</h2></div>{note ? <small>{note}</small> : null}</div>;
}
function Empty({ children = 'No records yet.' }: { children?: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
function reportKeys(rows: Row[]) {
  const keys = new Set<string>();
  rows.slice(0, 25).forEach((row) => {
    Object.entries(row).forEach(([key, value]) => {
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) keys.add(key);
    });
  });
  return [...keys];
}
function exportCsv(rows: Row[], filename: string) {
  if (!rows.length) return;
  const keys = reportKeys(rows);
  const escape = (value: unknown) => `"${text(value, '').replaceAll('"', '""')}"`;
  const csv = [
    keys.map(escape).join(','),
    ...rows.map((row) => keys.map((key) => escape(row[key])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OwnerControlPortal({ section }: { section: OwnerControlSection }) {
  const router = useRouter();
  const [data, setData] = useState<Row[]>([]);
  const [reportRows, setReportRows] = useState<Row[]>([]);
  const [reportName, setReportName] = useState('');
  const [reportCode, setReportCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleApiError = useCallback((err: unknown) => {
    if (err instanceof ApiClientError && err.status === 401) {
      router.push('/login');
      return;
    }
    if (err instanceof ApiClientError && err.status === 403 && /password/i.test(err.message)) {
      router.push('/change-password');
      return;
    }
    setError(err instanceof Error ? err.message : 'Request failed');
  }, [router]);

  const load = useCallback(async () => {
    try {
      if (section === 'reports') {
        setData(await apiJson<Row[]>(`${API}/reports`));
      } else if (section === 'notifications') {
        setData(await apiJson<Row[]>(`${API}/notifications`));
      } else {
        setData(await apiJson<Row[]>(`${API}/support`));
      }
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, section]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const columns = useMemo(() => reportKeys(reportRows), [reportRows]);

  function showTab(id: string) {
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  async function run<T>(work: () => Promise<T>, success: string, reload = true) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (reload) await load();
      setNotice(success);
      return result;
    } catch (err) {
      handleApiError(err);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function fetchReport(code: string, name: string) {
    const payload = await run(
      () => apiJson<ReportPayload>(`${API}/reports/${encodeURIComponent(code)}/data?limit=500`),
      `${name} report loaded`,
      false,
    );
    if (!payload) return null;
    setReportRows(payload.rows);
    setReportName(name);
    setReportCode(payload.code);
    return payload;
  }

  async function downloadReport(code: string, name: string) {
    const payload = await fetchReport(code, name);
    if (!payload) return;
    exportCsv(payload.rows, `${payload.code.toLowerCase()}-report.csv`);
    setNotice(`${name} CSV exported`);
  }

  async function printReport(code: string, name: string) {
    const payload = await fetchReport(code, name);
    if (!payload) return;
    showTab('report-preview');
    window.setTimeout(() => window.print(), 150);
  }

  async function createNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const native = event.nativeEvent as SubmitEvent;
    const action = (native.submitter as HTMLButtonElement | null)?.value ?? 'draft';
    const scheduledAt = formString(form, 'scheduledAt');
    const created = await run(
      () => apiJson<Row>(`${API}/notifications`, {
        method: 'POST',
        body: JSON.stringify({
          audience: formString(form, 'audience'),
          channel: formString(form, 'channel'),
          title: formString(form, 'title'),
          message: formString(form, 'message'),
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        }),
      }),
      'Notification draft saved',
      false,
    );
    if (!created) return;
    if (action === 'send') {
      await run(
        () => apiJson(`${API}/notifications/${encodeURIComponent(text(created.id))}/send`, {
          method: 'POST',
          body: JSON.stringify({
            scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          }),
        }),
        scheduledAt ? 'Notification scheduled' : 'Notification sent / queued',
      );
    } else {
      await load();
    }
    formElement.reset();
  }

  async function sendNotification(row: Row) {
    const scheduledAt = text(row.scheduledAt, '');
    await run(
      () => apiJson(`${API}/notifications/${encodeURIComponent(text(row.id))}/send`, {
        method: 'POST',
        body: JSON.stringify({ scheduledAt: scheduledAt || undefined }),
      }),
      scheduledAt ? 'Notification scheduled' : 'Notification sent / queued',
    );
  }

  async function createSupport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(
      () => apiJson(`${API}/support`, {
        method: 'POST',
        body: JSON.stringify({
          memberReference: formString(form, 'memberReference') || undefined,
          category: formString(form, 'category'),
          priority: formString(form, 'priority'),
          contact: formString(form, 'contact') || undefined,
          description: formString(form, 'description'),
        }),
      }),
      'Support ticket created',
    );
    formElement.reset();
    showTab('support-register');
  }

  async function updateSupport(id: string, status: string) {
    await run(
      () => apiJson(`${API}/support/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
      `Ticket moved to ${status.replaceAll('_', ' ').toLowerCase()}`,
    );
  }

  return (
    <OwnerManagementShell title={TITLES[section]} currentSection={section}>
      {error ? <div className={classNames(styles.notice, styles.error)}>{error}</div> : null}
      {notice ? <div className={classNames(styles.notice, styles.success)}>{notice}</div> : null}
      {section === 'reports' ? renderReports() : section === 'notifications' ? renderNotifications() : renderSupport()}
    </OwnerManagementShell>
  );

  function renderReports() {
    return <><Hero title="Reports & Analytics" subtitle="Operational, financial, season, draw, binary and member reports." pill="LIVE AUTHORITATIVE DATA" />
      <WorkspaceTabs ariaLabel="Reports workspace" tabs={[
        { id: 'report-catalogue', label: 'Report Catalogue', count: data.length },
        { id: 'report-preview', label: 'Preview', count: reportRows.length },
      ]}>
        {(activeTab) => <>
          {activeTab === 'report-catalogue' ? <div className={styles.card}><div className={styles.tableBox}><table className={styles.table}><thead><tr><th>REPORT</th><th>PERIOD</th><th>FORMAT</th><th>ACTION</th></tr></thead><tbody>{data.map((row) => <tr key={text(row.code)}><td><b>{text(row.name)}</b></td><td>{text(row.period)}</td><td>{Array.isArray(row.formats) ? row.formats.join(' / ') : text(row.formats)}</td><td><div className={styles.buttonLine}><button type="button" className={styles.button} disabled={busy} onClick={() => void downloadReport(text(row.code), text(row.name))}>EXPORT CSV</button><button type="button" className={classNames(styles.button, styles.outline)} disabled={busy} onClick={() => void printReport(text(row.code), text(row.name))}>PREVIEW / PDF</button></div></td></tr>)}</tbody></table></div></div> : null}
          {activeTab === 'report-preview' ? <div className={styles.card}><SectionHead icon="▥" title={reportName || 'Report Preview'} note={`${reportRows.length} row(s) loaded`} />{reportCode && reportRows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr>{columns.map((key) => <th key={key}>{key.replaceAll(/([A-Z])/g, ' $1').toUpperCase()}</th>)}</tr></thead><tbody>{reportRows.slice(0, 100).map((row, index) => <tr key={`${reportCode}-${index}`}>{columns.map((key) => <td key={key}>{key.toLowerCase().includes('at') ? dateTime(row[key]) : text(row[key])}</td>)}</tr>)}</tbody></table></div> : <Empty>Select PREVIEW / PDF from the Report Catalogue.</Empty>}</div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }

  function renderNotifications() {
    return <><Hero title="Notifications & Communications" subtitle="Manage SMS, email, push and in-portal announcements." />
      <WorkspaceTabs ariaLabel="Notifications workspace" tabs={[
        { id: 'notification-compose', label: 'Compose' },
        { id: 'notification-register', label: 'Communication Register', count: data.length },
      ]}>
        {(activeTab) => <>
          {activeTab === 'notification-compose' ? <div className={styles.card}><SectionHead icon="+" title="Create Notification" /><form method="post" onSubmit={createNotification}><div className={styles.fields}><Field label="Audience"><select name="audience" className={styles.select}><option value="ALL_ACTIVE_MEMBERS">All Active Members</option><option value="SEASON_MEMBERS">Season Members</option><option value="AGENTS">Agents</option><option value="ADMINS">Admins</option></select></Field><Field label="Channel"><select name="channel" className={styles.select}><option value="PORTAL">In-Portal</option><option value="SMS">SMS</option><option value="EMAIL">Email</option><option value="PUSH">Push</option></select></Field><Field label="Title" full><input name="title" className={styles.input} required placeholder="Notification title" /></Field><Field label="Message" full><textarea name="message" className={styles.textarea} required placeholder="Write notification message" /></Field><Field label="Schedule (optional)"><input name="scheduledAt" className={styles.input} type="datetime-local" /></Field></div><div className={styles.buttonLine}><button className={styles.button} name="action" value="draft" disabled={busy}>SAVE DRAFT</button><button className={classNames(styles.button, styles.dark)} name="action" value="send" disabled={busy}>SEND / SCHEDULE</button></div></form></div> : null}
          {activeTab === 'notification-register' ? <div className={styles.card}><SectionHead icon="◉" title="Communication Register" note="Portal messages publish immediately; external channels enter the provider queue." />{data.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>TITLE</th><th>AUDIENCE</th><th>CHANNEL</th><th>STATUS</th><th>SCHEDULE</th><th>SENT</th><th>ACTION</th></tr></thead><tbody>{data.map((row) => <tr key={text(row.id)}><td><b>{text(row.title)}</b></td><td>{text(row.audience)}</td><td>{text(row.channel)}</td><td className={text(row.status) === 'SENT' ? styles.status : ''}>{text(row.status)}</td><td>{dateTime(row.scheduledAt)}</td><td>{dateTime(row.sentAt)}</td><td>{text(row.status) === 'DRAFT' ? <button type="button" className={classNames(styles.button, styles.dark)} onClick={() => void sendNotification(row)} disabled={busy}>SEND / SCHEDULE</button> : '—'}</td></tr>)}</tbody></table></div> : <Empty />}</div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }

  function renderSupport() {
    return <><Hero title="Support & Help Centre" subtitle="Tickets, FAQs, escalation, complaint tracking and operational support." />
      <WorkspaceTabs ariaLabel="Support workspace" tabs={[
        { id: 'support-create', label: 'Create Ticket' },
        { id: 'support-register', label: 'Ticket Register', count: data.length },
        { id: 'support-help', label: 'Help Topics' },
      ]}>
        {(activeTab) => <>
          {activeTab === 'support-create' ? <div className={styles.card}><SectionHead icon="+" title="Create Support Ticket" /><form method="post" onSubmit={createSupport}><div className={styles.fields}><Field label="Member / User ID"><input name="memberReference" className={styles.input} placeholder="Optional existing member" /></Field><Field label="Category"><select name="category" className={styles.select}><option>Payment</option><option>E-PIN</option><option>Binary Placement</option><option>Lucky Draw</option><option>Account</option></select></Field><Field label="Priority"><select name="priority" className={styles.select}><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></Field><Field label="Contact"><input name="contact" className={styles.input} placeholder="Phone / email" /></Field><Field label="Issue Description" full><textarea name="description" className={styles.textarea} required placeholder="Describe the issue" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>CREATE SUPPORT TICKET</button></div></form></div> : null}
          {activeTab === 'support-register' ? <div className={styles.card}><SectionHead icon="≡" title="Ticket Register" />{data.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>TICKET</th><th>MEMBER</th><th>CATEGORY</th><th>PRIORITY</th><th>STATUS</th><th>CREATED</th><th>ACTION</th></tr></thead><tbody>{data.map((row) => { const status = text(row.status); return <tr key={text(row.id)}><td><b>{text(row.ticketNumber)}</b></td><td>{text(row.memberUsername, row.memberReference ? text(row.memberReference) : '—')}</td><td>{text(row.category)}</td><td>{text(row.priority)}</td><td className={status === 'RESOLVED' || status === 'CLOSED' ? styles.status : ''}>{status}</td><td>{dateTime(row.createdAt)}</td><td>{status === 'OPEN' ? <button type="button" className={styles.button} onClick={() => void updateSupport(text(row.id), 'IN_PROGRESS')} disabled={busy}>START</button> : status === 'IN_PROGRESS' ? <button type="button" className={classNames(styles.button, styles.green)} onClick={() => void updateSupport(text(row.id), 'RESOLVED')} disabled={busy}>RESOLVE</button> : status === 'RESOLVED' ? <button type="button" className={classNames(styles.button, styles.dark)} onClick={() => void updateSupport(text(row.id), 'CLOSED')} disabled={busy}>CLOSE</button> : '—'}</td></tr>; })}</tbody></table></div> : <Empty />}</div> : null}
          {activeTab === 'support-help' ? <div className={styles.card}><SectionHead icon="?" title="Common Help Topics" /><div className={styles.notice}>Account registration • E-PIN validation • A/B/C/D placement • A:C + B:D pair calculation • EMI receipts • Draw eligibility • Winner verification • Profile/security.</div></div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }
}
