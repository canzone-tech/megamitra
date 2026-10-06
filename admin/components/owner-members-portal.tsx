'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberSearchSelect } from './member-search-select';
import { OwnerManagementShell } from './owner-management-shell';
import { WorkspaceTabs } from './workspace-tabs';
import styles from './owner-portal.module.css';
import {
  DEFAULT_INDIAN_CITY,
  DEFAULT_INDIAN_STATE,
  INDIA_STATE_CITIES,
  INDIA_STATES,
  OTHER_CITY_VALUE,
} from '../../shared/india-locations';

type Row = Record<string, unknown>;
type RegistrationPolicy = {
  emailRequired?: boolean;
  mobileRequired?: boolean;
  passwordMode?: string;
  usernameMode?: string;
  defaultRoleName?: string;
};

const CORE_API = '/api/backend/admin/owner-portal/core';

function text(value: unknown, fallback: string | number = '—') {
  if (value === null || value === undefined || value === '') return String(fallback);
  return String(value);
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

function PlacementSelect({ name }: { name: string }) {
  return (
    <select name={name} className={styles.select} defaultValue="AUTO">
      <option value="AUTO">Auto placement</option>
      <option value="A">A — Left</option>
      <option value="B">B — Left</option>
      <option value="C">C — Right</option>
      <option value="D">D — Right</option>
    </select>
  );
}

export function OwnerMembersPortal({ extension }: { extension?: ReactNode }) {
  const router = useRouter();
  const [members, setMembers] = useState<Row[]>([]);
  const [registrationPolicy, setRegistrationPolicy] = useState<RegistrationPolicy>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [selectedState, setSelectedState] = useState(DEFAULT_INDIAN_STATE);
  const [selectedCity, setSelectedCity] = useState(DEFAULT_INDIAN_CITY);

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
      const [rows, policy] = await Promise.all([
        apiJson<Row[]>(`${CORE_API}/members`),
        apiJson<RegistrationPolicy>(`${CORE_API}/registration-policy`),
      ]);
      setMembers(rows);
      setRegistrationPolicy(policy);
    } catch (reason) {
      handleError(reason);
    }
  }, [handleError]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const city = selectedCity === OTHER_CITY_VALUE ? formString(form, 'otherCity') : selectedCity;
    if (!city) {
      setError('Please enter the member city');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setGeneratedPassword('');
    try {
      const result = await apiJson<Row>(`${CORE_API}/members`, {
        method: 'POST',
        body: JSON.stringify({
          username: formString(form, 'username') || undefined,
          fullName: formString(form, 'fullName'),
          phone: formString(form, 'phone') || undefined,
          email: formString(form, 'email') || undefined,
          password: formString(form, 'password') || undefined,
          dateOfBirth: formString(form, 'dateOfBirth') || undefined,
          state: selectedState,
          city,
          postalCode: formString(form, 'postalCode') || undefined,
          sponsorReference: formString(form, 'sponsorReference') || undefined,
          placement: formString(form, 'placement'),
          placementReference: formString(form, 'placementReference') || undefined,
          epin: formString(form, 'epin'),
        }),
      });
      if (result.initialPassword) setGeneratedPassword(text(result.initialPassword, ''));
      formElement.reset();
      setSelectedState(DEFAULT_INDIAN_STATE);
      setSelectedCity(DEFAULT_INDIAN_CITY);
      setNotice('MEMBER account created with Binary 1:4 placement');
      await load();
    } catch (reason) {
      handleError(reason);
    } finally {
      setBusy(false);
    }
  }

  const usernameMode = text(registrationPolicy.usernameMode, 'AUTO_OR_MANUAL');
  const passwordMode = text(registrationPolicy.passwordMode, 'MANUAL');
  const tabs = [
    { id: 'member-register', label: 'Register Member' },
    { id: 'member-directory', label: 'Member Directory', count: members.length },
    ...(extension ? [{ id: 'member-kyc', label: 'KYC / Policy' }] : []),
  ];

  return (
    <OwnerManagementShell title="Member Management" currentSection="members">
      <div className={styles.hero}>
        <h1>Member Management</h1>
        <p>MEMBER account registration, sponsor validation, Binary 1:4 placement, profile, KYC and account status.</p>
        <span className={styles.pill}>ACCOUNT ROLE: MEMBER</span>
      </div>

      {error ? <div className={classNames(styles.notice, styles.warn)} role="alert">{error}</div> : null}
      {notice ? <div className={classNames(styles.notice, styles.success)} role="status">{notice}</div> : null}

      <WorkspaceTabs ariaLabel="Member management workspace" tabs={tabs}>
        {(activeTab) => (
          <>
            {activeTab === 'member-register' ? (
              <div className={styles.card}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}><span className={styles.sectionIcon}>➕</span><h2>Create Member</h2></div>
                  <small>Role is fixed to MEMBER</small>
                </div>
                <div className={styles.notice}>Binary 1:4: A/B are Left, C/D are Right. Auto Placement searches A → B → C → D, then continues breadth-first.</div>
                <form method="post" autoComplete="off" onSubmit={submitMember}>
                  <div className={styles.fields}>
                    <Field label="Sponsor / Auto Sponsor" full><MemberSearchSelect name="sponsorReference" placeholder="Search existing sponsor by User ID, name, mobile or email" /></Field>
                    <Field label="E-PIN *"><input name="epin" className={styles.input} placeholder="Required E-PIN" required autoComplete="off" /></Field>
                    <Field label="Placement"><PlacementSelect name="placement" /></Field>
                    <Field label="Username"><input name="username" className={styles.input} autoComplete="off" data-lpignore="true" data-1p-ignore="true" required={usernameMode === 'MANUAL'} placeholder={usernameMode === 'AUTO' ? 'Generated by system' : 'Optional when AUTO_OR_MANUAL'} /></Field>
                    <Field label="Full Name"><input name="fullName" className={styles.input} required placeholder="Full name" /></Field>
                    <Field label="Mobile"><input name="phone" className={styles.input} required={Boolean(registrationPolicy.mobileRequired)} placeholder="+91" /></Field>
                    <Field label="Email"><input name="email" className={styles.input} type="email" required={Boolean(registrationPolicy.emailRequired)} placeholder="Email" /></Field>
                    <Field label="Date of Birth"><input name="dateOfBirth" className={styles.input} type="date" /></Field>
                    <Field label="State"><select name="state" className={styles.select} value={selectedState} required onChange={(event) => { const state = event.target.value; const cities = INDIA_STATE_CITIES[state] ?? []; setSelectedState(state); setSelectedCity(cities[0] ?? OTHER_CITY_VALUE); }}>{INDIA_STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select></Field>
                    <Field label="City"><select name="city" className={styles.select} value={selectedCity} required onChange={(event) => setSelectedCity(event.target.value)}>{(INDIA_STATE_CITIES[selectedState] ?? []).map((city) => <option key={city} value={city}>{city}</option>)}<option value={OTHER_CITY_VALUE}>Other</option></select></Field>
                    {selectedCity === OTHER_CITY_VALUE ? <Field label="Other City"><input name="otherCity" className={styles.input} required /></Field> : null}
                    <Field label="PIN Code"><input name="postalCode" className={styles.input} inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} placeholder="6-digit PIN Code" required /></Field>
                    <Field label="Password"><input name="password" className={styles.input} type="password" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" required={passwordMode === 'MANUAL'} placeholder={passwordMode === 'AUTO' ? 'Generated by system' : passwordMode === 'AUTO_OR_MANUAL' ? 'Leave blank for system-generated password' : 'Required by policy'} /></Field>
                    <Field label="Placement Reference"><MemberSearchSelect name="placementReference" placeholder="Search existing placement parent (optional)" /></Field>
                  </div>
                  <div className={styles.buttonLine}>
                    <button className={styles.button} disabled={busy}>{busy ? 'CREATING…' : 'SUBMIT REGISTRATION'}</button>
                    <button className={classNames(styles.button, styles.dark)} type="reset">RESET</button>
                  </div>
                </form>
                {generatedPassword ? <div className={classNames(styles.notice, styles.success)}>One-time generated password: <b>{generatedPassword}</b>.</div> : null}
              </div>
            ) : null}

            {activeTab === 'member-directory' ? (
              <div className={styles.card}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}><span className={styles.sectionIcon}>👥</span><h2>Member Directory</h2></div>
                  <small>{members.length} recent MEMBER accounts</small>
                </div>
                {members.length ? (
                  <div className={styles.tableBox}>
                    <table className={styles.table}>
                      <thead><tr><th>USER ID</th><th>NAME</th><th>ROLE</th><th>SPONSOR</th><th>SLOT</th><th>SIDE</th><th>PARENT</th><th>SEASON</th><th>KYC</th><th>STATUS</th></tr></thead>
                      <tbody>
                        {members.map((row) => (
                          <tr key={text(row.id)}>
                            <td>{text(row.username)}</td>
                            <td>{[text(row.firstName, ''), text(row.lastName, '')].filter(Boolean).join(' ') || '—'}</td>
                            <td><span className={styles.tag}>{text(row.accountRole, 'MEMBER')}</span></td>
                            <td>{text(row.sponsorUsername)}</td>
                            <td><b>{text(row.placementSlot, 'Pending')}</b></td>
                            <td>{text(row.placementSide)}</td>
                            <td>{text(row.placementParentUsername)}</td>
                            <td>{text(row.seasonName, 'Not enrolled')}</td>
                            <td><span className={styles.tag}>{text(row.kycStatus, 'NOT_STARTED')}</span></td>
                            <td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className={styles.empty}>No MEMBER accounts yet.</div>}
              </div>
            ) : null}

            {activeTab === 'member-kyc' ? extension : null}
          </>
        )}
      </WorkspaceTabs>
    </OwnerManagementShell>
  );
}
