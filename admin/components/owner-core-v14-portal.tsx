'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberSearchSelect } from './member-search-select';
import { RankAchievementPanel } from './rank-achievement-panel';
import { OwnerManagementShell } from './owner-management-shell';
import { WorkspaceTabs } from './workspace-tabs';
import styles from './owner-portal.module.css';

export type OwnerCoreV14Section = 'dashboard' | 'income' | 'members' | 'binary' | 'placement';
type Row = Record<string, unknown>;
type Settings = { companyName?: string; currencyCode?: string; timezone?: string };
type RegistrationPolicy = {
  emailRequired?: boolean;
  mobileRequired?: boolean;
  passwordMode?: string;
  usernameMode?: string;
  defaultRoleName?: string;
};

const API = '/api/backend/admin/owner-portal';
const CORE_API = `${API}/core`;

const TITLES: Record<OwnerCoreV14Section, string> = {
  dashboard: 'Dashboard',
  income: '9 Income Types',
  members: 'Members',
  binary: 'Binary 1:4',
  placement: 'Placement / Pairing',
};

function text(value: unknown, fallback: string | number = '—') {
  if (value === null || value === undefined || value === '') return String(fallback);
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
      style: 'currency', currency: code, maximumFractionDigits: 2,
    }).format(number(value));
  } catch {
    return `${code} ${number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}
function dateTime(value: unknown, timeZone?: string) {
  if (!value) return '—';
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) return text(value);
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(parsed);
  } catch {
    return parsed.toLocaleString('en-IN');
  }
}
function formString(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}
function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
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
function memberDisplayName(row: Row) {
  return [text(row.firstName, ''), text(row.lastName, '')].filter(Boolean).join(' ') || text(row.username);
}

export function OwnerCoreV14Portal({ section, extension }: { section: OwnerCoreV14Section; extension?: ReactNode }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({});
  const [registrationPolicy, setRegistrationPolicy] = useState<RegistrationPolicy>({});
  const [data, setData] = useState<unknown>(null);
  const [aux, setAux] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [genealogy, setGenealogy] = useState<Row | null>(null);
  const [genealogyMemberFilter, setGenealogyMemberFilter] = useState('');

  const handleError = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      router.push('/login');
      return;
    }
    setError(reason instanceof Error ? reason.message : 'Request failed');
  }, [router]);

  const load = useCallback(async () => {
    setError('');
    try {
      const portalSettings = await apiJson<Settings>(`${API}/settings`);
      setSettings(portalSettings);
      if (section === 'dashboard') {
        setData(await apiJson<Row>(`${API}/dashboard`));
        setAux(null);
      } else if (section === 'income') {
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
        const [pairs, seasons, tree] = await Promise.all([
          apiJson<Row[]>(`${CORE_API}/pair-ledger`),
          apiJson<Row[]>(`${API}/seasons`),
          apiJson<Row>(`${CORE_API}/genealogy`),
        ]);
        setData(pairs);
        setAux(seasons);
        setGenealogy(tree);
      } else {
        setData(await apiJson<Row[]>(`${API}/seasons`));
        setAux(null);
      }
    } catch (reason) {
      handleError(reason);
    }
  }, [handleError, section]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run<T>(work: () => Promise<T>, success: string, reload = true) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await work();
      if (reload) await load();
      setNotice(success);
      return result;
    } catch (reason) {
      handleError(reason);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setGeneratedPassword('');
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
        sponsorReference: formString(form, 'sponsorReference') || undefined,
        placement: formString(form, 'placement'),
        placementReference: formString(form, 'placementReference') || undefined,
        epin: formString(form, 'epin'),
      }),
    }), 'Member created with Binary 1:4 placement');
    if (result?.initialPassword) setGeneratedPassword(text(result.initialPassword, ''));
    if (result) event.currentTarget.reset();
  }

  async function submitPlacement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(() => apiJson(`${CORE_API}/placements`, {
      method: 'POST',
      body: JSON.stringify({
        memberReference: formString(form, 'memberReference'),
        parentReference: formString(form, 'parentReference'),
        slot: formString(form, 'slot'),
      }),
    }), 'Binary 1:4 placement saved');
  }

  async function selectGenealogyRoot(reference: string) {
    setBusy(true);
    setError('');
    try {
      const tree = await apiJson<Row>(
        `${CORE_API}/genealogy?reference=${encodeURIComponent(reference)}`,
      );
      setGenealogy(tree);
    } catch (reason) {
      handleError(reason);
    } finally {
      setBusy(false);
    }
  }

  function activeSeason(rows: Row[]) {
    return rows.find((row) => ['ACTIVE', 'PAUSED'].includes(text(row.status, ''))) ?? rows[0] ?? {};
  }

  function renderDashboard() {
    const row = (data ?? {}) as Row;
    const active = (row.activeSeason && typeof row.activeSeason === 'object' ? row.activeSeason : {}) as Row;
    const currency = text(active.currencyCode, settings.currencyCode ?? 'INR');
    const recentMembers = (Array.isArray(row.recentMembers) ? row.recentMembers : []) as Row[];
    const recentPayments = (Array.isArray(row.recentPayments) ? row.recentPayments : []) as Row[];
    const displayTimeZone = settings.timezone || text(active.settlementTimezone, '') || undefined;

    return <>
      <Hero
        title="MegaGoldenClub Management Dashboard"
        subtitle="Live member, finance, Binary 1:4, compliance, E-PIN, draw and reward snapshot from authoritative records."
        pill="LIVE MANAGEMENT ENVIRONMENT"
      />

      <div className={styles.kpis}>
        <Kpi label="Active Season" value={text(active.name, 'No active season')} note={text(active.status, 'Create or activate a season')} />
        <Kpi label="Members" value={number(row.memberCount).toLocaleString('en-IN')} note={`${number(row.activeMemberCount).toLocaleString('en-IN')} active MEMBER accounts`} />
        <Kpi label="Active Enrollments" value={number(row.activeEnrollmentCount).toLocaleString('en-IN')} note="Current program enrollments" />
        <Kpi label="Qualified Pairs" value={number(row.qualifiedPairs).toLocaleString('en-IN')} note={`${money(row.pairPayoutTotal, currency)} posted pair value`} />
        <Kpi label="Net Collections" value={money(row.netCollections, currency)} note={`${number(row.paymentCount).toLocaleString('en-IN')} recorded payments`} />
        <Kpi label="Member Wallets" value={money(row.walletBalance, currency)} note="Combined authoritative balance" />
        <Kpi label="KYC Attention" value={number(row.pendingKyc).toLocaleString('en-IN')} note={`${number(row.approvedKyc).toLocaleString('en-IN')} approved`} />
        <Kpi label="Open Draws" value={number(row.openDraws).toLocaleString('en-IN')} note={`${number(row.totalWinners).toLocaleString('en-IN')} winners recorded`} />
      </div>

      <div className={styles.grid2}>
        <div className={styles.card}>
          <SectionHead icon="👥" title="Members & Compliance" note="Live account and onboarding snapshot" />
          <div className={styles.summary}>
            <div><small>ACTIVE MEMBERS</small><b>{number(row.activeMemberCount).toLocaleString('en-IN')}</b></div>
            <div><small>PLACED IN 1:4</small><b>{number(row.placedMemberCount).toLocaleString('en-IN')}</b></div>
            <div><small>ACTIVE ENROLLMENTS</small><b>{number(row.activeEnrollmentCount).toLocaleString('en-IN')}</b></div>
            <div><small>KYC APPROVED</small><b>{number(row.approvedKyc).toLocaleString('en-IN')}</b></div>
          </div>
          <div className={classNames(styles.notice, number(row.pendingKyc) > 0 && styles.warn)}>
            <b>KYC pending / review:</b> {number(row.pendingKyc).toLocaleString('en-IN')}
          </div>
        </div>

        <div className={styles.card}>
          <SectionHead icon="💳" title="Finance & Earnings" note="Authoritative ledger and payment totals" />
          <div className={styles.summary}>
            <div><small>GROSS COLLECTED</small><b>{money(row.grossCollections, currency)}</b></div>
            <div><small>REFUNDS</small><b>{money(row.totalRefunds, currency)}</b></div>
            <div><small>WALLET CREDITS</small><b>{money(row.walletCredits, currency)}</b></div>
            <div><small>WALLET DEBITS</small><b>{money(row.walletDebits, currency)}</b></div>
          </div>
          <div className={classNames(styles.notice, styles.success)}>
            <b>Net collections:</b> {money(row.netCollections, currency)} • <b>Member wallet balance:</b> {money(row.walletBalance, currency)}
          </div>
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={styles.card}>
          <SectionHead icon="🎯" title="Draws & Rewards" note="Owner-action and reward lifecycle snapshot" />
          <div className={styles.summary}>
            <div><small>OPEN DRAWS</small><b>{number(row.openDraws).toLocaleString('en-IN')}</b></div>
            <div><small>WINNERS</small><b>{number(row.totalWinners).toLocaleString('en-IN')}</b></div>
            <div><small>OPEN CLAIMS</small><b>{number(row.openPrizeClaims).toLocaleString('en-IN')}</b></div>
            <div><small>RANK ACHIEVEMENTS</small><b>{number(row.rankAchievementCount).toLocaleString('en-IN')}</b></div>
          </div>
          <div className={styles.notice}><b>Rank cash awarded:</b> {money(row.rankCashAwarded, currency)}</div>
        </div>

        <div className={styles.card}>
          <SectionHead icon="🔐" title="Inventory & Authorization" note="Operational inventory available now" />
          <div className={styles.summary}>
            <div><small>ACTIVE E-PINS</small><b>{number(row.activeEpins).toLocaleString('en-IN')}</b></div>
            <div><small>UNUSED E-PINS</small><b>{number(row.unusedEpins).toLocaleString('en-IN')}</b></div>
            <div><small>USED E-PINS</small><b>{number(row.usedEpins).toLocaleString('en-IN')}</b></div>
            <div><small>ACTIVE AUTH CODES</small><b>{number(row.activeAuthCodes).toLocaleString('en-IN')}</b></div>
          </div>
          <div className={styles.notice}>Authorization-code count includes only active, unexpired operator codes.</div>
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={styles.card}>
          <SectionHead icon="🆕" title="Latest Members" note="Most recently created MEMBER accounts" />
          {recentMembers.length ? <div className={styles.tableBox}><table className={styles.table}>
            <thead><tr><th>MEMBER</th><th>NAME</th><th>STATUS</th><th>CREATED</th></tr></thead>
            <tbody>{recentMembers.map((member) => <tr key={text(member.id)}>
              <td><b>{text(member.username)}</b></td>
              <td>{memberDisplayName(member)}</td>
              <td className={text(member.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(member.status)}</td>
              <td>{dateTime(member.createdAt, displayTimeZone)}</td>
            </tr>)}</tbody>
          </table></div> : <Empty>No MEMBER accounts yet.</Empty>}
        </div>

        <div className={styles.card}>
          <SectionHead icon="🧾" title="Latest Payments" note="Most recent confirmed payment records" />
          {recentPayments.length ? <div className={styles.tableBox}><table className={styles.table}>
            <thead><tr><th>MEMBER</th><th>AMOUNT</th><th>DATE / TIME</th></tr></thead>
            <tbody>{recentPayments.map((payment) => <tr key={text(payment.id)}>
              <td><b>{text(payment.username)}</b><br />{memberDisplayName(payment)}</td>
              <td>{money(payment.amount, text(payment.currencyCode, currency))}</td>
              <td>{dateTime(payment.occurredAt, displayTimeZone)}</td>
            </tr>)}</tbody>
          </table></div> : <Empty>No payments recorded yet.</Empty>}
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={styles.card}>
          <SectionHead icon="🌳" title="Binary 1:4 Rule" note="Client revised topology" />
          <div className={styles.notice}><b>A + B = LEFT</b> • <b>C + D = RIGHT</b></div>
          <div className={classNames(styles.notice, styles.success)}><b>Valid pair lanes:</b> A:C and B:D only.</div>
          <div className={styles.summary}>
            <div><small>TOTAL PAIR MATCHES</small><b>{number(row.totalPairs).toLocaleString('en-IN')}</b></div>
            <div><small>PAYABLE PAIRS</small><b>{number(row.qualifiedPairs).toLocaleString('en-IN')}</b></div>
            <div><small>PAIR VALUE</small><b>{money(active.pairPayoutAmount ?? active.pairValue, currency)}</b></div>
            <div><small>DAILY CAP</small><b>{money(row.dailyCap, currency)}</b></div>
          </div>
        </div>

        <div className={styles.card}>
          <SectionHead icon="ℹ️" title="Current Configuration" />
          <div className={styles.notice}><b>Joining:</b> {money(number(active.registrationFee) + number(active.installmentAmount), currency)} = {money(active.installmentAmount, currency)} monthly EMI + {money(active.registrationFee, currency)} registration.</div>
          <div className={classNames(styles.notice, styles.warn)}>Income / Reward Types remain informational; editable financial truth lives in versioned Season policies.</div>
          <div className={styles.notice}><b>Dashboard refreshed:</b> {dateTime(row.generatedAt, displayTimeZone)}</div>
        </div>
      </div>

      <div className={styles.card}>
        <SectionHead icon="⚙️" title="Automatic Earnings Processing" note="No operator action required" />
        <div className={classNames(styles.notice, styles.success)}>
          Confirmed business events automatically flow through qualification, referral handling, fixed A:C / B:D settlement, caps and wallet ledger posting. Lucky Draw execution remains an explicit owner action.
        </div>
      </div>
    </>;
  }

  function renderIncome() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const active = activeSeason(seasons);
    const currency = text(active.currencyCode, settings.currencyCode ?? 'INR');
    return <>
      <Hero title="9 Income / Reward Types" subtitle="Read-only overview. No standalone income editor exists." pill="INFORMATIONAL • NOT AN EDITOR" />
      <div className={styles.card}><IncomeCards season={active} currencyCode={currency} /></div>
      <RankAchievementPanel />
      <div className={styles.card}>
        <SectionHead icon="🧮" title="Core Calculation" />
        <div className={styles.notice}><b>Direct Referral:</b> {money(active.directReferral, currency)} per qualifying direct referral. <b>Binary Pair:</b> A:C or B:D = one qualifying pair at {money(active.pairValue, currency)}. <b>Daily cap:</b> {money(active.dailyCap, currency)}.</div>
        <div className={classNames(styles.notice, styles.warn)}>A:D and B:C never form a qualifying pair.</div>
      </div>
    </>;
  }

  function renderMembers() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    const usernameMode = text(registrationPolicy.usernameMode, 'AUTO_OR_MANUAL');
    const passwordMode = text(registrationPolicy.passwordMode, 'MANUAL');
    const tabs = [
      { id: 'member-register', label: 'Register Member' },
      { id: 'member-directory', label: 'Member Directory', count: rows.length },
      ...(extension ? [{ id: 'member-kyc', label: 'KYC / Policy' }] : []),
    ];
    return <>
      <Hero title="Member Management" subtitle="Registration, sponsor validation, A/B/C/D placement, profile, KYC and account status." />
      <WorkspaceTabs ariaLabel="Member management workspace" tabs={tabs}>
        {(activeTab) => <>
          {activeTab === 'member-register' ? <div className={styles.card}>
            <SectionHead icon="➕" title="Create Member" />
            <div className={styles.notice}>Binary 1:4: A/B are Left, C/D are Right. Auto Placement searches A → B → C → D, then continues breadth-first.</div>
            <form method="post" autoComplete="off" onSubmit={submitMember}>
              <div className={styles.fields}>
                <Field label="Sponsor / Auto Sponsor" full><MemberSearchSelect name="sponsorReference" placeholder="Search existing sponsor by User ID, name, mobile or email" /></Field>
                <Field label="E-PIN"><input name="epin" className={styles.input} placeholder="Required E-PIN" required /></Field>
                <Field label="Placement"><PlacementSelect name="placement" /></Field>
                <Field label="Username"><input name="username" className={styles.input} autoComplete="off" data-lpignore="true" data-1p-ignore="true" required={usernameMode === 'MANUAL'} placeholder={usernameMode === 'AUTO' ? 'Generated by system' : 'Optional when AUTO_OR_MANUAL'} /></Field>
                <Field label="Full Name"><input name="fullName" className={styles.input} required placeholder="Full name" /></Field>
                <Field label="Mobile"><input name="phone" className={styles.input} required={Boolean(registrationPolicy.mobileRequired)} placeholder="+91" /></Field>
                <Field label="Email"><input name="email" className={styles.input} type="email" required={Boolean(registrationPolicy.emailRequired)} placeholder="Email" /></Field>
                <Field label="Date of Birth"><input name="dateOfBirth" className={styles.input} type="date" /></Field>
                <Field label="State"><input name="state" className={styles.input} /></Field>
                <Field label="City"><input name="city" className={styles.input} /></Field>
                <Field label="Password"><input name="password" className={styles.input} type="password" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" required={passwordMode === 'MANUAL'} placeholder={passwordMode === 'AUTO' ? 'Generated by system' : passwordMode === 'AUTO_OR_MANUAL' ? 'Leave blank for system-generated password' : 'Required by policy'} /></Field>
                <Field label="Placement Reference"><MemberSearchSelect name="placementReference" placeholder="Search existing placement parent (optional)" /></Field>
              </div>
              <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SUBMIT REGISTRATION</button><button className={classNames(styles.button, styles.dark)} type="reset">RESET</button></div>
            </form>
            {generatedPassword ? <div className={classNames(styles.notice, styles.success)}>One-time generated password: <b>{generatedPassword}</b>.</div> : null}
          </div> : null}
          {activeTab === 'member-directory' ? <div className={styles.card}>
            <SectionHead icon="👥" title="Member Directory" note={`${rows.length} recent records`} />
            {rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>USER ID</th><th>NAME</th><th>SPONSOR</th><th>SLOT</th><th>SIDE</th><th>PARENT</th><th>SEASON</th><th>KYC</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.username)}</td><td>{[text(row.firstName, ''), text(row.lastName, '')].filter(Boolean).join(' ') || '—'}</td><td>{text(row.sponsorUsername)}</td><td><b>{text(row.placementSlot, 'Pending')}</b></td><td>{text(row.placementSide)}</td><td>{text(row.placementParentUsername)}</td><td>{text(row.seasonName, 'Not enrolled')}</td><td><span className={styles.tag}>{text(row.kycStatus, 'NOT_STARTED')}</span></td><td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td></tr>)}</tbody></table></div> : <Empty />}
          </div> : null}
          {activeTab === 'member-kyc' && extension ? <div className="ownerEmbeddedExtension">{extension}</div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }

  function renderBinary() {
    const rows = (Array.isArray(data) ? data : []) as Row[];
    const seasons = (Array.isArray(aux) ? aux : []) as Row[];
    const active = activeSeason(seasons);
    const currency = text(active.currencyCode, settings.currencyCode ?? 'INR');
    const tree = (genealogy ?? {}) as Row;
    const root = tree.root && typeof tree.root === 'object' ? tree.root as Row : null;
    const roots = Array.isArray(tree.roots) ? tree.roots.filter((item): item is Row => Boolean(item) && typeof item === 'object') : [];
    const members = Array.isArray(tree.members) ? tree.members.filter((item): item is Row => Boolean(item) && typeof item === 'object') : [];
    const directChildren = root
      ? members.filter((member) => text(member.parentUserId, '') === text(root.id, ''))
      : [];
    const bySlot = new Map(directChildren.map((member) => [text(member.slot), member]));
    const normalizedMemberFilter = genealogyMemberFilter.trim().toLowerCase();
    const filteredRoots = roots.filter((member) =>
      !normalizedMemberFilter ||
      text(member.id, '').toLowerCase().includes(normalizedMemberFilter) ||
      text(member.username, '').toLowerCase().includes(normalizedMemberFilter) ||
      memberDisplayName(member).toLowerCase().includes(normalizedMemberFilter) ||
      text(member.id, '') === text(root?.id, ''),
    );
    const tabs = [
      { id: 'binary-genealogy', label: 'Placement Genealogy', count: number(tree.visibleMemberCount) },
      { id: 'binary-pairs', label: 'Pair Ledger', count: rows.length },
    ];

    return <>
      <Hero title="Binary 1:4" subtitle="Four direct slots: A/B on Left and C/D on Right. Pair lanes are fixed." pill="A:C + B:D ONLY" />
      <WorkspaceTabs ariaLabel="Binary 1:4 workspace" tabs={tabs}>
        {(activeTab) => <>
          {activeTab === 'binary-genealogy' ? <div className={styles.card}>
            <SectionHead
              icon="🌳"
              title="Placement Genealogy"
              note={root ? `${number(tree.visibleMemberCount)} placed member${number(tree.visibleMemberCount) === 1 ? '' : 's'} below selected root` : 'No placement root found'}
            />
            {roots.length ? <div className={styles.genealogyToolbar}>
              <label>
                <span>Find any member (ID or name)</span>
                <input
                  className={styles.input}
                  type="search"
                  value={genealogyMemberFilter}
                  onChange={(event) => setGenealogyMemberFilter(event.target.value)}
                  placeholder="Search any member, e.g. MGC695322"
                  aria-label="Search binary members"
                />
              </label>
              <label>
                <span>View A/B/C/D slots for member ({roots.length} total members)</span>
                <select
                  aria-label="Select binary member"
                  className={styles.select}
                  value={text(root?.id, '')}
                  disabled={busy}
                  onChange={(event) => void selectGenealogyRoot(event.target.value)}
                >
                  {filteredRoots.map((item) => <option value={text(item.id)} key={text(item.id)}>
                    {text(item.username)} • {memberDisplayName(item)} • {number(item.directChildCount)} filled
                  </option>)}
                </select>
              </label>
              <div className={styles.genealogyCount}><b>{number(tree.visibleMemberCount)}</b><span>Members below selection</span></div>
            </div> : null}
            {root ? <>
              <div className={styles.genealogyNavigation}>
                {root.placementParentUserId ? <button
                  className={classNames(styles.button, styles.dark)}
                  type="button"
                  disabled={busy}
                  onClick={() => void selectGenealogyRoot(text(root.placementParentUserId))}
                >← BACK TO PLACEMENT PARENT: {text(root.placementParentUsername)}</button> : null}
                <span>Four direct placement slots for selected member • OPEN = empty • FILLED = occupied</span>
              </div>
              <div className={styles.genealogyRootCard}>
                <small>SELECTED MEMBER</small>
                <b>{text(root.username)}</b>
                <span>{memberDisplayName(root)}</span>
                <span>Sponsor: {text(root.sponsorUsername, 'Not assigned')}</span>
                <span>Placement parent: {text(root.placementParentUsername, 'Top level')}</span>
              </div>
              <div className={styles.genealogySlotGrid}>
                {(['A', 'B', 'C', 'D'] as const).map((slot) => {
                  const member = bySlot.get(slot);
                  const side = slot === 'A' || slot === 'B' ? 'LEFT' : 'RIGHT';
                  return member ? <button
                    className={classNames(styles.genealogySlotCard, styles.genealogySlotButton)}
                    type="button"
                    disabled={busy}
                    onClick={() => void selectGenealogyRoot(text(member.id))}
                    aria-label={`View ${text(member.username)} A B C D slots from filled slot ${slot}`}
                    key={slot}
                  >
                    <div className={styles.genealogySlotHead}><b>{slot}</b><span>{side} • FILLED</span></div>
                    <strong>{text(member.username)}</strong>
                    <span>{memberDisplayName(member)}</span>
                    <small>Sponsor: {text(member.sponsorUsername, 'Not assigned')}</small>
                    <small>Parent: {text(member.parentUsername)} • {text(member.status)}</small>
                    <small className={styles.genealogyDrillHint}>View A/B/C/D slots →</small>
                  </button> : <div className={styles.genealogyEmptySlot} key={slot}>
                    <div className={styles.genealogySlotHead}><b>{slot}</b><span>{side} • OPEN</span></div>
                    <strong>Available</strong>
                    <span>No member placed in this slot</span>
                  </div>;
                })}
              </div>
              {members.length ? <div className={styles.tableBox}>
                <table className={styles.table}>
                  <thead><tr><th>LEVEL</th><th>MEMBER</th><th>NAME</th><th>SPONSOR</th><th>PLACEMENT PARENT</th><th>SLOT</th><th>SIDE</th><th>FIRST LEG</th><th>STATUS</th></tr></thead>
                  <tbody>{members.map((member) => <tr key={text(member.id)}>
                    <td>{number(member.depth)}</td>
                    <td><button className={styles.genealogyMemberLink} type="button" disabled={busy} onClick={() => void selectGenealogyRoot(text(member.id))}>{text(member.username)} →</button></td>
                    <td>{memberDisplayName(member)}</td>
                    <td>{text(member.sponsorUsername, 'Not assigned')}</td>
                    <td>{text(member.parentUsername)}</td>
                    <td><b>{text(member.slot)}</b></td>
                    <td>{text(member.side)}</td>
                    <td>{text(member.firstLegSlot)} / {text(member.firstLegSide)}</td>
                    <td className={text(member.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(member.status)}</td>
                  </tr>)}</tbody>
                </table>
              </div> : <Empty>No members are placed below this root yet.</Empty>}
            </> : <Empty>No Binary 1:4 member is available.</Empty>}
          </div> : null}

          {activeTab === 'binary-pairs' ? <div className={styles.card}>
            <SectionHead icon="🔗" title="Pair Ledger" note="Fixed-lane qualified pair records" />
            <div className={styles.notice}><b>Valid pair lanes:</b> A:C and B:D only. A:D and B:C are invalid.</div>
            {rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>PAIR</th><th>MEMBER</th><th>LANE</th><th>LEFT SLOT</th><th>RIGHT SLOT</th><th>VALUE</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.pairSequence)}</td><td>{text(row.username)}</td><td><b>{text(row.pairLane, text(row.crossMatch))}</b></td><td>{text(row.leftSlot)}</td><td>{text(row.rightSlot)}</td><td>{money(row.payoutAmount, text(row.currencyCode, currency))}</td><td className={row.payable ? styles.status : styles.statusOff}>{row.payable ? 'QUALIFIED' : 'CAP LIMITED'}</td></tr>)}</tbody></table></div> : <Empty>No pair records yet.</Empty>}
          </div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }

  function renderPlacement() {
    const seasons = (Array.isArray(data) ? data : []) as Row[];
    const active = activeSeason(seasons);
    return <>
      <Hero title="Placement & Pairing" subtitle="Assign exact A/B/C/D slots. A/B are Left; C/D are Right." pill="FIXED PAIRS A:C • B:D" />
      <div className={styles.card}>
        <form method="post" onSubmit={submitPlacement}>
          <div className={styles.fields}>
            <Field label="Member"><MemberSearchSelect name="memberReference" required /></Field>
            <Field label="Placement Slot"><PlacementSelect name="slot" /></Field>
            <Field label="Reference Member"><MemberSearchSelect name="parentReference" required placeholder="Search existing parent by User ID, name, mobile or email" /></Field>
            <Field label="Pair Lanes"><input className={styles.input} value="A:C and B:D" readOnly /></Field>
            <Field label="Carry Forward"><input className={styles.input} value={active.carryForward ? 'Enabled by active season' : 'Disabled by active season'} readOnly /></Field>
            <Field label="Qualification"><input className={styles.input} value="Derived from slot-aware qualifying-unit events" readOnly /></Field>
          </div>
          <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE PLACEMENT</button></div>
        </form>
      </div>
      <div className={styles.card}><SectionHead icon="✅" title="Pairing Controls" /><div className={styles.notice}>The genealogy engine persists A/B/C/D ancestry. Settlement accepts only A:C and B:D; generic Left × Right matching is disabled.</div></div>
    </>;
  }

  return (
    <OwnerManagementShell title={TITLES[section]} currentSection={section}>
      {error ? <div className={classNames(styles.notice, styles.error)}>{error}</div> : null}
      {notice ? <div className={classNames(styles.notice, styles.success)}>{notice}</div> : null}
      {section === 'dashboard' ? renderDashboard() : null}
      {section === 'income' ? renderIncome() : null}
      {section === 'members' ? renderMembers() : null}
      {section === 'binary' ? renderBinary() : null}
      {section === 'placement' ? renderPlacement() : null}
    </OwnerManagementShell>
  );
}

function PlacementSelect({ name }: { name: string }) {
  return <select name={name} className={styles.select} defaultValue="AUTO">
    <option value="AUTO">Auto Placement</option>
    <option value="A">A • Left</option>
    <option value="B">B • Left</option>
    <option value="C">C • Right</option>
    <option value="D">D • Right</option>
  </select>;
}

function IncomeCards({ season, currencyCode }: { season: Row; currencyCode: string }) {
  const items = [
    ['Direct Referral', money(season.directReferral, currencyCode), 'Per qualifying direct referral'],
    ['Binary Pair', money(season.pairValue, currencyCode), 'A:C or B:D = one qualifying pair'],
    ['Daily Performance', `${money(season.dailyCap, currencyCode)} Cap`, 'Configured daily maximum'],
    ['Rank Achievement', 'Auto Level 1–4', 'Joining-date targets and fresh direct/team members; see below'],
    ['Leadership', 'Information only', 'Formula not defined in supplied source'],
    ['Monthly Lucky Draw', 'Prize Based', 'Monthwise prize schedule'],
    ['Recognition Reward', 'Information only', 'Formula not defined in supplied source'],
    ['Retail Sales Commission', 'Information only', 'Formula not defined in supplied source'],
    ['Community Pool Reward', 'Information only', 'Formula not defined in supplied source'],
  ];
  return <div className={styles.income}>{items.map((item, index) => <div className={styles.incomeItem} key={item[0]}><span className={styles.incomeNumber}>{index + 1}</span><b>{item[0]}</b><strong>{item[1]}</strong><span>{item[2]}</span></div>)}</div>;
}
