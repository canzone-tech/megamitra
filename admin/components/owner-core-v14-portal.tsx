'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
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
        const [pairs, seasons] = await Promise.all([
          apiJson<Row[]>(`${CORE_API}/pair-ledger`),
          apiJson<Row[]>(`${API}/seasons`),
        ]);
        setData(pairs);
        setAux(seasons);
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
        memberType: formString(form, 'memberType'),
        sponsorReference: formString(form, 'sponsorReference') || undefined,
        placement: formString(form, 'placement'),
        placementReference: formString(form, 'placementReference') || undefined,
        epin: formString(form, 'epin') || undefined,
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

  function activeSeason(rows: Row[]) {
    return rows.find((row) => ['ACTIVE', 'PAUSED'].includes(text(row.status, ''))) ?? rows[0] ?? {};
  }

  function renderDashboard() {
    const row = (data ?? {}) as Row;
    const active = (row.activeSeason && typeof row.activeSeason === 'object' ? row.activeSeason : {}) as Row;
    const currency = text(active.currencyCode, settings.currencyCode ?? 'INR');
    return <>
      <Hero title="MegaGoldenClub Management Dashboard" subtitle="Central control for seasons, members, Binary 1:4, payments, monthly draws and reporting." pill="LIVE MANAGEMENT ENVIRONMENT" />
      <div className={styles.kpis}>
        <Kpi label="Active Season" value={text(active.name, 'No active season')} note={text(active.status, 'Create or activate a season')} />
        <Kpi label="Members" value={number(row.memberCount).toLocaleString('en-IN')} note="Registered accounts" />
        <Kpi label="Qualified Pairs" value={number(row.qualifiedPairs).toLocaleString('en-IN')} note="A:C + B:D only" />
        <Kpi label="Daily Cap" value={money(row.dailyCap, currency)} note="Current season rule" />
      </div>
      <div className={styles.grid2}>
        <div className={styles.card}>
          <SectionHead icon="◇" title="Binary 1:4 Rule" note="Client revised topology" />
          <div className={styles.notice}><b>A + B = LEFT</b> • <b>C + D = RIGHT</b></div>
          <div className={classNames(styles.notice, styles.success)}><b>Valid pair lanes:</b> A:C and B:D only.</div>
        </div>
        <div className={styles.card}>
          <SectionHead icon="i" title="Current Configuration" />
          <div className={styles.notice}><b>Joining:</b> {money(number(active.registrationFee) + number(active.installmentAmount), currency)} = {money(active.installmentAmount, currency)} monthly EMI + {money(active.registrationFee, currency)} registration.</div>
          <div className={classNames(styles.notice, styles.warn)}>Income / Reward Types remain informational; editable financial truth lives in versioned Season policies.</div>
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
      <div className={styles.card}>
        <SectionHead icon="=" title="Core Calculation" />
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
            <SectionHead icon="+" title="Create Member" />
            <div className={styles.notice}>Binary 1:4: A/B are Left, C/D are Right. Auto Placement searches A → B → C → D, then continues breadth-first.</div>
            <form method="post" autoComplete="off" onSubmit={submitMember}>
              <div className={styles.fields}>
                <Field label="Sponsor ID / Auto Sponsor" full><input name="sponsorReference" className={styles.input} placeholder="Sponsor ID, mobile or email" /></Field>
                <Field label="E-PIN"><input name="epin" className={styles.input} placeholder="Optional E-PIN" /></Field>
                <Field label="Placement"><PlacementSelect name="placement" /></Field>
                <Field label="Username"><input name="username" className={styles.input} autoComplete="off" data-lpignore="true" data-1p-ignore="true" required={usernameMode === 'MANUAL'} placeholder={usernameMode === 'AUTO' ? 'Generated by system' : 'Optional when AUTO_OR_MANUAL'} /></Field>
                <Field label="Full Name"><input name="fullName" className={styles.input} required placeholder="Full name" /></Field>
                <Field label="Mobile"><input name="phone" className={styles.input} required={Boolean(registrationPolicy.mobileRequired)} placeholder="+91" /></Field>
                <Field label="Email"><input name="email" className={styles.input} type="email" required={Boolean(registrationPolicy.emailRequired)} placeholder="Email" /></Field>
                <Field label="Date of Birth"><input name="dateOfBirth" className={styles.input} type="date" /></Field>
                <Field label="State"><input name="state" className={styles.input} /></Field>
                <Field label="City"><input name="city" className={styles.input} /></Field>
                <Field label="Password"><input name="password" className={styles.input} type="password" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" required={passwordMode === 'MANUAL'} placeholder={passwordMode === 'AUTO' ? 'Generated by system' : passwordMode === 'AUTO_OR_MANUAL' ? 'Leave blank for system-generated password' : 'Required by policy'} /></Field>
                <Field label="Member Type"><select name="memberType" className={styles.select}><option value="PARTNER">Partner</option><option value="CUSTOMER">Customer</option></select></Field>
                <Field label="Placement Reference"><input name="placementReference" className={styles.input} placeholder="Defaults to sponsor" /></Field>
              </div>
              <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SUBMIT REGISTRATION</button><button className={classNames(styles.button, styles.dark)} type="reset">RESET</button></div>
            </form>
            {generatedPassword ? <div className={classNames(styles.notice, styles.success)}>One-time generated password: <b>{generatedPassword}</b>.</div> : null}
          </div> : null}
          {activeTab === 'member-directory' ? <div className={styles.card}>
            <SectionHead icon="●" title="Member Directory" note={`${rows.length} recent records`} />
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
    return <>
      <Hero title="Binary 1:4" subtitle="Four direct slots: A/B on Left and C/D on Right. Pair lanes are fixed." pill="A:C + B:D ONLY" />
      <div className={styles.card}>
        <SectionHead icon="◇" title="Binary 1:4 Structure" />
        <div className={styles.binaryBox}>
          <div className={styles.binaryRow}><div className={classNames(styles.node, styles.root)}><b>YOU</b><span>Reference member</span></div></div>
          <div className={styles.binaryRow}>
            <div className={styles.node}><b>A • LEFT</b><span>Pairs only with C</span></div>
            <div className={styles.node}><b>B • LEFT</b><span>Pairs only with D</span></div>
            <div className={styles.node}><b>C • RIGHT</b><span>Pairs only with A</span></div>
            <div className={styles.node}><b>D • RIGHT</b><span>Pairs only with B</span></div>
          </div>
          <div className={styles.pairBox}>A:C = PAIR 1 • B:D = PAIR 2 • VALUE = {money(active.pairValue, currency)}</div>
        </div>
        <div className={classNames(styles.notice, styles.warn)}>A:D and B:C are intentionally invalid and cannot be matched by the settlement engine.</div>
      </div>
      <div className={styles.card}>
        <SectionHead icon="⌁" title="Pair Ledger" note="Fixed-lane qualified pair records" />
        {rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>PAIR</th><th>MEMBER</th><th>LANE</th><th>LEFT SLOT</th><th>RIGHT SLOT</th><th>VALUE</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{text(row.pairSequence)}</td><td>{text(row.username)}</td><td><b>{text(row.pairLane, text(row.crossMatch))}</b></td><td>{text(row.leftSlot)}</td><td>{text(row.rightSlot)}</td><td>{money(row.payoutAmount, text(row.currencyCode, currency))}</td><td className={row.payable ? styles.status : styles.statusOff}>{row.payable ? 'QUALIFIED' : 'CAP LIMITED'}</td></tr>)}</tbody></table></div> : <Empty>No pair records yet.</Empty>}
      </div>
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
            <Field label="Member ID"><input name="memberReference" className={styles.input} required placeholder="User ID / mobile / email" /></Field>
            <Field label="Placement Slot"><PlacementSelect name="slot" /></Field>
            <Field label="Reference Member"><input name="parentReference" className={styles.input} required placeholder="Parent / reference member" /></Field>
            <Field label="Pair Lanes"><input className={styles.input} value="A:C and B:D" readOnly /></Field>
            <Field label="Carry Forward"><input className={styles.input} value={active.carryForward ? 'Enabled by active season' : 'Disabled by active season'} readOnly /></Field>
            <Field label="Qualification"><input className={styles.input} value="Derived from slot-aware qualifying-unit events" readOnly /></Field>
          </div>
          <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SAVE PLACEMENT</button></div>
        </form>
      </div>
      <div className={styles.card}><SectionHead icon="✓" title="Pairing Controls" /><div className={styles.notice}>The genealogy engine persists A/B/C/D ancestry. Settlement accepts only A:C and B:D; generic Left × Right matching is disabled.</div></div>
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
    ['Rank Achievement', 'Information only', 'Formula not defined in supplied source'],
    ['Leadership', 'Information only', 'Formula not defined in supplied source'],
    ['Monthly Lucky Draw', 'Prize Based', 'Monthwise prize schedule'],
    ['Recognition Reward', 'Information only', 'Formula not defined in supplied source'],
    ['Retail Sales Commission', 'Information only', 'Formula not defined in supplied source'],
    ['Community Pool Reward', 'Information only', 'Formula not defined in supplied source'],
  ];
  return <div className={styles.income}>{items.map((item, index) => <div className={styles.incomeItem} key={item[0]}><span className={styles.incomeNumber}>{index + 1}</span><b>{item[0]}</b><strong>{item[1]}</strong><span>{item[2]}</span></div>)}</div>;
}
