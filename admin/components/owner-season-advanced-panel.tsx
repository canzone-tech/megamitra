'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { WorkspaceTabs } from '@/components/workspace-tabs';
import styles from './owner-portal.module.css';
import extension from './owner-portal-extension.module.css';

type Season = { id: string; code: string; name: string; status: string };
type RecoveryPolicy = { seasonId:string; current:{version:number;enabled:boolean|number;reservePercent:string}|null; versions:unknown[] };
type Advanced = {
  season: Season;
  binary: {
    lifecycle: string;
    qualifyingUnit: string;
    leftVolumePerPair: string;
    rightVolumePerPair: string;
    monthlyPairCap: number | null;
    carryForwardExpiryDays: number | null;
  };
  binaryTopology?: {
    model: string;
    slots: Record<'A' | 'B' | 'C' | 'D', 'LEFT' | 'RIGHT'>;
    pairLanes: string[][];
    genericCrossPairingAllowed: boolean;
  };
  drawSchedule: {
    startMonth: number;
    weekOfMonth: number;
    weekday: string;
    timezone: string;
    label: string;
  };
  automaticRules: {
    configured: boolean;
    lifecycle: string | null;
    binaryUnitsPerEvent: number;
    referralHookEnabled: boolean;
    referralBasisMode: string;
    drawEligibilityHookEnabled: boolean;
    minimumPaymentAmount: string | null;
    minimumRegistrationAllocation: string | null;
    minimumInstallmentAllocation: string | null;
    requiredAllocationTypes: string[];
  };
};

