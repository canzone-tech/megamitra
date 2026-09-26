'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import styles from './owner-portal.module.css';

export type OwnerControlSection = 'reports' | 'notifications' | 'support' | 'settings';
type Section =
  | 'dashboard'
  | 'income'
  | 'members'
  | 'binary'
  | 'placement'
  | 'seasons'
  | 'draw'
  | 'winners'
  | 'prizes'
  | 'payments'
  | 'wallet'
  | 'epins'
  | 'auth-codes'
  | OwnerControlSection;
type Row = Record<string, unknown>;
type NavItem = { section: Section; label: string; symbol: string; group: string };
type ReportPayload = { code: string; generatedAt: string; rowCount: number; rows: Row[] };

const API = '/api/backend/admin/owner-portal';
const NAV: NavItem[] = [
  { section: 'dashboard', label: 'Dashboard', symbol: '▦', group: 'Main' },
  { section: 'income', label: '9 Income Types', symbol: '↗', group: 'Main' },
  { section: 'members', label: 'Members', symbol: '●', group: 'Main' },
  { section: 'binary', label: 'Binary 2:2 • AB : CD', symbol: '◇', group: 'Main' },
  { section: 'placement', label: 'Placement / Pairing', symbol: '⌁', group: 'Main' },
  { section: 'seasons', label: 'Season Management', symbol: '□', group: 'Season & Draw' },
  { section: 'draw', label: 'Monthly Draw', symbol: '◆', group: 'Season & Draw' },
  { section: 'winners', label: 'Winners', symbol: '★', group: 'Season & Draw' },
  { section: 'prizes', label: 'Prize Catalogue', symbol: '▣', group: 'Season & Draw' },
  { section: 'payments', label: 'Payments / Bills', symbol: '¤', group: 'Finance & Security' },
  { section: 'wallet', label: 'Wallet / Ledger', symbol: '▤', group: 'Finance & Security' },
  { section: 'epins', label: 'E-PIN Management', symbol: '⌘', group: 'Finance & Security' },
  { section: 'auth-codes', label: 'Auth Codes', symbol: '◈', group: 'Finance & Security' },
  { section: 'reports', label: 'Reports', symbol: '▥', group: 'Control' },
  { section: 'notifications', label: 'Notifications', symbol: '◉', group: 'Control' },
  { section: 'support', label: 'Support', symbol: '?', group: 'Control' },
  { section: 'settings', label: 'Settings', symbol: '⚙', group: 'Control' },
];
const TITLES: Record<OwnerControlSection, string> = {
  reports: 'Reports & Analytics',
  notifications: 'Notifications',
  support: 'Support & Help Centre',
  settings: 'Settings & Governance',
};

