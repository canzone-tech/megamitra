'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import styles from './owner-portal.module.css';

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
  | 'reports'
  | 'notifications'
  | 'support'
  | 'settings';

type Row = Record<string, unknown>;
type PrizeDraft = {
  monthNumber: number;
  prizeCode: string;
  category: string;
  name: string;
  description?: string;
  winnerCount: number;
  nominalValue?: string;
};

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
  { section: 'payments', label: 'Payments / Bills', symbol: '₹', group: 'Finance & Security' },
  { section: 'wallet', label: 'Wallet / Ledger', symbol: '▤', group: 'Finance & Security' },
  { section: 'epins', label: 'E-PIN Management', symbol: '⌘', group: 'Finance & Security' },
  { section: 'auth-codes', label: 'Auth Codes', symbol: '◈', group: 'Finance & Security' },
  { section: 'reports', label: 'Reports', symbol: '▥', group: 'Control' },
  { section: 'notifications', label: 'Notifications', symbol: '◉', group: 'Control' },
  { section: 'support', label: 'Support', symbol: '?', group: 'Control' },
  { section: 'settings', label: 'Settings', symbol: '⚙', group: 'Control' },
];

const TITLES: Record<Section, string> = Object.fromEntries(NAV.map((item) => [item.section, item.label])) as Record<Section, string>;

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
function money(value: unknown) {
  return `₹${number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
function dateValue(value: unknown) {
  const raw = text(value, '');
  return raw ? raw.slice(0, 10) : '';
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
function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={classNames(styles.field, full && styles.full)}><label>{label}</label>{children}</div>;
}
function Hero({ title, subtitle, pill }: { title: string; subtitle: string; pill?: string }) {
  return <div className={styles.hero}><h1>{title}</h1><p>{subtitle}</p>{pill ? <span className={styles.pill}>{pill}</span> : null}</div>;
}
function SectionHead({ icon, title, note, action }: { icon: string; title: string; note?: string; action?: React.ReactNode }) {
  return <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>{icon}</span><h2>{title}</h2></div>{action ?? (note ? <small>{note}</small> : null)}</div>;
}
function Empty({ children = 'No records yet.' }: { children?: React.ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

export function OwnerPortal({ section }: { section: Section }) {
  const router = useRouter();
  const [data, setData] = useState<unknown>(null);
  const [aux, setAux] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileMore, setMobileMore] = useState(false);
  const [editingSeason, setEditingSeason] = useState<Row | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [prizeDraft, setPrizeDraft] = useState<PrizeDraft[]>([]);
  const [selectedDrawId, setSelectedDrawId] = useState('');
  const [wallet, setWallet] = useState<Row | null>(null);
  const [generatedSecrets, setGeneratedSecrets] = useState<string[]>([]);

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

  const fetchSection = useCallback(async () => {
    setError('');
    setNotice('');
    try {
      if (section === 'dashboard') setData(await apiJson<Row>(`${API}/dashboard`));
      else if (section === 'members') setData(await apiJson<Row[]>(`${API}/members`));
      else if (section === 'binary') setData(await apiJson<Row[]>(`${API}/pair-ledger`));
      else if (section === 'seasons' || section === 'income') setData(await apiJson<Row[]>(`${API}/seasons`));
      else if (section === 'draw' || section === 'winners') {
        const [seasons, draws] = await Promise.all([
          apiJson<Row[]>(`${API}/seasons`),
          apiJson<Row[]>(`${API}/draws`),
        ]);
        setData(seasons);
        setAux(draws);
      } else if (section === 'prizes') {
        const seasons = await apiJson<Row[]>(`${API}/seasons`);
        setData(seasons);
        if (seasons.length && !selectedSeasonId) {
          const id = text(seasons[0].id, '');
          setSelectedSeasonId(id);
          const prizes = await apiJson<Row[]>(`${API}/seasons/${encodeURIComponent(id)}/prizes`);
          setPrizeDraft(prizes.map(prizeFromRow));
        }
      } else if (section === 'epins') setData(await apiJson<Row[]>(`${API}/epins`));
      else if (section === 'auth-codes') setData(await apiJson<Row[]>(`${API}/auth-codes`));
      else if (section === 'reports') setData(await apiJson<Row[]>(`${API}/reports`));
      else if (section === 'notifications') setData(await apiJson<Row[]>(`${API}/notifications`));
      else if (section === 'support') setData(await apiJson<Row[]>(`${API}/support`));
      else if (section === 'settings') setData(await apiJson<Row>(`${API}/settings`));
      else setData(null);
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, section, selectedSeasonId]);

  useEffect(() => {
    void fetchSection();
  }, [fetchSection]);

  const act = async <T,>(work: () => Promise<T>, success: string, reload = true): Promise<T | null> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      setNotice(success);
      if (reload) await fetchSection();
      return result;
    } catch (err) {
      handleApiError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await fetch('/api/session/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, NavItem[]>();
    NAV.forEach((item) => groups.set(item.group, [...(groups.get(item.group) ?? []), item]));
    return [...groups.entries()];
  }, []);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/operations"><span className={styles.logo}>MG</span><span><span className={styles.brandName}>MEGA<em>GOLDEN</em>CLUB</span><span className={styles.brandSub}>Professional Management Portal</span></span></Link>
        <nav className={styles.menu}>{grouped.map(([group, items]) => <div key={group}><div className={styles.menuTitle}>{group}</div>{items.map((item) => <NavLink key={item.section} item={item} current={section} />)}</div>)}</nav>
        <div className={styles.profile}><span className={styles.avatar}>A</span><div><b>Administrator</b><span>Owner management access</span></div></div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}><div className={styles.crumb}><b>{TITLES[section]}</b><span>MegaGoldenClub • Professional management portal</span></div><div className={styles.actions}><Link className={classNames(styles.iconButton, styles.linkButton)} href="/presentation" aria-label="Appearance">◐</Link><Link className={classNames(styles.iconButton, styles.linkButton)} href="/security" aria-label="Security">◇</Link><button className={styles.logout} type="button" onClick={logout} disabled={busy}>LOG OUT</button></div></header>
        <div className={styles.content}>
          {error ? <div className={classNames(styles.notice, styles.error)}>{error}</div> : null}
          {notice ? <div className={classNames(styles.notice, styles.success)}>{notice}</div> : null}
          {renderSection()}
        </div>
      </main>

      <nav className={styles.bottom}>
        {(['dashboard', 'income', 'binary', 'seasons', 'draw'] as Section[]).map((key) => {
          const item = NAV.find((entry) => entry.section === key)!;
          return <Link key={key} className={section === key ? styles.activeBottom : ''} href={href(key)}><strong>{item.symbol}</strong>{key === 'dashboard' ? 'Home' : item.label.split(' ')[0]}</Link>;
        })}
        <button type="button" onClick={() => setMobileMore(true)} className={mobileMore ? styles.activeBottom : ''}><strong>☰</strong>More</button>
      </nav>
      {mobileMore ? <><div className={styles.drawerBackdrop} onClick={() => setMobileMore(false)} /><div className={styles.mobileMore}><div className={styles.drawerHead}><b>All management tools</b><button type="button" onClick={() => setMobileMore(false)}>×</button></div>{NAV.map((item) => <NavLink key={item.section} item={item} current={section} onClick={() => setMobileMore(false)} />)}<button className={classNames(styles.button, styles.dark)} type="button" onClick={logout}>LOG OUT</button></div></> : null}
    </div>
  );

  function renderSection() {
    if (section === 'dashboard') return renderDashboard();
    if (section === 'income') return renderIncome();
    if (section === 'members') return renderMembers();
    if (section === 'binary') return renderBinary();
    if (section === 'placement') return renderPlacement();
    if (section === 'seasons') return renderSeasons();
    if (section === 'draw') return renderDraw();
    if (section === 'winners') return renderWinners();
    if (section === 'prizes') return renderPrizes();
    if (section === 'payments') return renderPayments();
    if (section === 'wallet') return renderWallet();
    if (section === 'epins') return renderEpins();
    if (section === 'auth-codes') return renderAuthCodes();
    if (section === 'reports') return renderReports();
    if (section === 'notifications') return renderNotifications();
    if (section === 'support') return renderSupport();
    return renderSettings();
  }

  function renderDashboard() {
    const row = (data ?? {}) as Row;
    const active = (row.activeSeason && typeof row.activeSeason === 'object' ? row.activeSeason : {}) as Row;
    return <><Hero title="MegaGoldenClub Management Dashboard" subtitle="Central control for seasons, members, Binary 2:2 AB : CD, payments, monthly draws and reporting." pill="LIVE MANAGEMENT ENVIRONMENT" />
      <div className={styles.kpis}><Kpi label="Active Season" value={text(active.name, 'No active season')} note={text(active.status, 'Create or activate a season')} /><Kpi label="Members" value={number(row.memberCount).toLocaleString('en-IN')} note="Registered accounts" /><Kpi label="Qualified Pairs" value={number(row.qualifiedPairs).toLocaleString('en-IN')} note="AC + BD matching" /><Kpi label="Daily Cap" value={money(row.dailyCap)} note="Current season rule" /></div>
      <div className={styles.grid2}><div><div className={styles.card}><SectionHead icon="↗" title="Activity Overview" note="Live operational snapshot" /><div className={styles.summary}><div><small>OPEN SUPPORT</small><b>{number(row.openTickets)}</b></div><div><small>NOTICES WAITING</small><b>{number(row.pendingNotifications)}</b></div><div><small>SEASON STATUS</small><b>{text(active.status)}</b></div><div><small>DRAW DAY</small><b>{active.drawDay ? `${text(active.drawDay)}th` : '—'}</b></div></div></div><div className={styles.card}><SectionHead icon="₹" title="9 Income / Reward Types" /><IncomeCards season={active} compact /></div></div><div><div className={styles.card}><SectionHead icon="⚡" title="Quick Actions" /><div className={styles.quick}><Quick href="/portal/seasons" label="+ CREATE SEASON" /><Quick href="/portal/members" label="+ ADD MEMBER" dark /><Quick href="/portal/draw" label="MANAGE DRAW" green /><Quick href="/portal/reports" label="VIEW REPORTS" outline /></div></div><div className={styles.card}><SectionHead icon="i" title="Current Configuration" /><div className={styles.notice}><b>Joining:</b> {money(number(active.registrationFee) + number(active.installmentAmount))} = {money(active.installmentAmount)} monthly EMI + {money(active.registrationFee)} registration.</div><div className={classNames(styles.notice, styles.warn)}>Income, prize and eligibility values remain owner-configurable. Active financial rules are locked through the season lifecycle.</div></div></div></div></>;
  }

  function renderIncome() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const active = seasons.find((row) => ['ACTIVE', 'PAUSED'].includes(text(row.status, ''))) ?? seasons[0] ?? {};
    return <><Hero title="9 Income / Reward Types" subtitle="Owner-friendly view of the reward categories in the final client reference." pill="CONFIGURED VALUES • POLICY CONTROLLED" /><div className={styles.card}><IncomeCards season={active} /></div><div className={styles.card}><SectionHead icon="=" title="Core Calculation" /><div className={styles.notice}><b>Direct Referral:</b> {money(active.directReferral)} per qualifying direct referral. <b>Binary Pair:</b> AC + BD = one qualifying 2:2 pair at {money(active.pairValue)}. <b>Daily cap:</b> {money(active.dailyCap)} for the active season.</div><div className={classNames(styles.notice, styles.warn)}>Rank Achievement, Leadership, Recognition Reward, Retail Sales Commission and Community Pool remain configurable categories because the supplied final HTML does not define their formulas.</div></div></>;
  }

  function renderMembers() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="Member Management" subtitle="Registration, sponsor validation, placement, profile, KYC and account status." />
      <div className={styles.card}><SectionHead icon="+" title="Create Member" /><form method="post" onSubmit={submitMember}><div className={styles.fields}><Field label="Sponsor ID / Auto Sponsor" full><input name="sponsorReference" className={styles.input} placeholder="Sponsor ID, mobile or email" /></Field><Field label="E-PIN"><input name="epin" className={styles.input} placeholder="Optional E-PIN" /></Field><Field label="Placement"><select name="placement" className={styles.select} defaultValue="AUTO"><option value="AUTO">Auto Placement</option><option value="LEFT">AB • Left</option><option value="RIGHT">CD • Right</option></select></Field><Field label="Full Name"><input name="fullName" className={styles.input} required placeholder="Full name" /></Field><Field label="Mobile"><input name="phone" className={styles.input} placeholder="+91" /></Field><Field label="Email"><input name="email" className={styles.input} type="email" placeholder="Email" /></Field><Field label="Date of Birth"><input name="dateOfBirth" className={styles.input} type="date" /></Field><Field label="State"><input name="state" className={styles.input} /></Field><Field label="City"><input name="city" className={styles.input} /></Field><Field label="Password"><input name="password" className={styles.input} type="password" required /></Field><Field label="Member Type"><select name="memberType" className={styles.select}><option value="PARTNER">Partner</option><option value="CUSTOMER">Customer</option></select></Field><Field label="Placement Reference"><input name="placementReference" className={styles.input} placeholder="Defaults to sponsor" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SUBMIT REGISTRATION</button><button className={classNames(styles.button, styles.dark)} type="reset">RESET</button></div></form></div>
      <div className={styles.card}><SectionHead icon="●" title="Member Directory" note={`${rows.length} recent records`} />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>USER ID</th><th>NAME</th><th>SPONSOR</th><th>POSITION</th><th>TYPE</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.username)}</td><td>{[text(row.firstName, ''), text(row.lastName, '')].filter(Boolean).join(' ') || '—'}</td><td>{text(row.sponsorUsername)}</td><td>{row.placementSide ? `${text(row.placementSide)} • ${text(row.placementParentUsername)}` : 'Pending'}</td><td>{text(row.memberType, 'CUSTOMER')}</td><td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td></tr>)}</tbody></table></div> : <Empty />}</div></>;
  }

  function renderBinary() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="Binary 2:2 • AB : CD" subtitle="Two-position binary structure with AB as left and CD as right." pill="AB : CD = 2 : 2" /><div className={styles.card}><SectionHead icon="◇" title="Binary Structure" /><div className={styles.binaryBox}><div className={styles.binaryRow}><div className={classNames(styles.node, styles.root)}><b>YOU</b><span>Selected member</span></div></div><div className={styles.binaryRow}><div className={styles.node}><b>AB • LEFT</b><span>Left position</span></div><div className={styles.node}><b>CD • RIGHT</b><span>Right position</span></div></div><div className={styles.binaryRow}><div className={styles.node}><b>A</b><span>Left unit</span></div><div className={styles.node}><b>B</b><span>Left unit</span></div><div className={styles.node}><b>C</b><span>Right unit</span></div><div className={styles.node}><b>D</b><span>Right unit</span></div></div><div className={styles.pairBox}>AC + BD = 1 QUALIFYING PAIR</div></div></div><div className={styles.card}><SectionHead icon="⌁" title="Pair Ledger" note="Live qualified pair records" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>PAIR</th><th>MEMBER</th><th>LEFT UNIT</th><th>RIGHT UNIT</th><th>VALUE</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.pairSequence)}</td><td>{text(row.username)}</td><td>{text(row.leftUnitId)}</td><td>{text(row.rightUnitId)}</td><td>{money(row.payoutAmount)}</td><td className={row.payable ? styles.status : styles.statusOff}>{row.payable ? 'QUALIFIED' : 'CAP LIMITED'}</td></tr>)}</tbody></table></div> : <Empty>No pair records yet.</Empty>}</div></>;
  }

  function renderPlacement() {
    return <><Hero title="Placement & Pairing" subtitle="Control AB / CD placement, auto placement and qualification structure." /><div className={styles.card}><form method="post" onSubmit={submitPlacement}><div className={styles.fields}><Field label="Member ID"><input name="memberReference" className={styles.input} required placeholder="User ID / mobile / email" /></Field><Field label="Placement Side"><select name="side" className={styles.select}><option value="AUTO">Auto Placement</option><option value="LEFT">AB • LEFT</option><option value="RIGHT">CD • RIGHT</option></select></Field><Field label="Reference Member"><input name="parentReference" className={styles.input} required placeholder="Parent / reference member" /></Field><Field label="Pair Rule"><input className={styles.input} value="AC + BD" readOnly /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE PLACEMENT</button><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/portal/binary">VIEW PAIR LEDGER</Link></div></form></div><div className={styles.card}><SectionHead icon="✓" title="Pairing Controls" /><div className={styles.notice}>Placement history and ancestry are persisted by the backend. A member cannot be placed twice, occupy an already-filled side, or create a binary cycle.</div></div></>;
  }

  function renderSeasons() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    const edit = editingSeason;
    return <><Hero title="Season Management" subtitle="Create, review, activate, pause, close and archive monthly reward seasons." pill="OWNER-FRIENDLY BUSINESS CONTROL" /><div className={styles.card}><SectionHead icon="□" title={edit ? `Edit ${text(edit.name)}` : 'Create New Season'} action={edit ? <button type="button" className={classNames(styles.button, styles.outline)} onClick={() => setEditingSeason(null)}>CANCEL EDIT</button> : undefined} /><form key={text(edit?.id, 'new')} method="post" onSubmit={submitSeason}><div className={styles.fields}><Field label="Season Name"><input name="name" className={styles.input} required defaultValue={text(edit?.name, '') || 'New MegaGoldenClub Season'} /></Field><Field label="Season Code"><input name="code" className={styles.input} defaultValue={text(edit?.code, '')} placeholder="Auto generated when blank" disabled={Boolean(edit)} /></Field><Field label="Monthly EMI"><input name="monthlyEmi" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.monthlyEmi, '1000')} /></Field><Field label="Registration Fee"><input name="registrationFee" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.registrationFee, '1000')} /></Field><Field label="Total Months"><input name="totalMonths" className={styles.input} type="number" min="1" max="60" required defaultValue={number(edit?.totalMonths, 21)} /></Field><Field label="Draw Day"><input name="drawDay" className={styles.input} type="number" min="1" max="31" required defaultValue={number(edit?.drawDay, 25)} /></Field><Field label="Start Date"><input name="startDate" className={styles.input} type="date" required defaultValue={dateValue(edit?.startDate) || new Date().toISOString().slice(0,10)} /></Field><Field label="End Date"><input name="endDate" className={styles.input} type="date" defaultValue={dateValue(edit?.endDate)} /></Field><Field label="Daily Income Cap"><input name="dailyCap" className={styles.input} type="number" min="0" required defaultValue={number(edit?.dailyCap, 5000)} /></Field><Field label="Pair Value"><input name="pairValue" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.pairValue, '200')} /></Field><Field label="Direct Referral"><input name="directReferral" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.directReferral, '250')} /></Field><Field label="Eligibility Cut-off"><select name="eligibilityCutoff" className={styles.select} defaultValue={text(edit?.eligibilityCutoff, 'BEFORE_DRAW_DATE')}><option value="BEFORE_DRAW_DATE">Before Draw Date</option><option value="PAYMENT_DUE_DATE">Payment Due Date</option><option value="ADMIN_DEFINED">Admin Defined</option></select></Field><Field label="Carry Forward"><select name="carryForward" className={styles.select} defaultValue={edit ? String(Boolean(edit.carryForward)) : 'true'}><option value="true">Enabled</option><option value="false">Disabled</option></select></Field><Field label="Season Description" full><textarea name="description" className={styles.textarea} defaultValue={text(edit?.description, '')} placeholder="Business description for this season" /></Field></div><div className={styles.summary}><div><small>JOINING</small><b>{money(number(edit?.monthlyEmi,1000)+number(edit?.registrationFee,1000))}</b></div><div><small>MONTHLY EMI</small><b>{money(edit?.monthlyEmi ?? 1000)}</b></div><div><small>PAIR</small><b>{money(edit?.pairValue ?? 200)}</b></div><div><small>DAILY CAP</small><b>{money(edit?.dailyCap ?? 5000)}</b></div></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>{edit ? 'SAVE CHANGES' : 'CREATE SEASON'}</button><Link className={classNames(styles.button, styles.dark, styles.linkButton)} href="/portal/prizes">MANAGE PRIZE SCHEDULE</Link></div></form></div>
      <div className={styles.card}><SectionHead icon="≡" title="Season Register" note="Draft → Review → Active → Closed / Archived" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>SEASON</th><th>START</th><th>MONTHS</th><th>EMI</th><th>DRAW DAY</th><th>PAIR</th><th>CAP</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td><b>{text(row.name)}</b><br />{text(row.code)}</td><td>{dateValue(row.startDate)}</td><td>{text(row.totalMonths)}</td><td>{money(row.monthlyEmi)}</td><td>{text(row.drawDay)}th</td><td>{money(row.pairValue)}</td><td>{money(row.dailyCap)}</td><td className={['ACTIVE','REVIEW'].includes(text(row.status)) ? styles.status : text(row.status)==='ARCHIVED' ? styles.statusOff : ''}>{text(row.status)}</td><td><div className={styles.buttonLine}><button type="button" className={classNames(styles.button, styles.outline)} onClick={() => setEditingSeason(row)} disabled={!['DRAFT','REVIEW'].includes(text(row.status))}>EDIT</button>{seasonActionButtons(row)}</div></td></tr>)}</tbody></table></div> : <Empty>Create the first season to begin.</Empty>}</div></>;
  }

  function renderDraw() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const runs = (Array.isArray(aux) ? aux : []) as Row[];
    const active = seasons.find((row) => text(row.status) === 'ACTIVE');
    return <><Hero title="Monthly Lucky Draw" subtitle="Monthwise schedule, eligibility lock, prize allocation and draw administration." /><div className={styles.card}><SectionHead icon="□" title="Prepare Monthly Draw" /><form method="post" onSubmit={submitDraw}><div className={styles.fields}><Field label="Season"><select name="seasonId" className={styles.select} required defaultValue={text(active?.id, '')}><option value="">Select active season</option>{seasons.filter((row)=>text(row.status)==='ACTIVE').map((row)=><option key={text(row.id)} value={text(row.id)}>{text(row.name)}</option>)}</select></Field><Field label="Draw Month"><input name="monthNumber" className={styles.input} type="number" min="1" max="60" defaultValue="1" required /></Field><Field label="Entry Window Start"><input name="entryWindowStart" className={styles.input} type="datetime-local" required /></Field><Field label="Eligibility Cut-off"><input name="entryWindowEnd" className={styles.input} type="datetime-local" required /></Field><Field label="Draw Date / Time"><input name="drawAt" className={styles.input} type="datetime-local" required /></Field><Field label="Selection Method"><input className={styles.input} value="Auditable committed random selection" readOnly /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>PREPARE DRAW</button><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/portal/prizes">VIEW PRIZE SCHEDULE</Link></div></form></div><div className={styles.card}><SectionHead icon="◆" title="Draw Register" />{runs.length ? <DrawRunTable rows={runs} onOpen={(id)=>router.push(`/portal/winners?draw=${encodeURIComponent(id)}`)} /> : <Empty>No monthly draws prepared yet.</Empty>}</div></>;
  }

  function renderWinners() {
    const runs = (Array.isArray(aux) ? aux : []) as Row[];
    const selected = (data && !Array.isArray(data) ? data : null) as Row | null;
    const winners = (selected && Array.isArray(selected.winners) ? selected.winners : []) as Row[];
    return <><Hero title="Winner Management Workflow" subtitle="Eligibility → selection → verification → approval → publication → claim → fulfilment → audit." pill="CONTROLLED WINNER WORKFLOW" /><div className={styles.card}><SectionHead icon="1" title="Winner Workflow" /><div className={styles.workflow}><div><small>STEP 1</small><b>Eligibility Lock</b></div><div><small>STEP 2</small><b>Draw / Selection</b></div><div><small>STEP 3</small><b>Verification</b></div><div><small>STEP 4</small><b>Approval</b></div><div><small>STEP 5</small><b>Publish & Fulfil</b></div></div></div><div className={styles.card}><SectionHead icon="◆" title="Draws" />{runs.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>SEASON</th><th>MONTH</th><th>DRAW DATE</th><th>ELIGIBLE</th><th>WINNERS</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{runs.map((row)=><tr key={text(row.id)}><td>{text(row.seasonName)}</td><td>{text(row.monthNumber)}</td><td>{text(row.drawAt).replace('T',' ').slice(0,16)}</td><td>{text(row.eligibleEntryCount,'0')}</td><td>{text(row.winnerCount,'0')}</td><td><span className={styles.tag}>{text(row.status)}</span></td><td><button className={classNames(styles.button, styles.outline)} type="button" onClick={()=>openDraw(text(row.id))}>OPEN</button></td></tr>)}</tbody></table></div> : <Empty />}</div>{selected ? <><div className={styles.card}><SectionHead icon="⚙" title={`${text(selected.seasonName)} • Month ${text(selected.monthNumber)}`} note={text(selected.status)} /><div className={styles.buttonLine}>{text(selected.status)==='SCHEDULED' ? <button className={styles.button} type="button" disabled={busy} onClick={()=>drawAction('lock-eligibility','Eligibility locked')}>LOCK ELIGIBILITY</button>:null}{text(selected.status)==='ELIGIBILITY_LOCKED' ? <button className={classNames(styles.button, styles.dark)} type="button" disabled={busy} onClick={()=>drawAction('select-winners','Winner selection completed')}>RUN SELECTION</button>:null}{text(selected.status)==='APPROVED' ? <button className={classNames(styles.button, styles.dark)} type="button" disabled={busy} onClick={()=>drawAction('publish','Winner list published')}>PUBLISH WINNERS</button>:null}</div></div><div className={styles.card}><SectionHead icon="✓" title="Winner Verification Queue" />{winners.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>USER ID</th><th>NAME</th><th>PRIZE</th><th>ELIGIBILITY</th><th>IDENTITY</th><th>PAYMENT</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{winners.map((winner)=><tr key={text(winner.id)}><td>{text(winner.username)}</td><td>{[text(winner.firstName,''),text(winner.lastName,'')].filter(Boolean).join(' ')}</td><td>{text(winner.prizeName)}</td><td>{text(winner.eligibilityStatus,'PASS')}</td><td>{text(winner.identityStatus,'PENDING')}</td><td>{text(winner.paymentStatus,'PASS')}</td><td><span className={styles.tag}>{text(winner.verificationStatus,'PENDING')}</span></td><td>{text(winner.verificationStatus)!=='VERIFIED' ? <button type="button" className={classNames(styles.button,styles.outline)} onClick={()=>verifyWinner(text(winner.id))} disabled={busy}>VERIFY PASS</button>: 'Verified'}</td></tr>)}</tbody></table></div>:<Empty>Run selection to create the verification queue.</Empty>}</div>{text(selected.status)==='VERIFIED' ? <div className={styles.card}><SectionHead icon="✓" title="Approval & Publication" /><form method="post" onSubmit={approveDraw}><div className={styles.fields}><Field label="Approval Reference"><input name="approvalReference" className={styles.input} required /></Field><Field label="Winner Approval Auth Code"><input name="authorizationCode" className={styles.input} placeholder="Optional purpose-bound code" /></Field><Field label="Approval Note" full><textarea name="approvalNote" className={styles.textarea} /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>APPROVE VERIFIED WINNERS</button></div></form></div>:null}</>:null}</>;
  }

  function renderPrizes() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="Prize Catalogue" subtitle="Manage monthwise prize categories, winner limits and season allocation." /><div className={styles.card}><SectionHead icon="▣" title="Prize Schedule" /><Field label="Season"><select className={styles.select} value={selectedSeasonId} onChange={(event)=>void changePrizeSeason(event.target.value)}><option value="">Select season</option>{seasons.map((row)=><option key={text(row.id)} value={text(row.id)}>{text(row.name)} • {text(row.status)}</option>)}</select></Field></div>{selectedSeasonId ? <div className={styles.card}><SectionHead icon="◆" title="Monthwise Prizes" note={`${prizeDraft.length} configured prizes`} />{prizeDraft.length ? <div className={styles.months}>{prizeDraft.map((prize,index)=><div className={styles.month} key={`${prize.monthNumber}-${prize.prizeCode}`}><span className={styles.monthNo}>{prize.monthNumber}</span><h3>MONTH {prize.monthNumber}</h3><div className={styles.prizeVisual}>◆</div><Field label="Prize Name"><input className={styles.input} value={prize.name} onChange={(event)=>updatePrize(index,'name',event.target.value)} /></Field><Field label="Winner Count"><input className={styles.input} type="number" min="1" value={prize.winnerCount} onChange={(event)=>updatePrize(index,'winnerCount',Number(event.target.value)||1)} /></Field></div>)}</div>:<Empty>No prize schedule yet.</Empty>}<div className={styles.buttonLine}><button type="button" className={styles.button} disabled={busy||!prizeDraft.length} onClick={savePrizes}>SAVE PRIZE SCHEDULE</button></div></div>:null}</>;
  }

  function renderPayments() {
    return <><Hero title="Payments & Bills" subtitle="Registration, monthly EMI, receipts, payment modes, reconciliation and audit trail." /><div className={styles.card}><form method="post" onSubmit={submitPayment}><div className={styles.fields}><Field label="User ID / Mobile"><input name="memberReference" className={styles.input} required /></Field><Field label="Payment Amount"><input name="amount" className={styles.input} inputMode="decimal" required defaultValue="1000" /></Field><Field label="Payment Type"><select name="paymentType" className={styles.select}><option value="MONTHLY_EMI">Monthly EMI</option><option value="REGISTRATION">Registration</option><option value="OTHER">Other</option></select></Field><Field label="Payment Mode"><select name="paymentMode" className={styles.select}><option value="CASH">Cash</option><option value="UPI_ONLINE">UPI / Online</option><option value="BANK_TRANSFER">Bank Transfer</option></select></Field><Field label="Transaction / Receipt Reference"><input name="transactionReference" className={styles.input} /></Field><Field label="Admin / Agent Auth Code"><input name="authorizationCode" className={styles.input} required placeholder="Generate under Auth Codes" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SUBMIT PAYMENT</button><button className={classNames(styles.button,styles.dark)} type="button" onClick={()=>window.print()}>PRINT PAGE</button></div></form></div><div className={classNames(styles.notice,styles.warn)}>Manual payments require a one-time purpose-bound authorization code. This prevents a browser form from becoming an unaudited cash-entry shortcut.</div></>;
  }

  function renderWallet() {
    const entries = (wallet && Array.isArray(wallet.recentEntries) ? wallet.recentEntries : []) as Row[];
    return <><Hero title="Wallet & Ledger" subtitle="Transparent income, reward, adjustment and payout ledger." /><div className={styles.card}><form method="post" onSubmit={lookupWallet}><div className={styles.fields}><Field label="User ID / Mobile / Email"><input name="member" className={styles.input} required /></Field><Field label="Currency"><select name="currency" className={styles.select}><option>INR</option></select></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>VIEW WALLET</button></div></form></div>{wallet ? <><div className={styles.kpis}><Kpi label="Wallet Balance" value={money(wallet.balance)} note={text(wallet.currencyCode,'INR')} /><Kpi label="Member" value={text((wallet.user as Row | undefined)?.username)} note="Ledger owner" /><Kpi label="Recent Entries" value={entries.length} note="Latest ledger activity" /><Kpi label="Account" value={wallet.account ? 'Active' : 'Not created'} note="System-managed" /></div><div className={styles.card}><SectionHead icon="▤" title="Ledger" />{entries.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>DATE</th><th>REFERENCE</th><th>TYPE</th><th>DIRECTION</th><th>AMOUNT</th></tr></thead><tbody>{entries.map((entry)=><tr key={text(entry.id)}><td>{text(entry.createdAt).replace('T',' ').slice(0,19)}</td><td>{text((entry.transaction as Row | undefined)?.sourceKey)}</td><td>{text((entry.transaction as Row | undefined)?.type)}</td><td>{text(entry.direction)}</td><td>{money(entry.amount)}</td></tr>)}</tbody></table></div>:<Empty>No ledger entries yet.</Empty>}</div></>:null}</>;
  }

  function renderEpins() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="E-PIN Management" subtitle="Generate, assign, validate, expire, revoke and audit E-PINs." /><div className={styles.card}><form method="post" onSubmit={generateEpins}><div className={styles.fields}><Field label="Season ID"><input name="seasonId" className={styles.input} placeholder="Optional season ID" /></Field><Field label="Quantity"><input name="quantity" className={styles.input} type="number" min="1" max="500" defaultValue="5" /></Field><Field label="Assign User ID"><input name="assignUserReference" className={styles.input} placeholder="Optional existing member" /></Field><Field label="Expiry Date"><input name="expiresAt" className={styles.input} type="datetime-local" required /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>GENERATE E-PINS</button><button className={classNames(styles.button,styles.outline)} type="button" onClick={()=>exportCsv(rows,'epins.csv')}>DOWNLOAD CSV</button></div></form>{generatedSecrets.length ? <div className={classNames(styles.notice,styles.success)}><b>Copy these new E-PINs now:</b><br />{generatedSecrets.join(' • ')}</div>:null}</div><div className={styles.card}><SectionHead icon="⌘" title="E-PIN Inventory" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>E-PIN</th><th>ASSIGNED TO</th><th>SEASON</th><th>EXPIRY</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row)=><tr key={text(row.id)}><td>••••{text(row.displaySuffix)}</td><td>{text(row.assignedUsername)}</td><td>{text(row.seasonName)}</td><td>{text(row.expiresAt).replace('T',' ').slice(0,16)}</td><td className={text(row.status)==='ACTIVE'?styles.status:styles.statusOff}>{text(row.status)}</td><td>{text(row.status)==='ACTIVE'?<button type="button" className={classNames(styles.button,styles.red)} onClick={()=>void act(()=>apiJson(`${API}/epins/${encodeURIComponent(text(row.id))}/revoke`,{method:'POST',body:JSON.stringify({reason:'Revoked from owner portal'})}),'E-PIN revoked')}>REVOKE</button>:'—'}</td></tr>)}</tbody></table></div>:<Empty />}</div></>;
  }

  function renderAuthCodes() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="Authentication & Authorization" subtitle="Purpose-bound admin / agent operation codes with expiry and audit protection." /><div className={styles.card}><form method="post" onSubmit={generateAuthCode}><div className={styles.fields}><Field label="Role"><select name="roleScope" className={styles.select}><option>SUPER_ADMIN</option><option>ADMIN</option><option>AGENT</option></select></Field><Field label="Validity"><select name="validityMinutes" className={styles.select}><option value="30">30 Minutes</option><option value="60">1 Hour</option><option value="1440">24 Hours</option></select></Field><Field label="Purpose"><select name="purpose" className={styles.select}><option value="PAYMENT_AUTHORIZATION">Payment Authorization</option><option value="WINNER_APPROVAL">Winner Approval</option><option value="SEASON_CHANGE">Season Change</option><option value="EPIN_OPERATION">E-PIN Operation</option></select></Field><Field label="Operator"><input className={styles.input} value="Current signed-in administrator" readOnly /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>GENERATE AUTH CODE</button></div></form>{generatedSecrets.length ? <div className={classNames(styles.notice,styles.success)}><b>One-time code:</b> {generatedSecrets.at(-1)}</div>:null}</div><div className={styles.card}><SectionHead icon="◈" title="Recent Codes" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>CODE</th><th>ROLE</th><th>PURPOSE</th><th>EXPIRY</th><th>STATUS</th></tr></thead><tbody>{rows.map((row)=><tr key={text(row.id)}><td>••••{text(row.displaySuffix)}</td><td>{text(row.roleScope)}</td><td>{text(row.purpose)}</td><td>{text(row.expiresAt).replace('T',' ').slice(0,16)}</td><td>{text(row.status)}</td></tr>)}</tbody></table></div>:<Empty />}</div></>;
  }

  function renderReports() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="Reports & Analytics" subtitle="Operational, financial, season, draw, binary and member reports." /><div className={styles.card}><div className={styles.tableBox}><table className={styles.table}><thead><tr><th>REPORT</th><th>PERIOD</th><th>FORMAT</th><th>ACTION</th></tr></thead><tbody>{rows.map((row)=><tr key={text(row.code)}><td>{text(row.name)}</td><td>{text(row.period)}</td><td>{Array.isArray(row.formats)?row.formats.join(' / '):text(row.formats)}</td><td><button type="button" className={styles.button} onClick={()=>exportReport(text(row.code))}>EXPORT CSV</button></td></tr>)}</tbody></table></div></div></>;
  }

  function renderNotifications() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="Notifications & Communications" subtitle="Manage in-portal, SMS, email and push communication queues." /><div className={styles.card}><form method="post" onSubmit={createNotification}><div className={styles.fields}><Field label="Audience"><select name="audience" className={styles.select}><option value="ALL_ACTIVE_MEMBERS">All Active Members</option><option value="SEASON_MEMBERS">Season Members</option><option value="AGENTS">Agents</option><option value="ADMINS">Admins</option></select></Field><Field label="Channel"><select name="channel" className={styles.select}><option value="PORTAL">In-Portal</option><option value="SMS">SMS</option><option value="EMAIL">Email</option><option value="PUSH">Push</option></select></Field><Field label="Title" full><input name="title" className={styles.input} required /></Field><Field label="Message" full><textarea name="message" className={styles.textarea} required /></Field><Field label="Schedule (optional)"><input name="scheduledAt" className={styles.input} type="datetime-local" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE DRAFT</button></div></form></div><div className={styles.card}><SectionHead icon="◉" title="Communication Register" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>TITLE</th><th>AUDIENCE</th><th>CHANNEL</th><th>STATUS</th><th>SCHEDULE</th><th>ACTION</th></tr></thead><tbody>{rows.map((row)=><tr key={text(row.id)}><td>{text(row.title)}</td><td>{text(row.audience)}</td><td>{text(row.channel)}</td><td>{text(row.status)}</td><td>{text(row.scheduledAt)}</td><td>{text(row.status)==='DRAFT'?<button type="button" className={classNames(styles.button,styles.dark)} onClick={()=>void act(()=>apiJson(`${API}/notifications/${encodeURIComponent(text(row.id))}/send`,{method:'POST',body:JSON.stringify({scheduledAt:row.scheduledAt||undefined})}),'Notification queued / published')}>SEND / SCHEDULE</button>:'—'}</td></tr>)}</tbody></table></div>:<Empty />}</div></>;
  }

  function renderSupport() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    return <><Hero title="Support & Help Centre" subtitle="Tickets, escalation, complaint tracking and operational support." /><div className={styles.card}><form method="post" onSubmit={createSupport}><div className={styles.fields}><Field label="Member / User ID"><input name="memberReference" className={styles.input} /></Field><Field label="Category"><select name="category" className={styles.select}><option>Payment</option><option>E-PIN</option><option>Binary Placement</option><option>Lucky Draw</option><option>Account</option></select></Field><Field label="Priority"><select name="priority" className={styles.select}><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></Field><Field label="Contact"><input name="contact" className={styles.input} /></Field><Field label="Issue Description" full><textarea name="description" className={styles.textarea} required /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>CREATE SUPPORT TICKET</button></div></form></div><div className={styles.card}><SectionHead icon="?" title="Ticket Register" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>TICKET</th><th>MEMBER</th><th>CATEGORY</th><th>PRIORITY</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row)=><tr key={text(row.id)}><td>{text(row.ticketNumber)}</td><td>{text(row.memberUsername,row.memberReference?text(row.memberReference):'—')}</td><td>{text(row.category)}</td><td>{text(row.priority)}</td><td>{text(row.status)}</td><td>{!['RESOLVED','CLOSED'].includes(text(row.status))?<button type="button" className={classNames(styles.button,styles.green)} onClick={()=>void act(()=>apiJson(`${API}/support/${encodeURIComponent(text(row.id))}`,{method:'PATCH',body:JSON.stringify({status:'RESOLVED'})}),'Ticket resolved')}>RESOLVE</button>:'—'}</td></tr>)}</tbody></table></div>:<Empty />}</div></>;
  }

  function renderSettings() {
    const row = (data ?? {}) as Row;
    return <><Hero title="Settings & Governance" subtitle="Portal identity, language and governance preferences." /><div className={styles.card}><form key={text(row.updatedAt,'settings')} method="post" onSubmit={saveSettings}><div className={styles.fields}><Field label="Company Name"><input name="companyName" className={styles.input} required defaultValue={text(row.companyName,'MegaGoldenClub')} /></Field><Field label="Portal Time Zone"><select name="timezone" className={styles.select} defaultValue={text(row.timezone,'Asia/Kolkata')}><option>Asia/Kolkata</option></select></Field><Field label="Currency"><select name="currencyCode" className={styles.select} defaultValue={text(row.currencyCode,'INR')}><option value="INR">INR • ₹</option></select></Field><Field label="Default Language"><select name="defaultLanguage" className={styles.select} defaultValue={text(row.defaultLanguage,'English')}><option>English</option><option>Kannada</option><option>Hindi</option></select></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE SETTINGS</button><Link className={classNames(styles.button,styles.outline,styles.linkButton)} href="/business-plan">ADVANCED BUSINESS POLICIES</Link><Link className={classNames(styles.button,styles.outline,styles.linkButton)} href="/presentation">APPEARANCE</Link></div></form></div><div className={styles.card}><SectionHead icon="✓" title="Governance Checklist" /><div className={styles.notice}>Role-based access • audited authorization codes • immutable financial ledgers • data backup • payment reconciliation • winner verification • KYC • privacy/consent • complaint handling • controlled season activation.</div><div className={classNames(styles.notice,styles.warn)}>Daily cap and pair value are controlled by each Season, not duplicated here. This prevents conflicting business truth.</div></div></>;
  }

  async function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    await act(()=>apiJson(`${API}/members`,{method:'POST',body:JSON.stringify({fullName:formString(form,'fullName'),phone:formString(form,'phone')||undefined,email:formString(form,'email')||undefined,password:formString(form,'password'),dateOfBirth:formString(form,'dateOfBirth')||undefined,state:formString(form,'state')||undefined,city:formString(form,'city')||undefined,memberType:formString(form,'memberType'),sponsorReference:formString(form,'sponsorReference')||undefined,placement:formString(form,'placement'),placementReference:formString(form,'placementReference')||undefined,epin:formString(form,'epin')||undefined})}),'Member created and placed');
  }
  async function submitPlacement(event: FormEvent<HTMLFormElement>) {event.preventDefault();const form=new FormData(event.currentTarget);await act(()=>apiJson(`${API}/placements`,{method:'POST',body:JSON.stringify({memberReference:formString(form,'memberReference'),parentReference:formString(form,'parentReference'),side:formString(form,'side')})}),'Placement saved',false);}
  async function submitSeason(event: FormEvent<HTMLFormElement>) {event.preventDefault();const form=new FormData(event.currentTarget);const payload={code:formString(form,'code')||undefined,name:formString(form,'name'),description:formString(form,'description')||undefined,startDate:`${formString(form,'startDate')}T00:00:00.000Z`,endDate:formString(form,'endDate')?`${formString(form,'endDate')}T00:00:00.000Z`:undefined,monthlyEmi:formString(form,'monthlyEmi'),registrationFee:formString(form,'registrationFee'),totalMonths:formNumber(form,'totalMonths',21),drawDay:formNumber(form,'drawDay',25),dailyCap:formNumber(form,'dailyCap',5000),pairValue:formString(form,'pairValue'),directReferral:formString(form,'directReferral'),carryForward:formString(form,'carryForward')==='true',eligibilityCutoff:formString(form,'eligibilityCutoff')};const id=text(editingSeason?.id,'');await act(()=>apiJson(id?`${API}/seasons/${encodeURIComponent(id)}`:`${API}/seasons`,{method:id?'PUT':'POST',body:JSON.stringify(payload)}),id?'Season changes saved':'Season draft created');setEditingSeason(null);}
  function seasonActionButtons(row: Row) {const status=text(row.status);const id=text(row.id);const action=(target:string,label:string)=> <button type="button" className={classNames(styles.button,target==='ACTIVE'?styles.green:target==='CLOSED'?styles.red:styles.dark)} disabled={busy} onClick={()=>void act(()=>apiJson(`${API}/seasons/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status:target})}),`Season moved to ${target}`)}>{label}</button>;if(status==='DRAFT')return action('REVIEW','SEND TO REVIEW');if(status==='REVIEW')return <>{action('DRAFT','BACK TO DRAFT')}{action('ACTIVE','ACTIVATE')}</>;if(status==='ACTIVE')return <>{action('PAUSED','PAUSE')}{action('CLOSED','CLOSE')}</>;if(status==='PAUSED')return <>{action('ACTIVE','RESUME')}{action('CLOSED','CLOSE')}</>;if(status==='CLOSED')return action('ARCHIVED','ARCHIVE');return null;}
  async function submitDraw(event: FormEvent<HTMLFormElement>) {event.preventDefault();const form=new FormData(event.currentTarget);const seasonId=formString(form,'seasonId');const iso=(name:string)=>new Date(formString(form,name)).toISOString();await act(()=>apiJson(`${API}/seasons/${encodeURIComponent(seasonId)}/draws`,{method:'POST',body:JSON.stringify({monthNumber:formNumber(form,'monthNumber',1),entryWindowStart:iso('entryWindowStart'),entryWindowEnd:iso('entryWindowEnd'),drawAt:iso('drawAt')})}),'Monthly draw prepared');}
  async function openDraw(id:string){setSelectedDrawId(id);setBusy(true);try{const row=await apiJson<Row>(`${API}/draws/${encodeURIComponent(id)}`);setData(row);}catch(err){handleApiError(err);}finally{setBusy(false);}}
  async function drawAction(action:string,success:string){if(!selectedDrawId)return;const result=await act(()=>apiJson<Row>(`${API}/draws/${encodeURIComponent(selectedDrawId)}/${action}`,{method:'POST',body:'{}'}),success,false);if(result)setData(result);}
  async function verifyWinner(winnerId:string){if(!selectedDrawId)return;const result=await act(()=>apiJson<Row>(`${API}/draws/${encodeURIComponent(selectedDrawId)}/winners/${encodeURIComponent(winnerId)}/verify`,{method:'PATCH',body:JSON.stringify({eligibilityStatus:'PASS',identityStatus:'PASS',paymentStatus:'PASS'})}),'Winner verified',false);if(result)setData(result);}
  async function approveDraw(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selectedDrawId)return;const form=new FormData(event.currentTarget);const result=await act(()=>apiJson<Row>(`${API}/draws/${encodeURIComponent(selectedDrawId)}/approve`,{method:'POST',body:JSON.stringify({approvalReference:formString(form,'approvalReference'),approvalNote:formString(form,'approvalNote')||undefined,authorizationCode:formString(form,'authorizationCode')||undefined})}),'Winners approved',false);if(result)setData(result);}
  async function changePrizeSeason(id:string){setSelectedSeasonId(id);if(!id){setPrizeDraft([]);return;}setBusy(true);try{const rows=await apiJson<Row[]>(`${API}/seasons/${encodeURIComponent(id)}/prizes`);setPrizeDraft(rows.map(prizeFromRow));}catch(err){handleApiError(err);}finally{setBusy(false);}}
  function updatePrize(index:number,key:keyof PrizeDraft,value:string|number){setPrizeDraft((current)=>current.map((item,i)=>i===index?{...item,[key]:value}:item));}
  async function savePrizes(){if(!selectedSeasonId)return;await act(()=>apiJson(`${API}/seasons/${encodeURIComponent(selectedSeasonId)}/prizes`,{method:'PUT',body:JSON.stringify({prizes:prizeDraft})}),'Prize schedule saved',false);}
  async function submitPayment(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await act(()=>apiJson(`${API}/payments`,{method:'POST',body:JSON.stringify({memberReference:formString(form,'memberReference'),amount:formString(form,'amount'),paymentType:formString(form,'paymentType'),paymentMode:formString(form,'paymentMode'),transactionReference:formString(form,'transactionReference')||undefined,authorizationCode:formString(form,'authorizationCode')})}),'Payment recorded');}
  async function lookupWallet(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);try{const row=await apiJson<Row>(`${API}/wallet?member=${encodeURIComponent(formString(form,'member'))}&currency=${encodeURIComponent(formString(form,'currency')||'INR')}`);setWallet(row);setNotice('Wallet loaded');}catch(err){handleApiError(err);}finally{setBusy(false);}}
  async function generateEpins(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);const expires=formString(form,'expiresAt');const result=await act(()=>apiJson<{generated:Array<{pin:string}>}>(`${API}/epins`,{method:'POST',body:JSON.stringify({seasonId:formString(form,'seasonId')||undefined,quantity:formNumber(form,'quantity',1),assignUserReference:formString(form,'assignUserReference')||undefined,expiresAt:new Date(expires).toISOString()})}),'E-PIN batch generated');if(result)setGeneratedSecrets(result.generated.map((item)=>item.pin));}
  async function generateAuthCode(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);const result=await act(()=>apiJson<{code:string}>(`${API}/auth-codes`,{method:'POST',body:JSON.stringify({roleScope:formString(form,'roleScope'),purpose:formString(form,'purpose'),validityMinutes:formNumber(form,'validityMinutes',30)})}),'Authorization code generated');if(result)setGeneratedSecrets([result.code]);}
  async function createNotification(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);const schedule=formString(form,'scheduledAt');await act(()=>apiJson(`${API}/notifications`,{method:'POST',body:JSON.stringify({audience:formString(form,'audience'),channel:formString(form,'channel'),title:formString(form,'title'),message:formString(form,'message'),scheduledAt:schedule?new Date(schedule).toISOString():undefined})}),'Notification draft saved');}
  async function createSupport(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await act(()=>apiJson(`${API}/support`,{method:'POST',body:JSON.stringify({memberReference:formString(form,'memberReference')||undefined,category:formString(form,'category'),priority:formString(form,'priority'),contact:formString(form,'contact')||undefined,description:formString(form,'description')})}),'Support ticket created');}
  async function saveSettings(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await act(()=>apiJson(`${API}/settings`,{method:'PUT',body:JSON.stringify({companyName:formString(form,'companyName'),timezone:formString(form,'timezone'),currencyCode:formString(form,'currencyCode'),defaultLanguage:formString(form,'defaultLanguage')})}),'Settings saved');}
  async function exportReport(code:string){let rows:Row[]=[];if(code==='MEMBERS')rows=await apiJson<Row[]>(`${API}/members`);else if(code==='BINARY')rows=await apiJson<Row[]>(`${API}/pair-ledger?limit=500`);else if(code==='WINNERS')rows=await apiJson<Row[]>(`${API}/draws`);else if(code==='AUDIT')rows=await apiJson<Row[]>(`${API}/activity?limit=200`);else {setNotice(`${code} report uses the live finance register; open the relevant management screen for transaction-level export.`);return;}exportCsv(rows,`${code.toLowerCase()}-report.csv`);}
}