const API = '/api/backend/admin/owner-portal';
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export function OwnerSeasonAdvancedPanel({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [config, setConfig] = useState<Advanced | null>(null);
  const [recovery, setRecovery] = useState<RecoveryPolicy | null>(null);
  const [recoveryEnabled, setRecoveryEnabled] = useState(true);
  const [recoveryPercent, setRecoveryPercent] = useState('50');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fail = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      router.replace('/login');
      return;
    }
    setError(reason instanceof Error ? reason.message : 'Request failed');
  }, [router]);

  const applyRecoverySnapshot = useCallback((next: RecoveryPolicy) => {
    setRecovery(next);
    setRecoveryEnabled(Boolean(next.current?.enabled));
    setRecoveryPercent(String(next.current?.reservePercent ?? 50));
  }, []);

  const loadConfig = useCallback(async (id: string) => {
    if (!id) { setConfig(null); return; }
    setLoading(true); setError('');
    try {
      const [next, policy] = await Promise.all([
        apiJson<Advanced>(`${API}/seasons/${encodeURIComponent(id)}/advanced-configuration`),
        apiJson<RecoveryPolicy>(`${API}/seasons/${encodeURIComponent(id)}/installment-recovery`),
      ]);
      setConfig(next); applyRecoverySnapshot(policy);
    } catch (reason) { fail(reason); }
    finally { setLoading(false); }
  }, [fail, applyRecoverySnapshot]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const rows = await apiJson<Season[]>(`${API}/seasons`);
      setSeasons(rows);
      const preferred = seasonId || rows.find((row) => ['DRAFT', 'REVIEW'].includes(row.status))?.id || rows[0]?.id || '';
      setSeasonId(preferred);
      if(preferred){
        const [next, policy]=await Promise.all([
          apiJson<Advanced>(`${API}/seasons/${encodeURIComponent(preferred)}/advanced-configuration`),
          apiJson<RecoveryPolicy>(`${API}/seasons/${encodeURIComponent(preferred)}/installment-recovery`),
        ]);
        setConfig(next);applyRecoverySnapshot(policy);
      }else {setConfig(null);setRecovery(null);}
    } catch (reason) { fail(reason); }
    finally { setLoading(false); }
  }, [fail, seasonId, applyRecoverySnapshot]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function patchBinary(key: 'monthlyPairCap' | 'carryForwardExpiryDays', value: number | null) {
    setConfig((current) => current ? { ...current, binary: { ...current.binary, [key]: value } } : current);
  }
  function patchRules(
    key: keyof Advanced['automaticRules'],
    value: string | number | boolean | null | string[],
  ) {
    setConfig((current) => current ? {
      ...current,
      automaticRules: { ...current.automaticRules, [key]: value },
    } : current);
  }
  function patchDrawSchedule(
    key: 'startMonth' | 'weekOfMonth' | 'weekday',
    value: string | number,
  ) {
    setConfig((current) => current ? {
      ...current,
      drawSchedule: { ...current.drawSchedule, [key]: value },
    } : current);
  }
  function toggleAllocation(value: string, checked: boolean) {
    if (!config) return;
    const current = config.automaticRules.requiredAllocationTypes;
    patchRules('requiredAllocationTypes', checked ? [...new Set([...current, value])] : current.filter((item) => item !== value));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !seasonId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData(event.currentTarget);
      const body = {
        // Binary 1:4 topology is fixed: one qualifying lane unit on each side of A:C or B:D.
        qualifyingUnit: '1.0000',
        leftVolumePerPair: '1.0000',
        rightVolumePerPair: '1.0000',
        monthlyPairCap: optionalNumber(String(form.get('monthlyPairCap') ?? '')),
        carryForwardExpiryDays: optionalNumber(String(form.get('carryForwardExpiryDays') ?? '')),
        binaryUnitsPerEvent: Number(form.get('binaryUnitsPerEvent') ?? 0),
        referralHookEnabled: String(form.get('referralHookEnabled') ?? 'false') === 'true',
        referralBasisMode: String(form.get('referralBasisMode') ?? 'PAYMENT_AMOUNT'),
        // Owner monthly draw eligibility is derived from installment-specific 5-digit tokens.
        drawEligibilityHookEnabled: false,
        drawStartMonth: Number(form.get('drawStartMonth') ?? config.drawSchedule.startMonth),
        drawWeekOfMonth: Number(form.get('drawWeekOfMonth') ?? config.drawSchedule.weekOfMonth),
        drawWeekday: String(form.get('drawWeekday') ?? config.drawSchedule.weekday),
        minimumPaymentAmount: String(form.get('minimumPaymentAmount') ?? '').trim() || undefined,
        minimumRegistrationAllocation: String(form.get('minimumRegistrationAllocation') ?? '').trim() || undefined,
        minimumInstallmentAllocation: String(form.get('minimumInstallmentAllocation') ?? '').trim() || undefined,
        requiredAllocationTypes: config.automaticRules.requiredAllocationTypes,
      };
      setConfig(await apiJson<Advanced>(`${API}/seasons/${encodeURIComponent(seasonId)}/advanced-configuration`, {
        method: 'PUT', body: JSON.stringify(body),
      }));
      setNotice('Binary 1:4 controls, monthly lucky draw recurrence and automatic payment rules saved as the Season draft.');
    } catch (reason) { fail(reason); }
    finally { setBusy(false); }
  }

  async function saveRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!seasonId||!recovery)return;
    setBusy(true);setError('');setNotice('');
    try{
      const rate=Number(recoveryPercent);
      if(!Number.isFinite(rate)||rate<0||rate>100)throw new Error('Reserve percentage must be 0–100');
      const next=await apiJson<RecoveryPolicy>(`${API}/seasons/${encodeURIComponent(seasonId)}/installment-recovery`,{
        method:'PUT',body:JSON.stringify({enabled:recoveryEnabled,reservePercent:rate}),
      });
      applyRecoverySnapshot(next);
      setNotice('New installment income recovery policy version published.');
    }catch(reason){fail(reason);}finally{setBusy(false);}
  }

  const editable = Boolean(config && ['DRAFT', 'REVIEW'].includes(config.season.status));
  const rules = config?.automaticRules;
  const binary = config?.binary;
  const drawSchedule = config?.drawSchedule;

  return (
    <section id="advanced-policy" className={embedded ? undefined : extension.extension}>
      <div className={styles.card}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>⚙️</span>
            <div><h2>Advanced Season Policy</h2><small>Binary 1:4 fixed topology + lucky draw calendar + payment-event automation</small></div>
          </div>
          <span className={styles.tag}>{rules?.configured ? `${rules.lifecycle ?? 'DRAFT'} AUTOMATIC RULES` : 'CONFIGURATION REQUIRED'}</span>
        </div>

        <div className={styles.notice}>
          <b>Fixed client rule:</b> A/B are LEFT, C/D are RIGHT. Only <b>A:C</b> and <b>B:D</b> form pairs. A:D and B:C are never eligible. Placement topology is not an editable ratio.
        </div>
        {error ? <div className={`${styles.notice} ${styles.error}`}>{error}</div> : null}
        {notice ? <div className={`${styles.notice} ${styles.success}`}>{notice}</div> : null}

        <div className={styles.fields}>
          <div className={styles.field}><label>Season</label><select className={styles.select} value={seasonId} onChange={(event) => { setSeasonId(event.target.value); void loadConfig(event.target.value); }}><option value="">Select season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name} • {season.status}</option>)}</select></div>
          <div className={styles.field}><label>Policy Status</label><input className={styles.input} readOnly value={config ? `${config.season.status} • Binary ${binary?.lifecycle ?? '—'}` : '—'} /></div>
        </div>

        {loading ? <div className={styles.loading}>Loading season policy…</div> : config && binary && rules && drawSchedule ? (
          <form method="post" onSubmit={save}>
            <WorkspaceTabs ariaLabel="Advanced season policy sections" tabs={[
              { id: 'binary-engine', label: 'Binary 1:4 Controls' },
              { id: 'draw-calendar', label: 'Lucky Draw Calendar' },
              { id: 'automatic-rules', label: 'Automatic Payment Rules' },
            ]}>
              {(activeTab) => <>
                <div hidden={activeTab !== 'binary-engine'}>
                  <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>🌳</span><h2>Binary 1:4</h2></div><small>Fixed placement and pair lanes</small></div>
                  <div className={styles.summary}>
                    <div><small>SLOT A</small><b>LEFT</b></div>
                    <div><small>SLOT B</small><b>LEFT</b></div>
                    <div><small>SLOT C</small><b>RIGHT</b></div>
                    <div><small>SLOT D</small><b>RIGHT</b></div>
                  </div>
                  <div className={styles.notice}><b>Pair 1:</b> A:C &nbsp; • &nbsp; <b>Pair 2:</b> B:D &nbsp; • &nbsp; Generic Left × Right matching: <b>Disabled</b></div>
                  <div className={styles.fields}>
                    <div className={styles.field}><label>Qualifying Unit</label><input className={styles.input} readOnly value="1.0000 (fixed lane unit)" /></div>
                    <div className={styles.field}><label>Lane Requirement</label><input className={styles.input} readOnly value="1 left-slot unit + 1 mapped right-slot unit" /></div>
                    <div className={styles.field}><label>Monthly Pair Cap (optional)</label><input name="monthlyPairCap" className={styles.input} type="number" min="0" disabled={!editable} value={binary.monthlyPairCap ?? ''} onChange={(event) => patchBinary('monthlyPairCap', event.target.value ? Number(event.target.value) : null)} /></div>
                    <div className={styles.field}><label>Carry Forward Expiry Days (optional)</label><input name="carryForwardExpiryDays" className={styles.input} type="number" min="1" disabled={!editable} value={binary.carryForwardExpiryDays ?? ''} onChange={(event) => patchBinary('carryForwardExpiryDays', event.target.value ? Number(event.target.value) : null)} /></div>
                  </div>
                </div>

                <div hidden={activeTab !== 'draw-calendar'}>
                  <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>📅</span><h2>Monthly Lucky Draw Calendar</h2></div><small>Calendar recurrence locked into the Season version</small></div>
                  <div className={styles.notice}><b>Default MegaGoldenClub rule:</b> January start • every month • third Sunday. These calendar values are configurable while the Season is DRAFT or REVIEW. Draw time, eligibility window and claim window remain configurable per prepared draw. Season Setup no longer asks for a fixed “Draw Day”; this recurrence is the authoritative draw calendar.</div>
                  <div className={styles.summary}>
                    <div><small>START MONTH</small><b>{MONTHS[drawSchedule.startMonth - 1] ?? drawSchedule.startMonth}</b></div>
                    <div><small>WEEK</small><b>{drawSchedule.weekOfMonth}</b></div>
                    <div><small>WEEKDAY</small><b>{drawSchedule.weekday}</b></div>
                    <div><small>TIMEZONE</small><b>{drawSchedule.timezone}</b></div>
                  </div>
                  <div className={styles.fields}>
                    <div className={styles.field}><label>First Draw Month</label><select name="drawStartMonth" className={styles.select} disabled={!editable} value={drawSchedule.startMonth} onChange={(event) => patchDrawSchedule('startMonth', Number(event.target.value))}>{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></div>
                    <div className={styles.field}><label>Week of Month</label><select name="drawWeekOfMonth" className={styles.select} disabled={!editable} value={drawSchedule.weekOfMonth} onChange={(event) => patchDrawSchedule('weekOfMonth', Number(event.target.value))}><option value={1}>1st</option><option value={2}>2nd</option><option value={3}>3rd</option><option value={4}>4th</option><option value={5}>5th</option></select></div>
                    <div className={styles.field}><label>Draw Weekday</label><select name="drawWeekday" className={styles.select} disabled={!editable} value={drawSchedule.weekday} onChange={(event) => patchDrawSchedule('weekday', event.target.value)}>{WEEKDAYS.map((weekday) => <option key={weekday} value={weekday}>{weekday.charAt(0) + weekday.slice(1).toLowerCase()}</option>)}</select></div>
                    <div className={styles.field}><label>Season Draw Timezone</label><input className={styles.input} readOnly value={drawSchedule.timezone} /></div>
                  </div>
                  <div className={styles.notice}><b>Effective rule:</b> {drawSchedule.label}. The backend rejects any prepared draw date that does not match this calendar in <b>{drawSchedule.timezone}</b>.</div>
                </div>

                <div hidden={activeTab !== 'automatic-rules'}>
                  <div className={styles.sectionHead}><div className={styles.sectionTitle}><span className={styles.sectionIcon}>⚡</span><h2>Automatic Rules on Confirmed Payment</h2></div><small>Versioned and published with Season activation</small></div>
                  <div className={styles.fields}>
                    <div className={styles.field}><label>Binary Qualifying Units / Payment</label><input name="binaryUnitsPerEvent" className={styles.input} type="number" min="0" required disabled={!editable} value={rules.binaryUnitsPerEvent} onChange={(event) => patchRules('binaryUnitsPerEvent', Number(event.target.value) || 0)} /></div>
                    <div className={styles.field}><label>Direct Referral Hand-off</label><select name="referralHookEnabled" className={styles.select} disabled={!editable} value={String(rules.referralHookEnabled)} onChange={(event) => patchRules('referralHookEnabled', event.target.value === 'true')}><option value="false">Disabled</option><option value="true">Enabled</option></select></div>
                    <div className={styles.field}><label>Referral Basis</label><select name="referralBasisMode" className={styles.select} disabled={!editable || !rules.referralHookEnabled} value={rules.referralBasisMode} onChange={(event) => patchRules('referralBasisMode', event.target.value)}><option value="PAYMENT_AMOUNT">Full Payment Amount</option><option value="REGISTRATION_ALLOCATION">Registration Allocation</option><option value="INSTALLMENT_ALLOCATION">Installment Allocation</option><option value="TOTAL_APPLIED_AMOUNT">Registration + Installment Applied</option></select></div>
                    <div className={styles.field}><label>Lucky Draw Eligibility</label><input className={styles.input} readOnly value="Installment token registry (automatic)" /></div>
                    <div className={styles.field}><label>Minimum Payment Amount (optional)</label><input name="minimumPaymentAmount" className={styles.input} inputMode="decimal" disabled={!editable} value={rules.minimumPaymentAmount ?? ''} onChange={(event) => patchRules('minimumPaymentAmount', event.target.value || null)} /></div>
                    <div className={styles.field}><label>Minimum Registration Allocation</label><input name="minimumRegistrationAllocation" className={styles.input} inputMode="decimal" disabled={!editable} value={rules.minimumRegistrationAllocation ?? ''} onChange={(event) => patchRules('minimumRegistrationAllocation', event.target.value || null)} /></div>
                    <div className={styles.field}><label>Minimum Installment Allocation</label><input name="minimumInstallmentAllocation" className={styles.input} inputMode="decimal" disabled={!editable} value={rules.minimumInstallmentAllocation ?? ''} onChange={(event) => patchRules('minimumInstallmentAllocation', event.target.value || null)} /></div>
                    <div className={styles.field}><label>Required Allocation Types</label><div className={extension.checkGrid}>{[['REGISTRATION_FEE', 'Registration Fee'], ['INSTALLMENT', 'Installment'], ['UNAPPLIED', 'Unapplied']].map(([value, label]) => <label className={styles.check} key={value}><input type="checkbox" disabled={!editable} checked={rules.requiredAllocationTypes.includes(value)} onChange={(event) => toggleAllocation(value, event.target.checked)} />{label}</label>)}</div></div>
                  </div>
                </div>
              </>}
            </WorkspaceTabs>

            <div className={styles.notice} style={{ marginTop: 14 }}>Season activation is blocked until the automatic-rule draft exists and every Season month has a prize schedule. Binary and Referral activation rules use the confirmed-payment filters above; monthly Lucky Draw eligibility is derived independently from the permanent 5-digit token for each confirmed installment.</div>
            <div className={styles.buttonLine}><button className={styles.button} disabled={busy || !editable}>{busy ? 'SAVING…' : 'SAVE ADVANCED SEASON POLICY'}</button></div>
          </form>
        ) : <div className={styles.empty}>Create a Season draft before configuring advanced rules.</div>}
      </div>
      {seasonId && recovery ? <div className={styles.card} style={{marginTop:16}}>
        <div className={styles.sectionHead}><div className={styles.sectionTitle}>
          <span className={styles.sectionIcon}>💰</span><div><h2>After-Draw Installment Reserve</h2>
          <small>Super Admin • versioned income reserve, fully-paid EMI auto-adjustment</small></div></div>
          <span className={styles.tag}>{recovery.current ? 'PUBLISHED v'+recovery.current.version : 'NOT PUBLISHED'}</span>
        </div>
        <div className={styles.notice}>Recovery begins only from the calendar day <b>after the configured draw</b> when the next eligible installment remains unpaid. Percentage applies only to newly posted earnings, not historical wallet balance. The amount is capped at that EMI&apos;s remaining due. Fully recovered EMIs are paid automatically and linked to the permanent draw token.</div>
        <form method="post" onSubmit={saveRecovery}>
          <div className={styles.fields}>
            <div className={styles.field}><label htmlFor="installment-recovery-enabled">Recovery enabled</label>
              <select id="installment-recovery-enabled" className={styles.select} value={String(recoveryEnabled)} onChange={e=>setRecoveryEnabled(e.target.value==='true')}>
                <option value="true">Enabled</option><option value="false">Disabled for future earnings</option>
              </select>
            </div>
            <div className={styles.field}><label htmlFor="installment-recovery-percent">Reserve from each eligible earning (%)</label>
              <input id="installment-recovery-percent" className={styles.input} type="number" min="0" max="100" step="0.01" required
                value={recoveryPercent} onChange={e=>setRecoveryPercent(e.target.value)}/>
            </div>
          </div>
          <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>
            {busy?'SAVING…':'PUBLISH NEW RECOVERY POLICY VERSION'}</button></div>
        </form>
      </div> : null}
    </section>
  );
}