function href(section: Section) {
  return section === 'dashboard' ? '/operations' : `/portal/${section}`;
}
function text(value: unknown, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}
function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function money(value: unknown, currencyCode = 'INR') {
  const code = currencyCode.trim().toUpperCase() || 'INR';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(number(value));
  } catch {
    return `${code} ${number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
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
function Kpi({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return <div className={styles.kpi}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>;
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
  const [settings, setSettings] = useState<Row>({});
  const [data, setData] = useState<Row[]>([]);
  const [governance, setGovernance] = useState<Row | null>(null);
  const [reportRows, setReportRows] = useState<Row[]>([]);
  const [reportName, setReportName] = useState('');
  const [reportCode, setReportCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileMore, setMobileMore] = useState(false);

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
      const portalSettings = await apiJson<Row>(`${API}/settings`);
      if (section === 'reports') {
        setData(await apiJson<Row[]>(`${API}/reports`));
        setGovernance(null);
      } else if (section === 'notifications') {
        setData(await apiJson<Row[]>(`${API}/notifications`));
        setGovernance(null);
      } else if (section === 'support') {
        setData(await apiJson<Row[]>(`${API}/support`));
        setGovernance(null);
      } else {
        setData([]);
        setGovernance(await apiJson<Row>(`${API}/governance`));
      }
      setSettings(portalSettings);
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, section]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const grouped = useMemo(() => {
    const groups = new Map<string, NavItem[]>();
    NAV.forEach((item) => groups.set(item.group, [...(groups.get(item.group) ?? []), item]));
    return [...groups.entries()];
  }, []);
  const columns = useMemo(() => reportKeys(reportRows), [reportRows]);
  const currencyCode = text(settings.currencyCode, 'INR');

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

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/session/logout', { method: 'POST' });
    } finally {
      router.push('/login');
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
    window.setTimeout(() => window.print(), 50);
  }

  async function createNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
    event.currentTarget.reset();
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
    const form = new FormData(event.currentTarget);
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
    event.currentTarget.reset();
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

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(
      () => apiJson(`${API}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          companyName: formString(form, 'companyName'),
          timezone: formString(form, 'timezone'),
          currencyCode: formString(form, 'currencyCode').toUpperCase(),
          defaultLanguage: formString(form, 'defaultLanguage'),
        }),
      }),
      'Portal settings saved',
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/operations"><span className={styles.logo}>MG</span><span><span className={styles.brandName}>MEGA<em>GOLDEN</em>CLUB</span><span className={styles.brandSub}>Professional Management Portal</span></span></Link>
        <nav className={styles.menu}>{grouped.map(([group, items]) => <div key={group}><div className={styles.menuTitle}>{group}</div>{items.map((item) => <Link key={item.section} className={classNames(styles.navItem, section === item.section && styles.activeNav)} href={href(item.section)}><span>{item.symbol}</span><span>{item.label}</span></Link>)}</div>)}</nav>
        <div className={styles.profile}><span className={styles.avatar}>A</span><div><b>Administrator</b><span>Owner management access</span></div></div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}><div className={styles.crumb}><b>{TITLES[section]}</b><span>{text(settings.companyName, 'MegaGoldenClub')} • Professional management portal</span></div><div className={styles.actions}><Link className={classNames(styles.iconButton, styles.linkButton)} href="/presentation" aria-label="Appearance">◐</Link><Link className={classNames(styles.iconButton, styles.linkButton)} href="/security" aria-label="Security">◇</Link><button className={styles.logout} type="button" onClick={logout} disabled={busy}>LOG OUT</button></div></header>
        <div className={styles.content}>
          {error ? <div className={classNames(styles.notice, styles.error)}>{error}</div> : null}
          {notice ? <div className={classNames(styles.notice, styles.success)}>{notice}</div> : null}
          {section === 'reports' ? renderReports() : section === 'notifications' ? renderNotifications() : section === 'support' ? renderSupport() : renderSettings()}
        </div>
      </main>

      <nav className={styles.bottom}>
        {(['dashboard', 'reports', 'notifications', 'support', 'settings'] as Section[]).map((key) => {
          const item = NAV.find((entry) => entry.section === key)!;
          return <Link key={key} className={section === key ? styles.activeBottom : ''} href={href(key)}><strong>{item.symbol}</strong>{key === 'dashboard' ? 'Home' : item.label.split(' ')[0]}</Link>;
        })}
        <button type="button" onClick={() => setMobileMore(true)} className={mobileMore ? styles.activeBottom : ''}><strong>☰</strong>More</button>
      </nav>
      {mobileMore ? <><div className={styles.drawerBackdrop} onClick={() => setMobileMore(false)} /><div className={styles.mobileMore}><div className={styles.drawerHead}><b>All management tools</b><button type="button" onClick={() => setMobileMore(false)}>×</button></div>{NAV.map((item) => <Link key={item.section} className={classNames(styles.navItem, section === item.section && styles.activeNav)} href={href(item.section)} onClick={() => setMobileMore(false)}><span>{item.symbol}</span><span>{item.label}</span></Link>)}<button className={classNames(styles.button, styles.dark)} type="button" onClick={logout}>LOG OUT</button></div></> : null}
    </div>
  );

  function renderReports() {
    return <><Hero title="Reports & Analytics" subtitle="Operational, financial, season, draw, binary and member reports." pill="LIVE AUTHORITATIVE DATA" />
      <div className={styles.card}><div className={styles.tableBox}><table className={styles.table}><thead><tr><th>REPORT</th><th>PERIOD</th><th>FORMAT</th><th>ACTION</th></tr></thead><tbody>{data.map((row) => <tr key={text(row.code)}><td><b>{text(row.name)}</b></td><td>{text(row.period)}</td><td>{Array.isArray(row.formats) ? row.formats.join(' / ') : text(row.formats)}</td><td><div className={styles.buttonLine}><button type="button" className={styles.button} disabled={busy} onClick={() => void downloadReport(text(row.code), text(row.name))}>EXPORT CSV</button><button type="button" className={classNames(styles.button, styles.outline)} disabled={busy} onClick={() => void printReport(text(row.code), text(row.name))}>PREVIEW / PDF</button></div></td></tr>)}</tbody></table></div></div>
      {reportCode ? <div className={styles.card}><SectionHead icon="▥" title={reportName} note={`${reportRows.length} row(s) loaded`} />{reportRows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr>{columns.map((key) => <th key={key}>{key.replaceAll(/([A-Z])/g, ' $1').toUpperCase()}</th>)}</tr></thead><tbody>{reportRows.slice(0, 100).map((row, index) => <tr key={`${reportCode}-${index}`}>{columns.map((key) => <td key={key}>{key.toLowerCase().includes('at') ? dateTime(row[key]) : text(row[key])}</td>)}</tr>)}</tbody></table></div> : <Empty>No records for the selected report period.</Empty>}</div> : null}</>;
  }

  function renderNotifications() {
    return <><Hero title="Notifications & Communications" subtitle="Manage SMS, email, push and in-portal announcements." />
      <div className={styles.card}><form method="post" onSubmit={createNotification}><div className={styles.fields}><Field label="Audience"><select name="audience" className={styles.select}><option value="ALL_ACTIVE_MEMBERS">All Active Members</option><option value="SEASON_MEMBERS">Season Members</option><option value="AGENTS">Agents</option><option value="ADMINS">Admins</option></select></Field><Field label="Channel"><select name="channel" className={styles.select}><option value="PORTAL">In-Portal</option><option value="SMS">SMS</option><option value="EMAIL">Email</option><option value="PUSH">Push</option></select></Field><Field label="Title" full><input name="title" className={styles.input} required placeholder="Notification title" /></Field><Field label="Message" full><textarea name="message" className={styles.textarea} required placeholder="Write notification message" /></Field><Field label="Schedule (optional)"><input name="scheduledAt" className={styles.input} type="datetime-local" /></Field></div><div className={styles.buttonLine}><button className={styles.button} name="action" value="draft" disabled={busy}>SAVE DRAFT</button><button className={classNames(styles.button, styles.dark)} name="action" value="send" disabled={busy}>SEND / SCHEDULE</button></div></form></div>
      <div className={styles.card}><SectionHead icon="◉" title="Communication Register" note="Portal messages publish immediately; external channels enter the provider queue." />{data.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>TITLE</th><th>AUDIENCE</th><th>CHANNEL</th><th>STATUS</th><th>SCHEDULE</th><th>SENT</th><th>ACTION</th></tr></thead><tbody>{data.map((row) => <tr key={text(row.id)}><td><b>{text(row.title)}</b></td><td>{text(row.audience)}</td><td>{text(row.channel)}</td><td className={text(row.status) === 'SENT' ? styles.status : ''}>{text(row.status)}</td><td>{dateTime(row.scheduledAt)}</td><td>{dateTime(row.sentAt)}</td><td>{text(row.status) === 'DRAFT' ? <button type="button" className={classNames(styles.button, styles.dark)} onClick={() => void sendNotification(row)} disabled={busy}>SEND / SCHEDULE</button> : '—'}</td></tr>)}</tbody></table></div> : <Empty />}</div></>;
  }

  function renderSupport() {
    return <><Hero title="Support & Help Centre" subtitle="Tickets, FAQs, escalation, complaint tracking and operational support." />
      <div className={styles.card}><form method="post" onSubmit={createSupport}><div className={styles.fields}><Field label="Member / User ID"><input name="memberReference" className={styles.input} placeholder="Optional existing member" /></Field><Field label="Category"><select name="category" className={styles.select}><option>Payment</option><option>E-PIN</option><option>Binary Placement</option><option>Lucky Draw</option><option>Account</option></select></Field><Field label="Priority"><select name="priority" className={styles.select}><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></Field><Field label="Contact"><input name="contact" className={styles.input} placeholder="Phone / email" /></Field><Field label="Issue Description" full><textarea name="description" className={styles.textarea} required placeholder="Describe the issue" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>CREATE SUPPORT TICKET</button></div></form></div>
      <div className={styles.card}><SectionHead icon="?" title="Common Help Topics" /><div className={styles.notice}>Account registration • E-PIN validation • AB/CD placement • AC + BD pair calculation • EMI receipts • Draw eligibility • Winner verification • Profile/security.</div></div>
      <div className={styles.card}><SectionHead icon="≡" title="Ticket Register" />{data.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>TICKET</th><th>MEMBER</th><th>CATEGORY</th><th>PRIORITY</th><th>STATUS</th><th>CREATED</th><th>ACTION</th></tr></thead><tbody>{data.map((row) => { const status = text(row.status); return <tr key={text(row.id)}><td><b>{text(row.ticketNumber)}</b></td><td>{text(row.memberUsername, row.memberReference ? text(row.memberReference) : '—')}</td><td>{text(row.category)}</td><td>{text(row.priority)}</td><td className={status === 'RESOLVED' || status === 'CLOSED' ? styles.status : ''}>{status}</td><td>{dateTime(row.createdAt)}</td><td>{status === 'OPEN' ? <button type="button" className={styles.button} onClick={() => void updateSupport(text(row.id), 'IN_PROGRESS')} disabled={busy}>START</button> : status === 'IN_PROGRESS' ? <button type="button" className={classNames(styles.button, styles.green)} onClick={() => void updateSupport(text(row.id), 'RESOLVED')} disabled={busy}>RESOLVE</button> : status === 'RESOLVED' ? <button type="button" className={classNames(styles.button, styles.dark)} onClick={() => void updateSupport(text(row.id), 'CLOSED')} disabled={busy}>CLOSE</button> : '—'}</td></tr>; })}</tbody></table></div> : <Empty />}</div></>;
  }

  function renderSettings() {
    const snapshot = governance ?? {};
    const active = snapshot.activeSeason && typeof snapshot.activeSeason === 'object' ? snapshot.activeSeason as Row : {};
    const controls = Array.isArray(snapshot.controls) ? snapshot.controls as Row[] : [];
    return <><Hero title="Settings & Governance" subtitle="Portal configuration, roles, security, privacy, audit and system preferences." pill="CENTRAL CONFIGURATION" />
      <div className={styles.card}><SectionHead icon="⚙" title="Portal Configuration" /><form key={text(settings.updatedAt, 'settings')} method="post" onSubmit={saveSettings}><div className={styles.fields}><Field label="Company Name"><input name="companyName" className={styles.input} required defaultValue={text(settings.companyName, 'MegaGoldenClub')} /></Field><Field label="Portal Time Zone"><input name="timezone" className={styles.input} required defaultValue={text(settings.timezone, 'Asia/Kolkata')} placeholder="Asia/Kolkata" /></Field><Field label="Currency"><input name="currencyCode" className={styles.input} required maxLength={3} pattern="[A-Za-z]{3}" defaultValue={currencyCode} placeholder="INR" /></Field><Field label="Default Language"><input name="defaultLanguage" className={styles.input} required defaultValue={text(settings.defaultLanguage, 'English')} /></Field><Field label="Daily Cap"><input className={styles.input} readOnly value={money(snapshot.dailyCap, currencyCode)} /></Field><Field label="Pair Value"><input className={styles.input} readOnly value={money(active.pairPayoutAmount, currencyCode)} /></Field></div><div className={styles.notice}>Daily Cap and Pair Value are read from the active Season policy. Edit them under Season Management so financial truth is not duplicated in global settings.</div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE SETTINGS</button><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/portal/seasons">SEASON POLICIES</Link><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/security">SECURITY</Link><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/presentation">APPEARANCE</Link></div></form></div>
      <div className={styles.kpis}><Kpi label="Active Season" value={text(active.name, 'No active season')} note={text(active.status, 'Not published')} /><Kpi label="Open Support" value={number(snapshot.openSupportTickets)} note="Tickets requiring attention" /><Kpi label="Pending Notices" value={number(snapshot.pendingNotifications)} note="Draft / scheduled / queued" /><Kpi label="Currency" value={currencyCode} note={text(settings.timezone, 'Portal timezone')} /></div>
      <div className={styles.card}><SectionHead icon="✓" title="Governance Checklist" note="Runtime capability status — unsupported controls are not marked complete." />{controls.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>CONTROL</th><th>STATUS</th><th>DETAIL</th></tr></thead><tbody>{controls.map((row) => { const status = text(row.status); const activeStatus = ['ACTIVE', 'ENFORCED', 'RUNBOOK'].includes(status); return <tr key={text(row.code)}><td><b>{text(row.label)}</b></td><td className={activeStatus ? styles.status : styles.statusOff}>{status.replaceAll('_', ' ')}</td><td>{text(row.detail)}</td></tr>; })}</tbody></table></div> : <Empty>Governance status unavailable.</Empty>}</div></>;
  }
}