function NavLink({ item, current, onClick }: { item: NavItem; current: Section; onClick?: () => void }) {
  return <Link className={classNames(styles.navItem, current === item.section && styles.activeNav)} href={href(item.section)} onClick={onClick}><span>{item.symbol}</span><span>{item.label}</span></Link>;
}
function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {return <div className={styles.kpi}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>;}
function Quick({ href: path, label, dark, green, outline }: { href: string; label: string; dark?: boolean; green?: boolean; outline?: boolean }) {return <Link href={path} className={classNames(styles.button,styles.linkButton,dark&&styles.dark,green&&styles.green,outline&&styles.outline)}>{label}</Link>;}
function IncomeCards({ season, compact = false }: { season: Row; compact?: boolean }) {
  const items=[['Direct Referral',money(season.directReferral),'Per qualifying direct referral'],['Binary Pair',money(season.pairValue),'AC + BD = 1 qualifying 2:2 pair'],['Daily Performance',`${money(season.dailyCap)} Cap`,'Configured daily maximum'],['Rank Achievement','Variable','Rule to be approved by owner'],['Leadership','Variable','Rule to be approved by owner'],['Monthly Lucky Draw','Prize Based','Monthwise prize schedule'],['Recognition Reward','Variable','Rule to be approved by owner'],['Retail Sales Commission','Variable','Rule to be approved by owner'],['Community Pool Reward','Variable','Rule to be approved by owner']];
  return <div className={styles.income}>{items.slice(0,compact?6:9).map((item,index)=><div className={styles.incomeItem} key={item[0]}><span className={styles.incomeNumber}>{index+1}</span><b>{item[0]}</b><strong>{item[1]}</strong><span>{item[2]}</span></div>)}</div>;
}
function DrawRunTable({ rows, onOpen }: { rows: Row[]; onOpen: (id:string)=>void }) {return <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>SEASON</th><th>MONTH</th><th>DRAW DATE</th><th>ELIGIBLE</th><th>WINNERS</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row)=><tr key={text(row.id)}><td>{text(row.seasonName)}</td><td>{text(row.monthNumber)}</td><td>{text(row.drawAt).replace('T',' ').slice(0,16)}</td><td>{text(row.eligibleEntryCount,'0')}</td><td>{text(row.winnerCount,'0')}</td><td><span className={styles.tag}>{text(row.status)}</span></td><td><button type="button" className={classNames(styles.button,styles.outline)} onClick={()=>onOpen(text(row.id))}>OPEN</button></td></tr>)}</tbody></table></div>;}
function prizeFromRow(row:Row):PrizeDraft{return{monthNumber:number(row.monthNumber,1),prizeCode:text(row.prizeCode,'PRIZE'),category:text(row.category,'Prize'),name:text(row.name,'Prize'),description:text(row.description,''),winnerCount:number(row.winnerCount,1),...(row.nominalValue?{nominalValue:text(row.nominalValue)}:{})};}
function exportCsv(rows:Row[],filename:string){if(!rows.length)return;const keys=[...new Set(rows.flatMap((row)=>Object.keys(row).filter((key)=>{const value=row[key];return value===null||['string','number','boolean'].includes(typeof value);})))];const escape=(value:unknown)=>`"${text(value,'').replaceAll('"','""')}"`;const csv=[keys.map(escape).join(','),...rows.map((row)=>keys.map((key)=>escape(row[key])).join(','))].join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);}
