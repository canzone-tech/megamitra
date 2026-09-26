'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import styles from './owner-portal.module.css';

export type OwnerCoreSection =
  | 'dashboard'
  | 'income'
  | 'members'
  | 'binary'
  | 'placement'
  | 'seasons'
  | 'draw'
  | 'winners'
  | 'prizes';

type Section = OwnerCoreSection
  | 'payments'
  | 'wallet'
  | 'epins'
  | 'auth-codes'
  | 'reports'
  | 'notifications'
  | 'support'
  | 'settings';
type Row = Record<string, unknown>;
type Settings = { companyName?: string; currencyCode?: string; timezone?: string; defaultLanguage?: string };
type RegistrationPolicy = {
  emailRequired?: boolean;
  mobileRequired?: boolean;
  passwordMode?: string;
  usernameMode?: string;
  usernamePrefixEnabled?: boolean;
  usernamePrefix?: string | null;
  defaultRoleName?: string;
};
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
const CORE_API = `${API}/core`;
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
const TITLES: Record<OwnerCoreSection, string> = {
  dashboard: 'Dashboard',
  income: '9 Income Types',
  members: 'Members',
  binary: 'Binary 2:2 • AB : CD',
  placement: 'Placement / Pairing',
  seasons: 'Season Management',
  draw: 'Monthly Draw',
  winners: 'Winners',
  prizes: 'Prize Catalogue',
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
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(number(value));
  } catch {
    return `${code} ${number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}
function dateValue(value: unknown) {
  const raw = text(value, '');
  return raw ? raw.slice(0, 10) : '';
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
function SectionHead({ icon, title, note, action }: { icon: string; title: string; note?: string; action?: ReactNode }) {
  return <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>{icon}</span><h2>{title}</h2></div>{action ?? (note ? <small>{note}</small> : null)}</div>;
}
function Empty({ children = 'No records yet.' }: { children?: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
function Kpi({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return <div className={styles.kpi}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>;
}
function Quick({ href: path, label, dark, green, outline }: { href: string; label: string; dark?: boolean; green?: boolean; outline?: boolean }) {
  return <Link href={path} className={classNames(styles.button, styles.linkButton, dark && styles.dark, green && styles.green, outline && styles.outline)}>{label}</Link>;
}

export function OwnerCorePortal({ section }: { section: OwnerCoreSection }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({});
  const [registrationPolicy, setRegistrationPolicy] = useState<RegistrationPolicy>({});
  const [data, setData] = useState<unknown>(null);
  const [aux, setAux] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileMore, setMobileMore] = useState(false);
  const [editingSeason, setEditingSeason] = useState<Row | null>(null);
  const [duplicatePrizes, setDuplicatePrizes] = useState<PrizeDraft[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [prizeDraft, setPrizeDraft] = useState<PrizeDraft[]>([]);
  const [drawPrizes, setDrawPrizes] = useState<Row[]>([]);
  const [selectedDrawId, setSelectedDrawId] = useState('');
  const [selectedDraw, setSelectedDraw] = useState<Row | null>(null);
  const [generatedMemberPassword, setGeneratedMemberPassword] = useState('');

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
      setSettings(portalSettings);

      if (section === 'dashboard') {
        setData(await apiJson<Row>(`${API}/dashboard`));
        setAux(null);
      } else if (section === 'income' || section === 'seasons') {
        setData(await apiJson<Row[]>(`${API}/seasons`));
        setAux(null);
      } else if (section === 'members') {
        const [members, policy] = await Promise.all([
          apiJson<Row[]>(`${CORE_API}/members`),
          apiJson<RegistrationPolicy>(`${CORE_API}/registration-policy`),
        ]);
        setData(members);
        setRegistrationPolicy(policy);
        setAux(null);
      } else if (section === 'binary') {
        const [pairs, seasons] = await Promise.all([
          apiJson<Row[]>(`${CORE_API}/pair-ledger`),
          apiJson<Row[]>(`${API}/seasons`),
        ]);
        setData(pairs);
        setAux(seasons);
      } else if (section === 'placement') {
        setData(await apiJson<Row[]>(`${API}/seasons`));
        setAux(null);
      } else if (section === 'draw') {
        const [seasons, runs] = await Promise.all([
          apiJson<Row[]>(`${API}/seasons`),
          apiJson<Row[]>(`${API}/draws`),
        ]);
        setData(seasons);
        setAux(runs);
        const active = seasons.find((row) => text(row.status) === 'ACTIVE');
        setDrawPrizes(active ? await apiJson<Row[]>(`${API}/seasons/${encodeURIComponent(text(active.id))}/prizes`) : []);
      } else if (section === 'winners') {
        const runs = await apiJson<Row[]>(`${API}/draws`);
        setAux(runs);
        if (selectedDrawId) setSelectedDraw(await apiJson<Row>(`${API}/draws/${encodeURIComponent(selectedDrawId)}`));
        else setSelectedDraw(null);
      } else if (section === 'prizes') {
        const seasons = await apiJson<Row[]>(`${API}/seasons`);
        setData(seasons);
        const preferred = selectedSeasonId || text(seasons.find((row) => text(row.status) === 'ACTIVE')?.id, '') || text(seasons[0]?.id, '');
        if (preferred) {
          if (preferred !== selectedSeasonId) setSelectedSeasonId(preferred);
          setPrizeDraft((await apiJson<Row[]>(`${API}/seasons/${encodeURIComponent(preferred)}/prizes`)).map(prizeFromRow));
        } else {
          setPrizeDraft([]);
        }
      }
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, section, selectedDrawId, selectedSeasonId]);

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

  async function run<T>(work: () => Promise<T>, success: string, reload = true): Promise<T | null> {
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

  async function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setGeneratedMemberPassword('');
    const result = await run(() => apiJson<Row>(`${CORE_API}/members`, {
      method: 'POST',
      body: JSON.stringify({
        username: formString(form, 'username') || undefined,
        fullName: formString(form, 'fullName'),
        phone: formString(form, 'phone') || undefined,
        email: formString(form, 'email') || undefined,
        password: formString(form, 'password') || undefined,
        dateOfBirth: formString(form, 'dateOfBirth') || undefined,
        state: formString(form, 'state') || undefined,
        city: formString(form, 'city') || undefined,
        memberType: formString(form, 'memberType'),
        sponsorReference: formString(form, 'sponsorReference') || undefined,
        placement: formString(form, 'placement'),
        placementReference: formString(form, 'placementReference') || undefined,
        epin: formString(form, 'epin') || undefined,
      }),
    }), 'Member created and placed');
    if (result && result.initialPassword) setGeneratedMemberPassword(text(result.initialPassword, ''));
    if (result) event.currentTarget.reset();
  }

  async function submitPlacement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(() => apiJson(`${API}/placements`, {
      method: 'POST',
      body: JSON.stringify({
        memberReference: formString(form, 'memberReference'),
        parentReference: formString(form, 'parentReference'),
        side: formString(form, 'side'),
      }),
    }), 'Placement saved', false);
  }

  async function submitSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const duplicate = Boolean(editingSeason?.__duplicate);
    const id = duplicate ? '' : text(editingSeason?.id, '');
    const payload = {
      code: formString(form, 'code') || undefined,
      name: formString(form, 'name'),
      description: formString(form, 'description') || undefined,
      startDate: `${formString(form, 'startDate')}T00:00:00.000Z`,
      endDate: formString(form, 'endDate') ? `${formString(form, 'endDate')}T00:00:00.000Z` : undefined,
      monthlyEmi: formString(form, 'monthlyEmi'),
      registrationFee: formString(form, 'registrationFee'),
      totalMonths: formNumber(form, 'totalMonths', 21),
      drawDay: formNumber(form, 'drawDay', 25),
      dailyCap: formNumber(form, 'dailyCap', 5000),
      pairValue: formString(form, 'pairValue'),
      directReferral: formString(form, 'directReferral'),
      carryForward: formString(form, 'carryForward') === 'true',
      eligibilityCutoff: formString(form, 'eligibilityCutoff'),
      ...(duplicate && duplicatePrizes.length ? { prizes: duplicatePrizes } : {}),
    };
    await run(() => apiJson(id ? `${API}/seasons/${encodeURIComponent(id)}` : `${API}/seasons`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    }), id ? 'Season changes saved' : duplicate ? 'Duplicate season draft created with prize schedule' : 'Season draft created');
    setEditingSeason(null);
    setDuplicatePrizes([]);
  }

  async function beginDuplicate(row: Row) {
    setBusy(true);
    setError('');
    try {
      const prizes = await apiJson<Row[]>(`${API}/seasons/${encodeURIComponent(text(row.id))}/prizes`);
      setDuplicatePrizes(prizes.map(prizeFromRow));
      setEditingSeason({ ...row, id: '', code: '', name: `${text(row.name)} Copy`, status: 'DRAFT', __duplicate: true });
      setNotice('Season configuration and prize schedule copied into a new draft form. Review dates and save when ready.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  }

  function seasonActionButtons(row: Row) {
    const status = text(row.status);
    const id = text(row.id);
    const action = (target: string, label: string) => <button type="button" className={classNames(styles.button, target === 'ACTIVE' ? styles.green : target === 'CLOSED' ? styles.red : styles.dark)} disabled={busy} onClick={() => void run(() => apiJson(`${API}/seasons/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: target }) }), `Season moved to ${target}`)}>{label}</button>;
    if (status === 'DRAFT') return action('REVIEW', 'SEND TO REVIEW');
    if (status === 'REVIEW') return <>{action('DRAFT', 'BACK TO DRAFT')}{action('ACTIVE', 'ACTIVATE')}</>;
    if (status === 'ACTIVE') return <>{action('PAUSED', 'PAUSE')}{action('CLOSED', 'CLOSE')}</>;
    if (status === 'PAUSED') return <>{action('ACTIVE', 'RESUME')}{action('CLOSED', 'CLOSE')}</>;
    if (status === 'CLOSED') return action('ARCHIVED', 'ARCHIVE');
    return null;
  }

  async function submitDraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const seasonId = formString(form, 'seasonId');
    const iso = (name: string) => new Date(formString(form, name)).toISOString();
    await run(() => apiJson(`${API}/seasons/${encodeURIComponent(seasonId)}/draws`, {
      method: 'POST',
      body: JSON.stringify({
        monthNumber: formNumber(form, 'monthNumber', 1),
        entryWindowStart: iso('entryWindowStart'),
        entryWindowEnd: iso('entryWindowEnd'),
        drawAt: iso('drawAt'),
        claimWindowDays: formNumber(form, 'claimWindowDays'),
      }),
    }), 'Monthly draw prepared');
  }

  async function openDraw(id: string) {
    setSelectedDrawId(id);
    setBusy(true);
    setError('');
    try {
      setSelectedDraw(await apiJson<Row>(`${API}/draws/${encodeURIComponent(id)}`));
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  }

  async function drawAction(action: string, success: string) {
    if (!selectedDrawId) return;
    await run(() => apiJson(`${API}/draws/${encodeURIComponent(selectedDrawId)}/${action}`, { method: 'POST', body: '{}' }), success);
  }

  async function verifyWinner(winnerId: string) {
    if (!selectedDrawId) return;
    await run(() => apiJson(`${API}/draws/${encodeURIComponent(selectedDrawId)}/winners/${encodeURIComponent(winnerId)}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ eligibilityStatus: 'PASS', identityStatus: 'PASS', paymentStatus: 'PASS' }),
    }), 'Winner verified');
  }

  async function approveDraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDrawId) return;
    const form = new FormData(event.currentTarget);
    await run(() => apiJson(`${API}/draws/${encodeURIComponent(selectedDrawId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        approvalReference: formString(form, 'approvalReference'),
        approvalNote: formString(form, 'approvalNote') || undefined,
        authorizationCode: formString(form, 'authorizationCode') || undefined,
      }),
    }), 'Verified winners approved');
  }

  async function claimWinner(winnerId: string) {
    if (!selectedDrawId) return;
    await run(() => apiJson(`${API}/draws/${encodeURIComponent(selectedDrawId)}/winners/${encodeURIComponent(winnerId)}/claim`, { method: 'POST', body: '{}' }), 'Winner claim started');
  }

  async function fulfillWinner(event: FormEvent<HTMLFormElement>, winnerId: string) {
    event.preventDefault();
    if (!selectedDrawId) return;
    const form = new FormData(event.currentTarget);
    await run(() => apiJson(`${API}/draws/${encodeURIComponent(selectedDrawId)}/winners/${encodeURIComponent(winnerId)}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({ externalReference: formString(form, 'externalReference'), note: formString(form, 'note') || undefined }),
    }), 'Prize marked fulfilled');
  }

  async function changePrizeSeason(id: string) {
    setSelectedSeasonId(id);
    if (!id) {
      setPrizeDraft([]);
      return;
    }
    setBusy(true);
    try {
      setPrizeDraft((await apiJson<Row[]>(`${API}/seasons/${encodeURIComponent(id)}/prizes`)).map(prizeFromRow));
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  }

  function addPrize() {
    const nextMonth = Math.min(60, Math.max(0, ...prizeDraft.map((item) => item.monthNumber)) + 1);
    setPrizeDraft((current) => [...current, { monthNumber: nextMonth || 1, prizeCode: `PRIZE_${Date.now()}`, category: 'Prize', name: 'New Prize', winnerCount: 1 }]);
  }
  function updatePrize(index: number, key: keyof PrizeDraft, value: string | number) {
    setPrizeDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }
  function removePrize(index: number) {
    setPrizeDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }
  async function savePrizes() {
    if (!selectedSeasonId) return;
    await run(() => apiJson(`${API}/seasons/${encodeURIComponent(selectedSeasonId)}/prizes`, {
      method: 'PUT',
      body: JSON.stringify({ prizes: prizeDraft }),
    }), 'Prize schedule saved');
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
          {section === 'dashboard' ? renderDashboard() : section === 'income' ? renderIncome() : section === 'members' ? renderMembers() : section === 'binary' ? renderBinary() : section === 'placement' ? renderPlacement() : section === 'seasons' ? renderSeasons() : section === 'draw' ? renderDraw() : section === 'winners' ? renderWinners() : renderPrizes()}
        </div>
      </main>
      <nav className={styles.bottom}>
        {(['dashboard', 'income', 'binary', 'seasons', 'draw'] as Section[]).map((key) => {
          const item = NAV.find((entry) => entry.section === key)!;
          return <Link key={key} className={section === key ? styles.activeBottom : ''} href={href(key)}><strong>{item.symbol}</strong>{key === 'dashboard' ? 'Home' : item.label.split(' ')[0]}</Link>;
        })}
        <button type="button" onClick={() => setMobileMore(true)} className={mobileMore ? styles.activeBottom : ''}><strong>☰</strong>More</button>
      </nav>
      {mobileMore ? <><div className={styles.drawerBackdrop} onClick={() => setMobileMore(false)} /><div className={styles.mobileMore}><div className={styles.drawerHead}><b>All management tools</b><button type="button" onClick={() => setMobileMore(false)}>×</button></div>{NAV.map((item) => <Link key={item.section} className={classNames(styles.navItem, section === item.section && styles.activeNav)} href={href(item.section)} onClick={() => setMobileMore(false)}><span>{item.symbol}</span><span>{item.label}</span></Link>)}<button className={classNames(styles.button, styles.dark)} type="button" onClick={logout}>LOG OUT</button></div></> : null}
    </div>
  );

  function renderDashboard() {
    const row = (data ?? {}) as Row;
    const active = (row.activeSeason && typeof row.activeSeason === 'object' ? row.activeSeason : {}) as Row;
    const code = text(active.currencyCode, currencyCode);
    return <><Hero title="MegaGoldenClub Management Dashboard" subtitle="Central control for seasons, members, Binary 2:2 AB : CD, payments, monthly draws and reporting." pill="LIVE MANAGEMENT ENVIRONMENT" />
      <div className={styles.kpis}><Kpi label="Active Season" value={text(active.name, 'No active season')} note={text(active.status, 'Create or activate a season')} /><Kpi label="Members" value={number(row.memberCount).toLocaleString('en-IN')} note="Registered accounts" /><Kpi label="Qualified Pairs" value={number(row.qualifiedPairs).toLocaleString('en-IN')} note="AC + BD matching" /><Kpi label="Daily Cap" value={money(row.dailyCap, code)} note="Current season rule" /></div>
      <div className={styles.grid2}><div><div className={styles.card}><SectionHead icon="↗" title="Activity Overview" note="Live operational snapshot" /><div className={styles.summary}><div><small>OPEN SUPPORT</small><b>{number(row.openTickets)}</b></div><div><small>NOTICES WAITING</small><b>{number(row.pendingNotifications)}</b></div><div><small>SEASON STATUS</small><b>{text(active.status)}</b></div><div><small>DRAW DAY</small><b>{active.drawDay ? `${text(active.drawDay)}th` : '—'}</b></div></div></div><div className={styles.card}><SectionHead icon="↗" title="9 Income / Reward Types" note="Read-only business-plan overview" /><IncomeCards season={active} currencyCode={code} compact /></div></div><div><div className={styles.card}><SectionHead icon="⚡" title="Quick Actions" /><div className={styles.quick}><Quick href="/portal/seasons" label="+ CREATE SEASON" /><Quick href="/portal/members" label="+ ADD MEMBER" dark /><Quick href="/portal/draw" label="MANAGE DRAW" green /><Quick href="/portal/reports" label="VIEW REPORTS" outline /></div></div><div className={styles.card}><SectionHead icon="i" title="Current Configuration" /><div className={styles.notice}><b>Joining:</b> {money(number(active.registrationFee) + number(active.installmentAmount), code)} = {money(active.installmentAmount, code)} monthly EMI + {money(active.registrationFee, code)} registration.</div><div className={classNames(styles.notice, styles.warn)}>Income / Reward Types are informational. Editable financial truth lives in the versioned Season, Binary, Referral and Draw policies.</div></div></div></div></>;
  }

  function renderIncome() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const active = seasons.find((row) => ['ACTIVE', 'PAUSED'].includes(text(row.status, ''))) ?? seasons[0] ?? {};
    const code = text(active.currencyCode, currencyCode);
    return <><Hero title="9 Income / Reward Types" subtitle="Read-only overview from the supplied business-plan reference." pill="INFORMATIONAL • NOT AN EDITOR" /><div className={styles.card}><IncomeCards season={active} currencyCode={code} /></div><div className={styles.card}><SectionHead icon="=" title="Core Calculation" /><div className={styles.notice}><b>Direct Referral:</b> {money(active.directReferral, code)} per qualifying direct referral. <b>Binary Pair:</b> AC + BD = one qualifying 2:2 pair at {money(active.pairValue, code)}. <b>Daily cap:</b> {money(active.dailyCap, code)} for the selected/active season.</div><div className={classNames(styles.notice, styles.warn)}>The client source does not define formulas for Rank Achievement, Leadership, Recognition Reward, Retail Sales Commission or Community Pool Reward, so this screen does not invent editable rules for them.</div></div></>;
  }

  function renderMembers() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    const usernameMode = text(registrationPolicy.usernameMode, 'AUTO_OR_MANUAL');
    const passwordMode = text(registrationPolicy.passwordMode, 'MANUAL');
    const usernameRequired = usernameMode === 'MANUAL';
    const passwordRequired = passwordMode === 'MANUAL';
    return <><Hero title="Member Management" subtitle="Registration, sponsor validation, placement, profile, KYC and account status." />
      <div className={styles.card}><SectionHead icon="+" title="Create Member" action={<Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/kyc">KYC POLICY / REVIEW</Link>} /><div className={styles.notice}>Registration policy: username <b>{usernameMode}</b> • password <b>{passwordMode}</b> • default role <b>{text(registrationPolicy.defaultRoleName, 'MEMBER')}</b>. Required email/mobile fields follow Security → Registration Policy.</div><form method="post" onSubmit={submitMember}><div className={styles.fields}><Field label="Sponsor ID / Auto Sponsor" full><input name="sponsorReference" className={styles.input} placeholder="Sponsor ID, mobile or email" /></Field><Field label="E-PIN"><input name="epin" className={styles.input} placeholder="Optional E-PIN" /></Field><Field label="Placement"><select name="placement" className={styles.select} defaultValue="AUTO"><option value="AUTO">Auto Placement</option><option value="LEFT">AB • Left</option><option value="RIGHT">CD • Right</option></select></Field><Field label="Username"><input name="username" className={styles.input} required={usernameRequired} placeholder={usernameMode === 'AUTO' ? 'Generated by system' : 'Optional when AUTO_OR_MANUAL'} /></Field><Field label="Full Name"><input name="fullName" className={styles.input} required placeholder="Full name" /></Field><Field label="Mobile"><input name="phone" className={styles.input} required={Boolean(registrationPolicy.mobileRequired)} placeholder="+91" /></Field><Field label="Email"><input name="email" className={styles.input} type="email" required={Boolean(registrationPolicy.emailRequired)} placeholder="Email" /></Field><Field label="Date of Birth"><input name="dateOfBirth" className={styles.input} type="date" /></Field><Field label="State"><input name="state" className={styles.input} /></Field><Field label="City"><input name="city" className={styles.input} /></Field><Field label="Password"><input name="password" className={styles.input} type="password" required={passwordRequired} placeholder={passwordMode === 'AUTO' ? 'Generated by system' : passwordMode === 'AUTO_OR_MANUAL' ? 'Leave blank for system-generated password' : 'Required by policy'} /></Field><Field label="Member Type"><select name="memberType" className={styles.select}><option value="PARTNER">Partner</option><option value="CUSTOMER">Customer</option></select></Field><Field label="Placement Reference"><input name="placementReference" className={styles.input} placeholder="Defaults to sponsor" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SUBMIT REGISTRATION</button><button className={classNames(styles.button, styles.dark)} type="reset">RESET</button></div></form>{generatedMemberPassword ? <div className={classNames(styles.notice, styles.success)}>One-time generated password: <b>{generatedMemberPassword}</b>. Copy it now and provide it through the approved onboarding channel.</div> : null}</div>
      <div className={styles.card}><SectionHead icon="●" title="Member Directory" note={`${rows.length} recent records`} />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>USER ID</th><th>NAME</th><th>SPONSOR</th><th>POSITION</th><th>SEASON</th><th>KYC</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.username)}</td><td>{[text(row.firstName, ''), text(row.lastName, '')].filter(Boolean).join(' ') || '—'}</td><td>{text(row.sponsorUsername)}</td><td>{row.placementSide ? `${text(row.placementSide)} • ${text(row.placementParentUsername)}` : 'Pending'}</td><td>{text(row.seasonName, 'Not enrolled')}</td><td><span className={styles.tag}>{text(row.kycStatus, 'NOT_STARTED')}</span></td><td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td><td><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/kyc">VIEW</Link></td></tr>)}</tbody></table></div> : <Empty />}</div></>;
  }

  function renderBinary() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    const seasons = (Array.isArray(aux) ? aux : []) as Row[];
    const active = seasons.find((row) => ['ACTIVE', 'PAUSED'].includes(text(row.status, ''))) ?? seasons[0] ?? {};
    const code = text(active.currencyCode, currencyCode);
    return <><Hero title="Binary 2:2 • AB : CD" subtitle="Two-position binary structure with AB as left and CD as right." pill="AB : CD = 2 : 2" /><div className={styles.card}><SectionHead icon="◇" title="Binary Structure" /><div className={styles.binaryBox}><div className={styles.binaryRow}><div className={classNames(styles.node, styles.root)}><b>YOU</b><span>Reference member</span></div></div><div className={styles.binaryRow}><div className={styles.node}><b>AB • LEFT</b><span>Left position</span></div><div className={styles.node}><b>CD • RIGHT</b><span>Right position</span></div></div><div className={styles.binaryRow}><div className={styles.node}><b>A</b><span>Left unit</span></div><div className={styles.node}><b>B</b><span>Left unit</span></div><div className={styles.node}><b>C</b><span>Right unit</span></div><div className={styles.node}><b>D</b><span>Right unit</span></div></div><div className={styles.pairBox}>AC + BD = 1 PAIR • PAIR VALUE = {money(active.pairValue, code)}</div></div></div><div className={styles.card}><SectionHead icon="⌁" title="Pair Ledger" note="Live qualified pair records" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>PAIR</th><th>MEMBER</th><th>LEFT / AB</th><th>RIGHT / CD</th><th>CROSS MATCH</th><th>VALUE</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.pairSequence)}</td><td>{text(row.username)}</td><td>{text(row.leftUnitId)}</td><td>{text(row.rightUnitId)}</td><td>{text(row.crossMatch, 'AC + BD')}</td><td>{money(row.payoutAmount, text(row.currencyCode, code))}</td><td className={row.payable ? styles.status : styles.statusOff}>{row.payable ? 'QUALIFIED' : 'CAP LIMITED'}</td></tr>)}</tbody></table></div> : <Empty>No pair records yet.</Empty>}</div></>;
  }

  function renderPlacement() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const active = seasons.find((row) => ['ACTIVE', 'PAUSED'].includes(text(row.status, ''))) ?? {};
    return <><Hero title="Placement & Pairing" subtitle="Control AB / CD placement while qualification and carry-forward remain policy-derived." /><div className={styles.card}><form method="post" onSubmit={submitPlacement}><div className={styles.fields}><Field label="Member ID"><input name="memberReference" className={styles.input} required placeholder="User ID / mobile / email" /></Field><Field label="Placement Side"><select name="side" className={styles.select}><option value="AUTO">Auto Placement</option><option value="LEFT">AB • LEFT</option><option value="RIGHT">CD • RIGHT</option></select></Field><Field label="Reference Member"><input name="parentReference" className={styles.input} required placeholder="Parent / reference member" /></Field><Field label="Pair Rule"><input className={styles.input} value="AC + BD" readOnly /></Field><Field label="Carry Forward"><input className={styles.input} value={active.carryForward ? 'Enabled by active season' : 'Disabled by active season'} readOnly /></Field><Field label="Qualification Status"><input className={styles.input} value="Derived from qualifying unit events" readOnly /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE PLACEMENT</button><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/portal/binary">RUN / VIEW PAIR CHECK</Link></div></form></div><div className={styles.card}><SectionHead icon="✓" title="Pairing Controls" /><div className={styles.notice}>Placement ancestry is persisted by the genealogy engine. Carry-forward is controlled by the active Season/Binary policy, and qualification is derived from immutable qualifying-unit and pair events rather than manually overridden per placement.</div></div></>;
  }

  function renderSeasons() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    const edit = editingSeason;
    const duplicate = Boolean(edit?.__duplicate);
    const code = text(edit?.currencyCode, currencyCode);
    return <><Hero title="Season Management" subtitle="Create, configure, activate, pause, close, archive and duplicate monthly reward seasons." pill="VERSIONED BUSINESS CONTROL" /><div className={styles.card}><SectionHead icon="□" title={duplicate ? `Duplicate ${text(edit?.name).replace(/ Copy$/, '')}` : edit ? `Edit ${text(edit.name)}` : 'Create New Season'} action={edit ? <button type="button" className={classNames(styles.button, styles.outline)} onClick={() => { setEditingSeason(null); setDuplicatePrizes([]); }}>CANCEL</button> : undefined} /><form key={`${text(edit?.id, 'new')}-${duplicate ? 'copy' : 'edit'}`} method="post" onSubmit={submitSeason}><div className={styles.fields}><Field label="Season Name"><input name="name" className={styles.input} required defaultValue={text(edit?.name, '') || 'New MegaGoldenClub Season'} /></Field><Field label="Season Code"><input name="code" className={styles.input} defaultValue={duplicate ? '' : text(edit?.code, '')} placeholder="Auto generated when blank" disabled={Boolean(edit && !duplicate)} /></Field><Field label="Monthly EMI"><input name="monthlyEmi" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.monthlyEmi, '1000')} /></Field><Field label="Registration Fee"><input name="registrationFee" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.registrationFee, '1000')} /></Field><Field label="Total Months"><input name="totalMonths" className={styles.input} type="number" min="1" max="60" required defaultValue={number(edit?.totalMonths, 21)} /></Field><Field label="Draw Day"><input name="drawDay" className={styles.input} type="number" min="1" max="31" required defaultValue={number(edit?.drawDay, 25)} /></Field><Field label="Start Date"><input name="startDate" className={styles.input} type="date" required defaultValue={dateValue(edit?.startDate) || new Date().toISOString().slice(0, 10)} /></Field><Field label="End Date"><input name="endDate" className={styles.input} type="date" defaultValue={dateValue(edit?.endDate)} /></Field><Field label="Daily Income Cap"><input name="dailyCap" className={styles.input} type="number" min="0" required defaultValue={number(edit?.dailyCap, 5000)} /></Field><Field label="Pair Value"><input name="pairValue" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.pairValue, '200')} /></Field><Field label="Direct Referral"><input name="directReferral" className={styles.input} inputMode="decimal" required defaultValue={text(edit?.directReferral, '250')} /></Field><Field label="Eligibility Cut-off"><select name="eligibilityCutoff" className={styles.select} defaultValue={text(edit?.eligibilityCutoff, 'BEFORE_DRAW_DATE')}><option value="BEFORE_DRAW_DATE">Before Draw Date</option><option value="PAYMENT_DUE_DATE">Payment Due Date</option><option value="ADMIN_DEFINED">Admin Defined</option></select></Field><Field label="Carry Forward"><select name="carryForward" className={styles.select} defaultValue={edit ? String(Boolean(edit.carryForward)) : 'true'}><option value="true">Enabled</option><option value="false">Disabled</option></select></Field><Field label="Season Description" full><textarea name="description" className={styles.textarea} defaultValue={text(edit?.description, '')} placeholder="Business description for this season" /></Field></div><div className={styles.summary}><div><small>JOINING</small><b>{money(number(edit?.monthlyEmi, 1000) + number(edit?.registrationFee, 1000), code)}</b></div><div><small>MONTHLY EMI</small><b>{money(edit?.monthlyEmi ?? 1000, code)}</b></div><div><small>PAIR</small><b>{money(edit?.pairValue ?? 200, code)}</b></div><div><small>DAILY CAP</small><b>{money(edit?.dailyCap ?? 5000, code)}</b></div></div>{duplicate ? <div className={styles.notice}>This creates a new DRAFT with the source season&apos;s business settings and {duplicatePrizes.length} prize record(s). Published history is not modified.</div> : null}<div className={styles.buttonLine}><button className={styles.button} disabled={busy}>{edit && !duplicate ? 'SAVE CHANGES' : duplicate ? 'CREATE DUPLICATE DRAFT' : 'CREATE SEASON'}</button><Link className={classNames(styles.button, styles.dark, styles.linkButton)} href="/portal/prizes">MANAGE PRIZE SCHEDULE</Link></div></form></div>
      <div className={styles.card}><SectionHead icon="≡" title="Season Register" note="Draft → Review → Active → Closed / Archived" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>SEASON</th><th>START</th><th>END</th><th>MONTHS</th><th>EMI</th><th>DRAW DAY</th><th>PAIR</th><th>CAP</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td><b>{text(row.name)}</b><br />{text(row.code)}</td><td>{dateValue(row.startDate)}</td><td>{dateValue(row.endDate) || '—'}</td><td>{text(row.totalMonths)}</td><td>{money(row.monthlyEmi, text(row.currencyCode, currencyCode))}</td><td>{text(row.drawDay)}th</td><td>{money(row.pairValue, text(row.currencyCode, currencyCode))}</td><td>{money(row.dailyCap, text(row.currencyCode, currencyCode))}</td><td className={['ACTIVE', 'REVIEW'].includes(text(row.status)) ? styles.status : text(row.status) === 'ARCHIVED' ? styles.statusOff : ''}>{text(row.status)}</td><td><div className={styles.buttonLine}><button type="button" className={classNames(styles.button, styles.outline)} onClick={() => { setEditingSeason(row); setDuplicatePrizes([]); }} disabled={!['DRAFT', 'REVIEW'].includes(text(row.status))}>EDIT</button><button type="button" className={classNames(styles.button, styles.outline)} onClick={() => void beginDuplicate(row)} disabled={busy}>DUPLICATE</button>{seasonActionButtons(row)}</div></td></tr>)}</tbody></table></div> : <Empty>Create the first season to begin.</Empty>}</div></>;
  }

  function renderDraw() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const runs = (Array.isArray(aux) ? aux : []) as Row[];
    const active = seasons.find((row) => text(row.status) === 'ACTIVE');
    const code = text(active?.currencyCode, currencyCode);
    return <><Hero title="Monthly Lucky Draw" subtitle="Monthwise schedule, eligibility, prize allocation and draw administration." /><div className={styles.card}><SectionHead icon="□" title="Active Season" /><div className={styles.fields}><Field label="Season"><input className={styles.input} readOnly value={text(active?.name, 'No active season')} /></Field><Field label="Monthly EMI"><input className={styles.input} readOnly value={money(active?.monthlyEmi, code)} /></Field><Field label="Draw Day"><input className={styles.input} readOnly value={active?.drawDay ? `${text(active.drawDay)}th of every month` : '—'} /></Field><Field label="Eligibility Cut-off"><input className={styles.input} readOnly value={text(active?.eligibilityCutoff)} /></Field></div></div>
      <div className={styles.card}><SectionHead icon="◆" title={`${number(active?.totalMonths, 21)}-Month Prize Schedule`} action={<button type="button" className={classNames(styles.button, styles.outline)} disabled={!drawPrizes.length} onClick={() => exportCsv(drawPrizes, `${text(active?.code, 'season').toLowerCase()}-prize-schedule.csv`)}>EXPORT SCHEDULE</button>} />{drawPrizes.length ? <div className={styles.months}>{drawPrizes.map((prize) => <div className={styles.month} key={text(prize.id, `${text(prize.monthNumber)}-${text(prize.prizeCode)}`)}><span className={styles.monthNo}>{text(prize.monthNumber)}</span><h3>MONTH {text(prize.monthNumber)}</h3><div className={styles.prizeVisual}>◆</div><b>{text(prize.name)}</b><span>{text(prize.category)} • {text(prize.winnerCount, '1')} winner(s)</span>{prize.nominalValue ? <strong>{money(prize.nominalValue, text(prize.currencyCode, code))}</strong> : null}</div>)}</div> : <Empty>Configure the active season prize schedule before preparing draws.</Empty>}</div>
      <div className={styles.card}><SectionHead icon="□" title="Prepare Monthly Draw" /><form method="post" onSubmit={submitDraw}><div className={styles.fields}><Field label="Season"><select name="seasonId" className={styles.select} required defaultValue={text(active?.id, '')}><option value="">Select active season</option>{seasons.filter((row) => text(row.status) === 'ACTIVE').map((row) => <option key={text(row.id)} value={text(row.id)}>{text(row.name)}</option>)}</select></Field><Field label="Draw Month"><input name="monthNumber" className={styles.input} type="number" min="1" max="60" defaultValue="1" required /></Field><Field label="Entry Window Start"><input name="entryWindowStart" className={styles.input} type="datetime-local" required /></Field><Field label="Eligibility Cut-off"><input name="entryWindowEnd" className={styles.input} type="datetime-local" required /></Field><Field label="Draw Date / Time"><input name="drawAt" className={styles.input} type="datetime-local" required /></Field><Field label="Winner Claim Window (Days)"><input name="claimWindowDays" className={styles.input} type="number" min="0" max="36500" required /></Field><Field label="Selection Method"><input className={styles.input} value="Auditable committed random selection" readOnly /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy || !drawPrizes.length}>PREPARE DRAW</button><Link className={classNames(styles.button, styles.outline, styles.linkButton)} href="/portal/prizes">EDIT PRIZE SCHEDULE</Link></div></form></div><div className={styles.card}><SectionHead icon="◆" title="Draw Register" />{runs.length ? <DrawRunTable rows={runs} onOpen={(id) => router.push(`/portal/winners?draw=${encodeURIComponent(id)}`)} /> : <Empty>No monthly draws prepared yet.</Empty>}</div></>;
  }

  function renderWinners() {
    const runs = (Array.isArray(aux) ? aux : []) as Row[];
    const selected = selectedDraw;
    const winners = (selected && Array.isArray(selected.winners) ? selected.winners : []) as Row[];
    return <><Hero title="Winner Management Workflow" subtitle="Eligibility → selection → verification → approval → publication → claim → fulfilment → audit." pill="CONTROLLED WINNER WORKFLOW" /><div className={styles.card}><SectionHead icon="1" title="Winner Workflow" /><div className={styles.workflow}><div><small>STEP 1</small><b>Eligibility Lock</b></div><div><small>STEP 2</small><b>Draw / Selection</b></div><div><small>STEP 3</small><b>Verification</b></div><div><small>STEP 4</small><b>Approval</b></div><div><small>STEP 5</small><b>Publish & Fulfil</b></div></div></div><div className={styles.card}><SectionHead icon="◆" title="Draws" />{runs.length ? <DrawRunTable rows={runs} onOpen={(id) => void openDraw(id)} /> : <Empty />}</div>{selected ? <><div className={styles.card}><SectionHead icon="⚙" title={`${text(selected.seasonName)} • Month ${text(selected.monthNumber)}`} note={text(selected.status)} /><div className={styles.buttonLine}>{text(selected.status) === 'SCHEDULED' ? <button className={styles.button} type="button" disabled={busy} onClick={() => void drawAction('lock-eligibility', 'Eligibility locked')}>LOCK ELIGIBILITY</button> : null}{text(selected.status) === 'ELIGIBILITY_LOCKED' ? <button className={classNames(styles.button, styles.dark)} type="button" disabled={busy} onClick={() => void drawAction('select-winners', 'Winner selection completed')}>RUN SELECTION</button> : null}{text(selected.status) === 'APPROVED' ? <button className={classNames(styles.button, styles.dark)} type="button" disabled={busy} onClick={() => void drawAction('publish', 'Winner list published and claims opened')}>PUBLISH WINNERS</button> : null}</div></div><div className={styles.card}><SectionHead icon="✓" title={text(selected.status) === 'PUBLISHED' ? 'Prize Claim & Fulfilment' : 'Winner Verification Queue'} />{winners.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>USER ID</th><th>NAME</th><th>PRIZE</th><th>ELIGIBILITY</th><th>IDENTITY</th><th>PAYMENT</th><th>VERIFY</th><th>CLAIM</th><th>ACTION</th></tr></thead><tbody>{winners.map((winner) => <tr key={text(winner.id)}><td>{text(winner.username)}</td><td>{[text(winner.firstName, ''), text(winner.lastName, '')].filter(Boolean).join(' ')}</td><td>{text(winner.prizeName)}</td><td>{text(winner.eligibilityStatus, 'PASS')}</td><td>{text(winner.identityStatus, 'PENDING')}</td><td>{text(winner.paymentStatus, 'PASS')}</td><td><span className={styles.tag}>{text(winner.verificationStatus, 'PENDING')}</span></td><td><span className={styles.tag}>{text(winner.claimStatus, text(selected.status) === 'PUBLISHED' ? 'PENDING' : '—')}</span></td><td>{winnerAction(selected, winner)}</td></tr>)}</tbody></table></div> : <Empty>Run selection to create the winner queue.</Empty>}</div>{text(selected.status) === 'VERIFIED' ? <div className={styles.card}><SectionHead icon="✓" title="Approval & Publication" /><form method="post" onSubmit={approveDraw}><div className={styles.fields}><Field label="Approval Reference"><input name="approvalReference" className={styles.input} required /></Field><Field label="Winner Approval Auth Code"><input name="authorizationCode" className={styles.input} placeholder="Optional purpose-bound code" /></Field><Field label="Approval Note" full><textarea name="approvalNote" className={styles.textarea} /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>APPROVE VERIFIED WINNERS</button></div></form></div> : null}</> : null}</>;
  }

  function winnerAction(selected: Row, winner: Row) {
    const drawStatus = text(selected.status);
    const winnerId = text(winner.id, '');
    if (drawStatus === 'PUBLISHED') {
      const claimStatus = text(winner.claimStatus, 'PENDING');
      if (claimStatus === 'PENDING') return <button type="button" className={styles.button} disabled={busy} onClick={() => void claimWinner(winnerId)}>START CLAIM</button>;
      if (claimStatus === 'CLAIMED') return <form method="post" onSubmit={(event) => fulfillWinner(event, winnerId)}><div className={styles.buttonLine}><input name="externalReference" className={styles.input} required placeholder="Delivery / tracking ref" /><input name="note" className={styles.input} placeholder="Optional fulfilment note" /><button className={classNames(styles.button, styles.green)} disabled={busy}>MARK FULFILLED</button></div></form>;
      if (claimStatus === 'FULFILLED') return <span className={styles.status}>FULFILLED</span>;
      return <span className={styles.statusOff}>{claimStatus}</span>;
    }
    if (text(winner.verificationStatus) !== 'VERIFIED') return <button type="button" className={classNames(styles.button, styles.outline)} onClick={() => void verifyWinner(winnerId)} disabled={busy}>VERIFY PASS</button>;
    return 'Verified';
  }

  function renderPrizes() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const selectedSeason = seasons.find((row) => text(row.id) === selectedSeasonId) ?? {};
    return <><Hero title="Prize Catalogue" subtitle="Manage prize categories, values, quantities, winner limits and monthly allocation." /><div className={styles.card}><SectionHead icon="▣" title="Prize Schedule" action={<button type="button" className={classNames(styles.button, styles.outline)} disabled={!prizeDraft.length} onClick={() => exportCsv(prizeDraft as unknown as Row[], `${text(selectedSeason.code, 'season').toLowerCase()}-prize-schedule.csv`)}>EXPORT SCHEDULE</button>} /><Field label="Season"><select className={styles.select} value={selectedSeasonId} onChange={(event) => void changePrizeSeason(event.target.value)}><option value="">Select season</option>{seasons.map((row) => <option key={text(row.id)} value={text(row.id)}>{text(row.name)} • {text(row.status)}</option>)}</select></Field></div>{selectedSeasonId ? <div className={styles.card}><SectionHead icon="◆" title="Monthwise Prizes" action={<button type="button" className={styles.button} onClick={addPrize}>+ ADD PRIZE</button>} />{prizeDraft.length ? <div className={styles.months}>{prizeDraft.map((prize, index) => <div className={styles.month} key={`${prize.prizeCode}-${index}`}><span className={styles.monthNo}>{prize.monthNumber}</span><h3>MONTH {prize.monthNumber}</h3><div className={styles.prizeVisual}>◆</div><Field label="Month"><input className={styles.input} type="number" min="1" max="60" value={prize.monthNumber} onChange={(event) => updatePrize(index, 'monthNumber', Number(event.target.value) || 1)} /></Field><Field label="Prize Code"><input className={styles.input} value={prize.prizeCode} onChange={(event) => updatePrize(index, 'prizeCode', event.target.value)} /></Field><Field label="Prize Name"><input className={styles.input} value={prize.name} onChange={(event) => updatePrize(index, 'name', event.target.value)} /></Field><Field label="Category"><input className={styles.input} value={prize.category} onChange={(event) => updatePrize(index, 'category', event.target.value)} /></Field><Field label="Winner Count"><input className={styles.input} type="number" min="1" value={prize.winnerCount} onChange={(event) => updatePrize(index, 'winnerCount', Number(event.target.value) || 1)} /></Field><Field label="Approx. Value (optional)"><input className={styles.input} inputMode="decimal" value={prize.nominalValue ?? ''} onChange={(event) => updatePrize(index, 'nominalValue', event.target.value)} /></Field><Field label="Description"><input className={styles.input} value={prize.description ?? ''} onChange={(event) => updatePrize(index, 'description', event.target.value)} /></Field><div className={styles.buttonLine}><button type="button" className={classNames(styles.button, styles.red)} onClick={() => removePrize(index)}>REMOVE</button></div></div>)}</div> : <Empty>No prizes yet. Use “+ ADD PRIZE” to build the monthwise schedule.</Empty>}<div className={styles.buttonLine}><button type="button" className={styles.button} disabled={busy || !prizeDraft.length} onClick={() => void savePrizes()}>SAVE PRIZE SCHEDULE</button></div></div> : null}</>;
  }
}

function IncomeCards({ season, currencyCode, compact = false }: { season: Row; currencyCode: string; compact?: boolean }) {
  const items = [
    ['Direct Referral', money(season.directReferral, currencyCode), 'Per qualifying direct referral'],
    ['Binary Pair', money(season.pairValue, currencyCode), 'AC + BD = 1 qualifying 2:2 pair'],
    ['Daily Performance', `${money(season.dailyCap, currencyCode)} Cap`, 'Configured daily maximum'],
    ['Rank Achievement', 'Information only', 'Formula not defined in supplied source'],
    ['Leadership', 'Information only', 'Formula not defined in supplied source'],
    ['Monthly Lucky Draw', 'Prize Based', 'Monthwise prize schedule'],
    ['Recognition Reward', 'Information only', 'Formula not defined in supplied source'],
    ['Retail Sales Commission', 'Information only', 'Formula not defined in supplied source'],
    ['Community Pool Reward', 'Information only', 'Formula not defined in supplied source'],
  ];
  return <div className={styles.income}>{items.slice(0, compact ? 6 : 9).map((item, index) => <div className={styles.incomeItem} key={item[0]}><span className={styles.incomeNumber}>{index + 1}</span><b>{item[0]}</b><strong>{item[1]}</strong><span>{item[2]}</span></div>)}</div>;
}
function DrawRunTable({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  return <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>SEASON</th><th>MONTH</th><th>DRAW DATE</th><th>ELIGIBLE</th><th>WINNERS</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.seasonName)}</td><td>{text(row.monthNumber)}</td><td>{dateTime(row.drawAt)}</td><td>{text(row.eligibleEntryCount, '0')}</td><td>{text(row.winnerCount, '0')}</td><td><span className={styles.tag}>{text(row.status)}</span></td><td><button type="button" className={classNames(styles.button, styles.outline)} onClick={() => onOpen(text(row.id))}>OPEN</button></td></tr>)}</tbody></table></div>;
}
function prizeFromRow(row: Row): PrizeDraft {
  return {
    monthNumber: number(row.monthNumber, 1),
    prizeCode: text(row.prizeCode, 'PRIZE'),
    category: text(row.category, 'Prize'),
    name: text(row.name, 'Prize'),
    description: text(row.description, ''),
    winnerCount: number(row.winnerCount, 1),
    ...(row.nominalValue ? { nominalValue: text(row.nominalValue) } : {}),
  };
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
