'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { AdminEmailChangeForm } from '@/components/auth-account-forms';
import { AppearanceSettingsPanel } from '@/components/appearance-settings-panel';
import { OwnerManagementShell } from '@/components/owner-management-shell';
import { PlatformConfigAdmin } from '@/components/platform-config-admin';
import styles from './owner-portal.module.css';

type Row = Record<string, unknown>;
const API = '/api/backend/admin/owner-portal';

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
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(number(value));
  } catch {
    return `${code} ${number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}
function classNames(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(' '); }
function formString(form: FormData, name: string) { return String(form.get(name) ?? '').trim(); }

export function SettingsGovernancePortal() {
  const router = useRouter();
  const [settings, setSettings] = useState<Row>({});
  const [governance, setGovernance] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleError = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) { router.push('/login'); return; }
    if (reason instanceof ApiClientError && reason.status === 403 && /password/i.test(reason.message)) { router.push('/change-password'); return; }
    setError(reason instanceof Error ? reason.message : 'Unable to load settings');
  }, [router]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [nextSettings, nextGovernance] = await Promise.all([
        apiJson<Row>(`${API}/settings`),
        apiJson<Row>(`${API}/governance`),
      ]);
      setSettings(nextSettings);
      setGovernance(nextGovernance);
    } catch (reason) {
      handleError(reason);
    }
  }, [handleError]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      await apiJson(`${API}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          companyName: formString(form, 'companyName'),
          timezone: formString(form, 'timezone'),
          currencyCode: formString(form, 'currencyCode').toUpperCase(),
          defaultLanguage: formString(form, 'defaultLanguage'),
        }),
      });
      setNotice('Portal settings saved.');
      await load();
    } catch (reason) {
      handleError(reason);
    } finally {
      setBusy(false);
    }
  }

  const snapshot = governance ?? {};
  const active = snapshot.activeSeason && typeof snapshot.activeSeason === 'object' ? snapshot.activeSeason as Row : {};
  const controls = Array.isArray(snapshot.controls) ? snapshot.controls as Row[] : [];
  const currencyCode = text(settings.currencyCode, 'INR');

  return <OwnerManagementShell title="Settings & Governance" currentSection="settings" currentPath="/portal/settings">
    <section className={styles.hero}>
      <h1>Settings & Governance</h1>
      <p>Portal configuration, roles, security, privacy, audit and system preferences from one authoritative screen.</p>
      <span className={styles.pill}>CENTRAL CONFIGURATION • DB BACKED • AUDITED</span>
    </section>

    {error ? <div className={classNames(styles.notice, styles.error)} role="alert">{error}</div> : null}
    {notice ? <div className={classNames(styles.notice, styles.success)} role="status">{notice}</div> : null}

    <div className="mm-tabs" aria-label="Settings sections">
      <a className="mm-tab active" href="#general">General</a>
      <a className="mm-tab" href="#security">Security & registration</a>
      <a className="mm-tab" href="#appearance">Appearance</a>
      <a className="mm-tab" href="#governance">Governance</a>
    </div>

    <section id="general" className={styles.card} style={{ scrollMarginTop: 90 }}>
      <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>⚙</span><h2>Portal Configuration</h2></div><small>Single source for global portal preferences</small></div>
      <form key={text(settings.updatedAt, 'settings')} method="post" onSubmit={saveSettings}>
        <div className={styles.fields}>
          <div className={styles.field}><label>Company Name</label><input name="companyName" className={styles.input} required defaultValue={text(settings.companyName, 'MegaGoldenClub')} /></div>
          <div className={styles.field}><label>Portal Time Zone</label><input name="timezone" className={styles.input} required defaultValue={text(settings.timezone, 'Asia/Kolkata')} placeholder="Asia/Kolkata" /></div>
          <div className={styles.field}><label>Currency</label><input name="currencyCode" className={styles.input} required maxLength={3} pattern="[A-Za-z]{3}" defaultValue={currencyCode} placeholder="INR" /></div>
          <div className={styles.field}><label>Default Language</label><input name="defaultLanguage" className={styles.input} required defaultValue={text(settings.defaultLanguage, 'English')} /></div>
          <div className={styles.field}><label>Daily Cap</label><input className={styles.input} readOnly value={money(snapshot.dailyCap, currencyCode)} /></div>
          <div className={styles.field}><label>Pair Value</label><input className={styles.input} readOnly value={money(active.pairPayoutAmount, currencyCode)} /></div>
        </div>
        <div className={styles.notice}>Daily Cap and Pair Value are authoritative Season policy values. Change them only in Season Management so financial configuration is never duplicated.</div>
        <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE SETTINGS</button><a className={classNames(styles.button, styles.outline, styles.linkButton)} href="/portal/seasons">SEASON MANAGEMENT</a></div>
      </form>
    </section>

    <div className={styles.kpis}>
      <div className={styles.kpi}><small>Active Season</small><strong>{text(active.name, 'No active season')}</strong><span>{text(active.status, 'Not published')}</span></div>
      <div className={styles.kpi}><small>Open Support</small><strong>{number(snapshot.openSupportTickets)}</strong><span>Tickets requiring attention</span></div>
      <div className={styles.kpi}><small>Pending Notices</small><strong>{number(snapshot.pendingNotifications)}</strong><span>Draft / scheduled / queued</span></div>
      <div className={styles.kpi}><small>Currency</small><strong>{currencyCode}</strong><span>{text(settings.timezone, 'Portal timezone')}</span></div>
    </div>

    <section id="security" style={{ scrollMarginTop: 90, display: 'grid', gap: 18 }}>
      <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>◇</span><h2>Authentication, Security & Registration</h2></div><small>Platform-wide SuperAdmin configuration</small></div>
      <PlatformConfigAdmin />
      <section className="mm-card">
        <div className="mm-card-head"><div><h2>SuperAdmin account email</h2><p className="mm-note">Account-specific action; platform-wide email policy is configured above.</p></div><span className="mm-chip warning">ACCOUNT ACTION</span></div>
        <div className="mm-card-body"><AdminEmailChangeForm /></div>
      </section>
    </section>

    <section id="appearance" style={{ scrollMarginTop: 90, display: 'grid', gap: 18 }}>
      <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>◐</span><h2>Portal Appearance</h2></div><small>Versioned member portal theme, layout and copy</small></div>
      <AppearanceSettingsPanel />
    </section>

    <section id="governance" className={styles.card} style={{ scrollMarginTop: 90 }}>
      <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>✓</span><h2>Governance Checklist</h2></div><small>Runtime capability status — unsupported controls are not marked complete.</small></div>
      {controls.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>CONTROL</th><th>STATUS</th><th>DETAIL</th></tr></thead><tbody>{controls.map((row) => {
        const status = text(row.status);
        const activeStatus = ['ACTIVE', 'ENFORCED', 'RUNBOOK'].includes(status);
        return <tr key={text(row.code)}><td><b>{text(row.label)}</b></td><td className={activeStatus ? styles.status : styles.statusOff}>{status.replaceAll('_', ' ')}</td><td>{text(row.detail)}</td></tr>;
      })}</tbody></table></div> : <div className={styles.empty}>Governance status unavailable.</div>}
    </section>
  </OwnerManagementShell>;
}
