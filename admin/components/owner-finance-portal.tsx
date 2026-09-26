'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import styles from './owner-portal.module.css';

export type OwnerFinanceSection = 'payments' | 'wallet' | 'epins' | 'auth-codes';
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
  | OwnerFinanceSection
  | 'reports'
  | 'notifications'
  | 'support'
  | 'settings';
type Row = Record<string, unknown>;
type Settings = { companyName?: string; currencyCode?: string; timezone?: string };
type NavItem = { section: Section; label: string; symbol: string; group: string };

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
const TITLES: Record<OwnerFinanceSection, string> = {
  payments: 'Payments / Bills',
  wallet: 'Wallet / Ledger',
  epins: 'E-PIN Management',
  'auth-codes': 'Auth Codes',
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
function formNumber(form: FormData, name: string, fallback = 0) {
  const parsed = Number(form.get(name));
  return Number.isFinite(parsed) ? parsed : fallback;
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

export function OwnerFinancePortal({ section }: { section: OwnerFinanceSection }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({});
  const [data, setData] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<Row[]>([]);
  const [wallet, setWallet] = useState<Row | null>(null);
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [generatedEpins, setGeneratedEpins] = useState<string[]>([]);
  const [generatedAuthCode, setGeneratedAuthCode] = useState('');
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
      const portalSettings = await apiJson<Settings>(`${API}/settings`);
      if (section === 'payments') {
        const rows = await apiJson<Row[]>(`${API}/payments`);
        setData(rows);
        setSeasons([]);
      } else if (section === 'epins') {
        const [rows, seasonRows] = await Promise.all([
          apiJson<Row[]>(`${API}/epins`),
          apiJson<Row[]>(`${API}/seasons`),
        ]);
        setData(rows);
        setSeasons(seasonRows);
      } else if (section === 'auth-codes') {
        setData(await apiJson<Row[]>(`${API}/auth-codes`));
        setSeasons([]);
      } else {
        setData([]);
        setSeasons([]);
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

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run(
      () => apiJson<Row>(`${API}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          memberReference: formString(form, 'memberReference'),
          amount: formString(form, 'amount'),
          paymentType: formString(form, 'paymentType'),
          paymentMode: formString(form, 'paymentMode'),
          transactionReference: formString(form, 'transactionReference') || undefined,
          authorizationCode: formString(form, 'authorizationCode'),
        }),
      }),
      'Payment recorded and receipt generated',
    );
    const nextReceipt = result?.receipt;
    if (nextReceipt && typeof nextReceipt === 'object') setReceipt(nextReceipt as Row);
  }

  async function openReceipt(id: string) {
    const row = await run(
      () => apiJson<Row>(`${API}/payments/${encodeURIComponent(id)}`),
      'Receipt loaded',
      false,
    );
    if (row) setReceipt(row);
  }

  async function lookupWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const member = formString(form, 'member');
    const currency = formString(form, 'currency') || currencyCode;
    const row = await run(
      () => apiJson<Row>(`${API}/wallet?member=${encodeURIComponent(member)}&currency=${encodeURIComponent(currency)}`),
      'Wallet loaded',
      false,
    );
    if (row) setWallet(row);
  }

  async function generateEpins(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiresAt = formString(form, 'expiresAt');
    const result = await run(
      () => apiJson<{ generated: Array<{ pin: string }> }>(`${API}/epins`, {
        method: 'POST',
        body: JSON.stringify({
          seasonId: formString(form, 'seasonId') || undefined,
          quantity: formNumber(form, 'quantity', 1),
          assignUserReference: formString(form, 'assignUserReference') || undefined,
          expiresAt: new Date(expiresAt).toISOString(),
        }),
      }),
      'E-PIN batch generated',
    );
    if (result) setGeneratedEpins(result.generated.map((item) => item.pin));
  }

  async function revokeEpin(id: string) {
    await run(
      () => apiJson(`${API}/epins/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Revoked from owner portal' }),
      }),
      'E-PIN revoked',
    );
  }

  async function generateAuthCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run(
      () => apiJson<{ code: string }>(`${API}/auth-codes`, {
        method: 'POST',
        body: JSON.stringify({
          roleScope: formString(form, 'roleScope'),
          purpose: formString(form, 'purpose'),
          validityMinutes: formNumber(form, 'validityMinutes', 30),
        }),
      }),
      'Authorization code generated',
    );
    if (result) setGeneratedAuthCode(result.code);
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
          {section === 'payments' ? renderPayments() : section === 'wallet' ? renderWallet() : section === 'epins' ? renderEpins() : renderAuthCodes()}
        </div>
      </main>
      <nav className={styles.bottom}>
        {(['dashboard', 'payments', 'wallet', 'epins', 'auth-codes'] as Section[]).map((key) => {
          const item = NAV.find((entry) => entry.section === key)!;
          return <Link key={key} className={section === key ? styles.activeBottom : ''} href={href(key)}><strong>{item.symbol}</strong>{key === 'dashboard' ? 'Home' : item.label.split(' ')[0]}</Link>;
        })}
        <button type="button" onClick={() => setMobileMore(true)} className={mobileMore ? styles.activeBottom : ''}><strong>☰</strong>More</button>
      </nav>
      {mobileMore ? <><div className={styles.drawerBackdrop} onClick={() => setMobileMore(false)} /><div className={styles.mobileMore}><div className={styles.drawerHead}><b>All management tools</b><button type="button" onClick={() => setMobileMore(false)}>×</button></div>{NAV.map((item) => <Link key={item.section} className={classNames(styles.navItem, section === item.section && styles.activeNav)} href={href(item.section)} onClick={() => setMobileMore(false)}><span>{item.symbol}</span><span>{item.label}</span></Link>)}<button className={classNames(styles.button, styles.dark)} type="button" onClick={logout}>LOG OUT</button></div></> : null}
    </div>
  );

  function renderPayments() {
    const rows = data;
    return <><Hero title="Payments & Bills" subtitle="Registration, monthly EMI, receipts, payment modes, reconciliation and audit trail." pill={`${currencyCode} • AUTHORIZED ENTRY`} />
      <div className={styles.card}><SectionHead icon="¤" title="Record Payment" note="Purpose-bound authorization required" /><form method="post" onSubmit={submitPayment}><div className={styles.fields}><Field label="User ID / Mobile"><input name="memberReference" className={styles.input} required /></Field><Field label={`Payment Amount (${currencyCode})`}><input name="amount" className={styles.input} inputMode="decimal" required defaultValue="1000" /></Field><Field label="Payment Type"><select name="paymentType" className={styles.select}><option value="MONTHLY_EMI">Monthly EMI</option><option value="REGISTRATION">Registration</option><option value="OTHER">Other</option></select></Field><Field label="Payment Mode"><select name="paymentMode" className={styles.select}><option value="CASH">Cash</option><option value="UPI_ONLINE">UPI / Online</option><option value="BANK_TRANSFER">Bank Transfer</option></select></Field><Field label="Transaction / Receipt Reference"><input name="transactionReference" className={styles.input} placeholder="Optional provider/reference number" /></Field><Field label="Admin / Agent Auth Code"><input name="authorizationCode" className={styles.input} required placeholder="Generate under Auth Codes" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SUBMIT PAYMENT</button>{receipt ? <button className={classNames(styles.button, styles.dark)} type="button" onClick={() => window.print()}>PRINT RECEIPT</button> : null}</div></form></div>
      <div className={styles.card}><SectionHead icon="▥" title="Payment Register" note="Recorded payments with refund/reconciliation state" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>DATE</th><th>RECEIPT</th><th>MEMBER</th><th>TYPE</th><th>MODE</th><th>AMOUNT</th><th>REFUNDED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{dateTime(row.occurredAt)}</td><td>{text(row.receiptNumber)}</td><td><b>{text(row.username)}</b><br />{[text(row.firstName, ''), text(row.lastName, '')].filter(Boolean).join(' ') || '—'}</td><td>{text(row.paymentType)}</td><td>{text(row.paymentMode)}</td><td>{money(row.amount, text(row.currencyCode, currencyCode))}</td><td>{money(row.refundedAmount, text(row.currencyCode, currencyCode))}</td><td className={text(row.status) === 'RECORDED' ? styles.status : styles.statusOff}>{text(row.status)}</td><td><button type="button" className={classNames(styles.button, styles.outline)} onClick={() => void openReceipt(text(row.id))}>VIEW RECEIPT</button></td></tr>)}</tbody></table></div> : <Empty>No payments recorded yet.</Empty>}</div>
      <div className={styles.card}><SectionHead icon="▤" title="Receipt Preview" note="Authoritative payment record" />{receipt ? <div className={styles.notice}><b>{text(receipt.companyName, text(settings.companyName, 'MegaGoldenClub'))}</b> • Receipt {text(receipt.receiptNumber)} • Member {text((receipt.member as Row | undefined)?.fullName)} • User ID {text((receipt.member as Row | undefined)?.username)} • {text(receipt.paymentType)} {money(receipt.amount, text(receipt.currencyCode, currencyCode))} • Season {text((receipt.season as Row | undefined)?.name, 'Unmapped')} • Mode {text(receipt.paymentMode)} • Reference {text(receipt.transactionReference)} • Status {text(receipt.status)} • Refunds {money(receipt.refundedAmount, text(receipt.currencyCode, currencyCode))}.</div> : <Empty>Submit a payment or open a payment record to preview its receipt.</Empty>}</div>
    </>;
  }

  function renderWallet() {
    const entries = wallet && Array.isArray(wallet.recentEntries) ? wallet.recentEntries as Row[] : [];
    const walletCurrency = text(wallet?.currencyCode, currencyCode);
    return <><Hero title="Wallet & Ledger" subtitle="Separate income, reward, adjustment and payout ledger with running balances." pill={`${currencyCode} • AUTHORITATIVE LEDGER`} />
      <div className={styles.card}><form method="post" onSubmit={lookupWallet}><div className={styles.fields}><Field label="User ID / Mobile / Email"><input name="member" className={styles.input} required /></Field><Field label="Currency"><input name="currency" className={styles.input} value={currencyCode} readOnly /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>VIEW WALLET</button></div></form></div>
      {wallet ? <><div className={styles.kpis}><Kpi label="Wallet Balance" value={money(wallet.balance, walletCurrency)} note="Settled balance" /><Kpi label="Total Credits" value={money(wallet.creditTotal, walletCurrency)} note="All posted credits" /><Kpi label="Total Debits" value={money(wallet.debitTotal, walletCurrency)} note="All posted debits" /><Kpi label="Member" value={text((wallet.user as Row | undefined)?.username)} note="Ledger owner" /></div><div className={styles.card}><SectionHead icon="▤" title="Ledger" note={`${entries.length} latest entries`} />{entries.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>DATE</th><th>REFERENCE</th><th>TYPE</th><th>CREDIT</th><th>DEBIT</th><th>BALANCE</th></tr></thead><tbody>{entries.map((entry) => { const credit = text(entry.direction) === 'CREDIT'; return <tr key={text(entry.id)}><td>{dateTime((entry.transaction as Row | undefined)?.occurredAt ?? entry.createdAt)}</td><td>{text((entry.transaction as Row | undefined)?.sourceKey)}</td><td>{text((entry.transaction as Row | undefined)?.type)}</td><td>{credit ? money(entry.amount, walletCurrency) : '—'}</td><td>{credit ? '—' : money(entry.amount, walletCurrency)}</td><td>{money(entry.runningBalance, walletCurrency)}</td></tr>; })}</tbody></table></div> : <Empty>No ledger entries yet.</Empty>}</div></> : null}
    </>;
  }

  function renderEpins() {
    const rows = data;
    return <><Hero title="E-PIN Management" subtitle="Generate, assign, validate, expire, revoke and audit E-PINs." pill="SEASON-AWARE INVENTORY" />
      <div className={styles.card}><form method="post" onSubmit={generateEpins}><div className={styles.fields}><Field label="Season"><select name="seasonId" className={styles.select}><option value="">Any / No season restriction</option>{seasons.map((season) => <option key={text(season.id)} value={text(season.id)}>{text(season.name)} • {text(season.status)}</option>)}</select></Field><Field label="Quantity"><input name="quantity" className={styles.input} type="number" min="1" max="500" defaultValue="5" required /></Field><Field label="Assign User ID"><input name="assignUserReference" className={styles.input} placeholder="Optional existing member" /></Field><Field label="Expiry Date"><input name="expiresAt" className={styles.input} type="datetime-local" required /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>GENERATE E-PINS</button><button className={classNames(styles.button, styles.outline)} type="button" onClick={() => exportCsv(rows, 'epins.csv')}>DOWNLOAD CSV</button></div></form>{generatedEpins.length ? <div className={classNames(styles.notice, styles.success)}><b>Copy these new E-PINs now:</b><br />{generatedEpins.join(' • ')}</div> : null}</div>
      <div className={styles.card}><SectionHead icon="⌘" title="E-PIN Inventory" note="Expired entries are derived from their expiry timestamp" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>E-PIN</th><th>ASSIGNED TO</th><th>SEASON</th><th>CREATED</th><th>EXPIRY</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>••••{text(row.displaySuffix)}</td><td>{text(row.assignedUsername)}</td><td>{text(row.seasonName)}</td><td>{dateTime(row.createdAt)}</td><td>{dateTime(row.expiresAt)}</td><td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td><td>{text(row.status) === 'ACTIVE' ? <button type="button" className={classNames(styles.button, styles.red)} disabled={busy} onClick={() => void revokeEpin(text(row.id))}>REVOKE</button> : '—'}</td></tr>)}</tbody></table></div> : <Empty>No E-PINs generated yet.</Empty>}</div>
    </>;
  }

  function renderAuthCodes() {
    const rows = data;
    return <><Hero title="Authentication & Authorization" subtitle="Admin / agent codes, role controls, expiry and audit protection." pill="PURPOSE-BOUND ONE-TIME CODES" />
      <div className={styles.card}><form method="post" onSubmit={generateAuthCode}><div className={styles.fields}><Field label="Role"><select name="roleScope" className={styles.select}><option value="SUPER_ADMIN">Super Admin</option><option value="ADMIN">Admin</option><option value="AGENT">Agent</option></select></Field><Field label="Validity"><select name="validityMinutes" className={styles.select}><option value="30">30 Minutes</option><option value="60">1 Hour</option><option value="1440">24 Hours</option></select></Field><Field label="Operator"><input className={styles.input} value="Current signed-in administrator" readOnly /></Field><Field label="Purpose"><select name="purpose" className={styles.select}><option value="PAYMENT_AUTHORIZATION">Payment Authorization</option><option value="WINNER_APPROVAL">Winner Approval</option><option value="SEASON_CHANGE">Season Change</option><option value="EPIN_OPERATION">E-PIN Operation</option></select></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>GENERATE AUTH CODE</button></div></form>{generatedAuthCode ? <div className={classNames(styles.notice, styles.success)}><b>{generatedAuthCode}</b> • Copy this one-time authorization code now. Only its masked suffix remains visible in the register.</div> : null}</div>
      <div className={styles.card}><SectionHead icon="◈" title="Authorization Register" note="Operator, purpose, expiry and consumption state" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>CODE</th><th>ROLE</th><th>OPERATOR</th><th>PURPOSE</th><th>CREATED</th><th>EXPIRY</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>••••{text(row.displaySuffix)}</td><td>{text(row.roleScope)}</td><td>{text(row.operatorUsername)}</td><td>{text(row.purpose)}</td><td>{dateTime(row.createdAt)}</td><td>{dateTime(row.expiresAt)}</td><td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td></tr>)}</tbody></table></div> : <Empty>No authorization codes generated yet.</Empty>}</div>
    </>;
  }
}

function exportCsv(rows: Row[], filename: string) {
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => {
    const value = row[key];
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
  })))];
  const escape = (value: unknown) => `"${text(value, '').replaceAll('"', '""')}"`;
  const csv = [keys.map(escape).join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
