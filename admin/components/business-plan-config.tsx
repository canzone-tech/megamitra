'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Row = Record<string, unknown>;
type NamedPolicy = Row & { versions?: Row[] };
type DomainKey = 'program' | 'binary' | 'referral' | 'orchestration' | 'draw';
type HookResponse = { configured: boolean; binding: Row | null };

type ConfigData = {
  programs: NamedPolicy[];
  binaryPlans: NamedPolicy[];
  referrals: NamedPolicy[];
  orchestration: Row[];
  draws: NamedPolicy[];
  entitlements: NamedPolicy[];
};

const DOMAIN_LABELS: Record<DomainKey, string> = {
  program: 'Program',
  binary: 'Binary',
  referral: 'Referral',
  orchestration: 'Orchestration',
  draw: 'Lucky draw',
};

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function date(value: unknown): string {
  if (typeof value !== 'string') return text(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function iso(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(Date.now() - 60_000).toISOString();
}

function optionalIso(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function latestVersion(policy: NamedPolicy | undefined): Row | undefined {
  const versions = policy?.versions ?? [];
  return versions.length ? versions[versions.length - 1] : undefined;
}

function lifecycleTone(value: unknown): string {
  const status = text(value).toUpperCase();
  if (status === 'PUBLISHED') return 'success';
  if (status === 'DRAFT') return 'warning';
  return '';
}

function versionSummary(domain: DomainKey, row: Row): string {
  if (domain === 'program') {
    return `${text(row.currencyCode)} ${text(row.installmentAmount)} × ${text(row.installmentCount)} installments · registration ${text(row.registrationFee)}`;
  }
  if (domain === 'binary') {
    return `${text(row.leftVolumePerPair)} : ${text(row.rightVolumePerPair)} pair · ${text(row.currencyCode)} ${text(row.pairPayoutAmount)} payout · daily cap ${text(row.dailyPairCap)}`;
  }
  if (domain === 'referral') {
    return row.rewardMode === 'PERCENTAGE'
      ? `${text(row.percentageRate)}% · ${text(row.currencyCode)} · ${text(row.roundingMode)}`
      : `${text(row.currencyCode)} ${text(row.fixedAmount)} fixed · ${text(row.roundingMode)}`;
  }
  if (domain === 'draw') {
    const tiers = Array.isArray(row.prizeTiers) ? row.prizeTiers : [];
    const winners = tiers.reduce((total, tier) => {
      const value = tier && typeof tier === 'object' ? Number((tier as Row).winnerCount ?? 0) : 0;
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
    return `${text(row.entryMode)} · ${tiers.length} tier(s) · ${winners} configured winner(s)`;
  }
  return `${text(row.triggerType)} · binary units ${text(row.binaryUnitsPerEvent)} · referral ${bool(row.referralHookEnabled) ? 'on' : 'off'} · draw ${bool(row.drawEligibilityHookEnabled) ? 'on' : 'off'}`;
}

function versionTemplate(domain: DomainKey, row?: Row): Record<string, unknown> {
  const effectiveFrom = iso(row?.effectiveFrom);
  const effectiveTo = optionalIso(row?.effectiveTo);
  if (domain === 'program') {
    return {
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      currencyCode: text(row?.currencyCode) === '—' ? 'INR' : text(row?.currencyCode),
      registrationFee: text(row?.registrationFee) === '—' ? '0.00' : text(row?.registrationFee),
      installmentAmount: text(row?.installmentAmount) === '—' ? '0.00' : text(row?.installmentAmount),
      installmentCount: Number(row?.installmentCount ?? 0),
      installmentIntervalUnit: text(row?.installmentIntervalUnit) === '—' ? 'MONTH' : text(row?.installmentIntervalUnit),
      installmentIntervalCount: Number(row?.installmentIntervalCount ?? 1),
      firstInstallmentOffsetDays: Number(row?.firstInstallmentOffsetDays ?? 0),
      gracePeriodDays: Number(row?.gracePeriodDays ?? 0),
      ...(row?.maxActiveEnrollmentsPerUser ? { maxActiveEnrollmentsPerUser: Number(row.maxActiveEnrollmentsPerUser) } : {}),
      partialPaymentsAllowed: bool(row?.partialPaymentsAllowed),
      overpaymentsAllowed: bool(row?.overpaymentsAllowed),
      eligibilityRules: objectValue(row?.eligibilityRules),
    };
  }
  if (domain === 'binary') {
    return {
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      qualifyingUnit: text(row?.qualifyingUnit) === '—' ? '1.0000' : text(row?.qualifyingUnit),
      leftVolumePerPair: text(row?.leftVolumePerPair) === '—' ? '1.0000' : text(row?.leftVolumePerPair),
      rightVolumePerPair: text(row?.rightVolumePerPair) === '—' ? '1.0000' : text(row?.rightVolumePerPair),
      pairPayoutAmount: text(row?.pairPayoutAmount) === '—' ? '0.00' : text(row?.pairPayoutAmount),
      currencyCode: text(row?.currencyCode) === '—' ? 'INR' : text(row?.currencyCode),
      settlementTimezone: text(row?.settlementTimezone) === '—' ? 'Asia/Kolkata' : text(row?.settlementTimezone),
      capOverflowMode: text(row?.capOverflowMode) === '—' ? 'CARRY' : text(row?.capOverflowMode),
      ...(row?.dailyPairCap !== null && row?.dailyPairCap !== undefined ? { dailyPairCap: Number(row.dailyPairCap) } : {}),
      ...(row?.monthlyPairCap !== null && row?.monthlyPairCap !== undefined ? { monthlyPairCap: Number(row.monthlyPairCap) } : {}),
      carryForwardEnabled: row ? bool(row.carryForwardEnabled) : true,
      ...(row?.carryForwardExpiryDays ? { carryForwardExpiryDays: Number(row.carryForwardExpiryDays) } : {}),
      qualificationRules: objectValue(row?.qualificationRules),
      settlementRules: objectValue(row?.settlementRules),
    };
  }
  if (domain === 'referral') {
    const rewardMode = text(row?.rewardMode) === '—' ? 'FIXED' : text(row?.rewardMode);
    return {
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      rewardMode,
      ...(rewardMode === 'PERCENTAGE'
        ? { percentageRate: text(row?.percentageRate) === '—' ? '0.0000' : text(row?.percentageRate) }
        : { fixedAmount: text(row?.fixedAmount) === '—' ? '0.00' : text(row?.fixedAmount) }),
      currencyCode: text(row?.currencyCode) === '—' ? 'INR' : text(row?.currencyCode),
      roundingMode: text(row?.roundingMode) === '—' ? 'HALF_UP' : text(row?.roundingMode),
      ...(row?.minimumRewardAmount !== null && row?.minimumRewardAmount !== undefined ? { minimumRewardAmount: text(row.minimumRewardAmount) } : {}),
      ...(row?.maximumRewardAmount !== null && row?.maximumRewardAmount !== undefined ? { maximumRewardAmount: text(row.maximumRewardAmount) } : {}),
      eligibilityRules: objectValue(row?.eligibilityRules),
    };
  }
  if (domain === 'draw') {
    const rawTiers = Array.isArray(row?.prizeTiers) ? row.prizeTiers : [];
    const prizeTiers = rawTiers.length
      ? rawTiers.map((tierValue) => {
          const tier = tierValue && typeof tierValue === 'object' ? (tierValue as Row) : {};
          return {
            code: text(tier.code),
            name: text(tier.name),
            winnerCount: Number(tier.winnerCount ?? 1),
            prizeKind: text(tier.prizeKind),
            ...(tier.cashAmount !== null && tier.cashAmount !== undefined ? { cashAmount: text(tier.cashAmount) } : {}),
            ...(tier.currencyCode ? { currencyCode: text(tier.currencyCode) } : {}),
            ...(tier.prizeDefinition ? { prizeDefinition: objectValue(tier.prizeDefinition) } : {}),
          };
        })
      : [{ code: 'BENEFIT', name: 'Configured benefit', winnerCount: 1, prizeKind: 'BENEFIT', prizeDefinition: {} }];
    return {
      programVersionId: row?.programVersionId ? text(row.programVersionId) : '',
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      entryMode: text(row?.entryMode) === '—' ? 'ONE_PER_USER' : text(row?.entryMode),
      priorWinnerMode: text(row?.priorWinnerMode) === '—' ? 'DISALLOW_WITHIN_POLICY' : text(row?.priorWinnerMode),
      allowMultipleWinsPerDraw: bool(row?.allowMultipleWinsPerDraw),
      insufficientEntrantsMode: text(row?.insufficientEntrantsMode) === '—' ? 'DRAW_AVAILABLE' : text(row?.insufficientEntrantsMode),
      prizeTiers,
    };
  }
  return {
    programVersionId: row?.programVersionId ? text(row.programVersionId) : '',
    triggerType: text(row?.triggerType) === '—' ? 'PAYMENT_CONFIRMED' : text(row?.triggerType),
    effectiveFrom,
    ...(effectiveTo ? { effectiveTo } : {}),
    ...(row?.binaryPlanVersionId ? { binaryPlanVersionId: text(row.binaryPlanVersionId) } : {}),
    binaryUnitsPerEvent: Number(row?.binaryUnitsPerEvent ?? 0),
    referralHookEnabled: bool(row?.referralHookEnabled),
    ...(row?.referralPolicyVersionId ? { referralPolicyVersionId: text(row.referralPolicyVersionId) } : {}),
    ...(row?.referralBasisMode ? { referralBasisMode: text(row.referralBasisMode) } : {}),
    drawEligibilityHookEnabled: bool(row?.drawEligibilityHookEnabled),
    eligibilityRules: objectValue(row?.eligibilityRules),
  };
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Configuration payload must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function BusinessPlanConfig() {
  const router = useRouter();
  const [data, setData] = useState<ConfigData | null>(null);
  const [domain, setDomain] = useState<DomainKey>('program');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedOrchestrationId, setSelectedOrchestrationId] = useState('');
  const [editorText, setEditorText] = useState('');
  const [shellCode, setShellCode] = useState('');
  const [shellName, setShellName] = useState('');
  const [shellDescription, setShellDescription] = useState('');
  const [hook, setHook] = useState<HookResponse | null>(null);
  const [hookPolicyVersionId, setHookPolicyVersionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [programs, binaryPlans, referrals, orchestration, draws, entitlements] = await Promise.all([
        apiJson<NamedPolicy[]>('/api/backend/admin/programs'),
        apiJson<NamedPolicy[]>('/api/backend/admin/binary-plans'),
        apiJson<NamedPolicy[]>('/api/backend/admin/referral-reward-policies'),
        apiJson<Row[]>('/api/backend/admin/program-orchestration/policies'),
        apiJson<NamedPolicy[]>('/api/backend/admin/lucky-draw-policies'),
        apiJson<NamedPolicy[]>('/api/backend/admin/entitlements/policies'),
      ]);
      const next = { programs, binaryPlans, referrals, orchestration, draws, entitlements };
      setData(next);
      setSelectedParentId((current) => current || String(programs[0]?.id ?? ''));
      setSelectedOrchestrationId((current) => current || String(orchestration[0]?.id ?? ''));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      if (reason instanceof ApiClientError && reason.status === 403 && reason.message.toLowerCase().includes('password')) {
        router.replace('/change-password');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load business plan configuration');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const namedItems = useMemo(() => {
    if (!data) return [] as NamedPolicy[];
    if (domain === 'program') return data.programs;
    if (domain === 'binary') return data.binaryPlans;
    if (domain === 'referral') return data.referrals;
    if (domain === 'draw') return data.draws;
    return [] as NamedPolicy[];
  }, [data, domain]);

  const selectedParent = useMemo(
    () => namedItems.find((item) => String(item.id) === selectedParentId),
    [namedItems, selectedParentId],
  );
  const selectedOrchestration = useMemo(
    () => data?.orchestration.find((item) => String(item.id) === selectedOrchestrationId),
    [data, selectedOrchestrationId],
  );
  const versions = domain === 'orchestration' ? data?.orchestration ?? [] : selectedParent?.versions ?? [];

  const refreshHook = useCallback(async (policyId: string) => {
    if (!policyId) return;
    try {
      const next = await apiJson<HookResponse>(`/api/backend/admin/program-orchestration/policies/${policyId}/entitlement-hook`);
      setHook(next);
      setHookPolicyVersionId(next.binding?.entitlementPolicyVersionId ? String(next.binding.entitlementPolicyVersionId) : '');
    } catch (reason) {
      setHook(null);
      setHookPolicyVersionId('');
      if (reason instanceof ApiClientError && reason.status !== 404) {
        setError(reason.message);
      }
    }
  }, []);

  useEffect(() => {
    if (domain !== 'orchestration' || !selectedOrchestrationId) return;
    const timer = window.setTimeout(() => void refreshHook(selectedOrchestrationId), 0);
    return () => window.clearTimeout(timer);
  }, [domain, refreshHook, selectedOrchestrationId]);

  function switchDomain(next: DomainKey) {
    setDomain(next);
    setEditorText('');
    setError('');
    setMessage('');
    setHook(null);
    setHookPolicyVersionId('');
    if (!data) return;
    if (next === 'program') setSelectedParentId(String(data.programs[0]?.id ?? ''));
    if (next === 'binary') setSelectedParentId(String(data.binaryPlans[0]?.id ?? ''));
    if (next === 'referral') setSelectedParentId(String(data.referrals[0]?.id ?? ''));
    if (next === 'draw') setSelectedParentId(String(data.draws[0]?.id ?? ''));
    if (next === 'orchestration') setSelectedOrchestrationId(String(data.orchestration[0]?.id ?? ''));
  }

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successMessage);
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : reason instanceof Error ? reason.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  function loadTemplate() {
    const source = domain === 'orchestration' ? selectedOrchestration : latestVersion(selectedParent);
    setEditorText(JSON.stringify(versionTemplate(domain, source), null, 2));
    setError('');
  }

  async function createShell(event: React.FormEvent) {
    event.preventDefault();
    if (domain === 'orchestration') return;
    const path = domain === 'program'
      ? '/api/backend/admin/programs'
      : domain === 'binary'
        ? '/api/backend/admin/binary-plans'
        : domain === 'referral'
          ? '/api/backend/admin/referral-reward-policies'
          : '/api/backend/admin/lucky-draw-policies';
    await runAction(async () => {
      const created = await apiJson<Row>(path, {
        method: 'POST',
        body: JSON.stringify({ code: shellCode, name: shellName, ...(shellDescription ? { description: shellDescription } : {}) }),
      });
      setSelectedParentId(String(created.id));
      setShellCode('');
      setShellName('');
      setShellDescription('');
      setEditorText('');
    }, `${DOMAIN_LABELS[domain]} policy shell created.`);
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    const payload = parsePayload(editorText);
    const path = domain === 'program'
      ? `/api/backend/admin/programs/${selectedParentId}/versions`
      : domain === 'binary'
        ? `/api/backend/admin/binary-plans/${selectedParentId}/versions`
        : domain === 'referral'
          ? `/api/backend/admin/referral-reward-policies/${selectedParentId}/versions`
          : domain === 'draw'
            ? `/api/backend/admin/lucky-draw-policies/${selectedParentId}/versions`
            : '/api/backend/admin/program-orchestration/policies';
    if (domain !== 'orchestration' && !selectedParentId) {
      setError(`Choose a ${DOMAIN_LABELS[domain].toLowerCase()} policy first.`);
      return;
    }
    await runAction(async () => {
      const created = await apiJson<Row>(path, { method: 'POST', body: JSON.stringify(payload) });
      if (domain === 'orchestration' && created.id) setSelectedOrchestrationId(String(created.id));
      setEditorText('');
    }, `${DOMAIN_LABELS[domain]} draft created and awaiting publish.`);
  }

  function lifecyclePath(versionId: string, action: 'publish' | 'retire') {
    if (domain === 'program') return `/api/backend/admin/programs/versions/${versionId}/${action}`;
    if (domain === 'binary') return `/api/backend/admin/binary-plans/versions/${versionId}/${action}`;
    if (domain === 'referral') return `/api/backend/admin/referral-reward-policies/versions/${versionId}/${action}`;
    if (domain === 'draw') return `/api/backend/admin/lucky-draw-policies/versions/${versionId}/${action}`;
    return `/api/backend/admin/program-orchestration/policies/${versionId}/${action}`;
  }

  async function changeLifecycle(version: Row, action: 'publish' | 'retire') {
    const label = action === 'publish' ? 'Publish' : 'Retire';
    if (!window.confirm(`${label} ${DOMAIN_LABELS[domain]} version ${text(version.version)}? Published history is immutable.`)) return;
    await runAction(async () => {
      await apiJson(lifecyclePath(String(version.id), action), { method: 'POST' });
    }, `${DOMAIN_LABELS[domain]} version ${action === 'publish' ? 'published' : 'retired'}.`);
  }

  async function configureHook(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOrchestrationId || !hookPolicyVersionId) {
      setError('Choose a draft orchestration policy and published entitlement policy version.');
      return;
    }
    await runAction(async () => {
      await apiJson(`/api/backend/admin/program-orchestration/policies/${selectedOrchestrationId}/entitlement-hook`, {
        method: 'PUT',
        body: JSON.stringify({ entitlementPolicyVersionId: hookPolicyVersionId }),
      });
      await refreshHook(selectedOrchestrationId);
    }, 'Entitlement automation hook configured.');
  }

  async function removeHook() {
    if (!selectedOrchestrationId || !window.confirm('Remove the entitlement automation hook from this draft orchestration policy?')) return;
    await runAction(async () => {
      await apiJson(`/api/backend/admin/program-orchestration/policies/${selectedOrchestrationId}/entitlement-hook`, { method: 'DELETE' });
      await refreshHook(selectedOrchestrationId);
    }, 'Entitlement automation hook removed.');
  }

  async function logout() {
    await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const stats = data
    ? [
        ['Programs', data.programs.length],
        ['Binary plans', data.binaryPlans.length],
        ['Referral policies', data.referrals.length],
        ['Event policies', data.orchestration.length],
        ['Draw policies', data.draws.length],
        ['Entitlement policies', data.entitlements.length],
      ] as const
    : [];

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">Mitra</span></div><div className="mm-brand-subtitle">Business plan configuration</div></div></div>
        <nav className="mm-config-actions"><Link className="mm-button secondary" href="/operations">Operations</Link><Link className="mm-button secondary" href="/entitlements">Entitlements</Link><Link className="mm-button secondary" href="/security">Security</Link><button className="mm-button secondary" type="button" onClick={() => void logout()}>Sign out</button></nav>
      </header>

      <main className="mm-page">
        <div className="mm-hero-row">
          <div><p className="mm-eyebrow">Versioned business truth</p><h1 className="mm-title">Business plan control</h1><p className="mm-subtitle">Manage the existing program, binary, referral, orchestration and lucky-draw policy engines without changing code. New rules are drafts first; published history stays immutable.</p></div>
          <button className="mm-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh configuration'}</button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {message ? <div className="mm-success" role="status">{message}</div> : null}

        {data ? <div className="mm-grid stats" style={{ marginBottom: 20 }}>{stats.map(([label, value]) => <div className="mm-card mm-stat" key={label}><div className="mm-stat-label">{label}</div><div className="mm-stat-value">{value}</div></div>)}</div> : null}

        <div className="mm-tabs" role="tablist" aria-label="Business policy domains">
          {(Object.keys(DOMAIN_LABELS) as DomainKey[]).map((key) => <button className={`mm-tab ${domain === key ? 'active' : ''}`} type="button" role="tab" aria-selected={domain === key} onClick={() => switchDomain(key)} key={key}>{DOMAIN_LABELS[key]}</button>)}
        </div>

        {data ? (
          <div className="mm-config-layout">
            <section className="mm-card">
              <div className="mm-card-head"><h2>{DOMAIN_LABELS[domain]} configuration</h2><span className="mm-chip">DRAFT → PUBLISHED → RETIRED</span></div>
              <div className="mm-card-body">
                {domain !== 'orchestration' ? (
                  <label className="mm-field">Policy / plan<select className="mm-input" value={selectedParentId} onChange={(event) => { setSelectedParentId(event.target.value); setEditorText(''); }}><option value="">Choose configuration</option>{namedItems.map((item) => <option value={String(item.id)} key={String(item.id)}>{text(item.code)} · {text(item.name)}</option>)}</select></label>
                ) : (
                  <label className="mm-field">Event policy<select className="mm-input" value={selectedOrchestrationId} onChange={(event) => { setSelectedOrchestrationId(event.target.value); setEditorText(''); setHook(null); setHookPolicyVersionId(''); }}><option value="">Choose event policy</option>{data.orchestration.map((item) => <option value={String(item.id)} key={String(item.id)}>{text(item.triggerType)} · v{text(item.version)} · {text(item.lifecycle)}</option>)}</select></label>
                )}

                <div className="mm-list">
                  {versions.length ? versions.map((version) => <div className="mm-list-row" key={String(version.id)}><div><strong>v{text(version.version)} · {text(version.lifecycle)}</strong><br /><span>{versionSummary(domain, version)}</span><br /><span>Effective {date(version.effectiveFrom)}{version.effectiveTo ? ` → ${date(version.effectiveTo)}` : ' onward'}</span></div><div className="mm-config-actions"><span className={`mm-chip ${lifecycleTone(version.lifecycle)}`}>{text(version.lifecycle)}</span>{version.lifecycle === 'DRAFT' ? <button className="mm-button" disabled={busy} type="button" onClick={() => void changeLifecycle(version, 'publish')}>Publish</button> : null}{version.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void changeLifecycle(version, 'retire')}>Retire</button> : null}</div></div>) : <div className="mm-empty">No versions recorded for this selection.</div>}
                </div>
              </div>
            </section>

            <div className="mm-grid">
              {domain !== 'orchestration' ? <section className="mm-card"><div className="mm-card-head"><h2>New policy shell</h2><span className="mm-chip">Optional</span></div><form className="mm-card-body mm-form" onSubmit={(event) => void createShell(event)}><label>Code<input value={shellCode} onChange={(event) => setShellCode(event.target.value)} required /></label><label>Name<input value={shellName} onChange={(event) => setShellName(event.target.value)} required /></label><label>Description<textarea rows={2} value={shellDescription} onChange={(event) => setShellDescription(event.target.value)} /></label><button className="mm-button" disabled={busy} type="submit">Create {DOMAIN_LABELS[domain].toLowerCase()} shell</button></form></section> : null}

              <section className="mm-card"><div className="mm-card-head"><h2>Create next draft</h2><button className="mm-button secondary" disabled={busy || (domain !== 'orchestration' && !selectedParentId)} type="button" onClick={loadTemplate}>Copy current values</button></div><form className="mm-card-body mm-form" onSubmit={(event) => void createDraft(event)}><p className="mm-note">The payload is validated by the same backend DTO and business-rule checks used by every API client. Edit only the values you intend to version.</p><label>Validated configuration payload<textarea className="mm-json" rows={16} spellCheck={false} value={editorText} onChange={(event) => setEditorText(event.target.value)} placeholder="Use “Copy current values” to start from the latest version." required /></label><button className="mm-button" disabled={busy || !editorText} type="submit">Create DRAFT</button></form></section>

              {domain === 'orchestration' ? <section className="mm-card"><div className="mm-card-head"><h2>Automatic entitlement hook</h2><span className={`mm-chip ${hook?.configured ? 'success' : 'warning'}`}>{hook?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span></div><form className="mm-card-body mm-form" onSubmit={(event) => void configureHook(event)}><p className="mm-note">Attach a published entitlement policy version to a DRAFT event policy. The binding becomes immutable when the orchestration policy is published.</p><label>Published entitlement policy version ID<input value={hookPolicyVersionId} onChange={(event) => setHookPolicyVersionId(event.target.value)} required /></label>{hook?.binding ? <div className="mm-code">{text(hook.binding.entitlementPolicyCode)} v{text(hook.binding.entitlementPolicyVersion)} · {text(hook.binding.entitlementPolicyName)}</div> : null}<div className="mm-config-actions"><button className="mm-button" disabled={busy || selectedOrchestration?.lifecycle !== 'DRAFT'} type="submit">Save hook</button><button className="mm-button secondary" disabled={busy || !hook?.configured || selectedOrchestration?.lifecycle !== 'DRAFT'} type="button" onClick={() => void removeHook()}>Remove hook</button></div></form></section> : null}

              <section className="mm-card"><div className="mm-card-head"><h2>Consumer product entitlement rules</h2><span className="mm-chip">{data.entitlements.length} policies</span></div><div className="mm-card-body"><p className="mm-note">Product catalog, non-winner eligibility, claim windows and fulfillment already have a dedicated control surface.</p><Link className="mm-button" href="/entitlements">Open entitlement control</Link></div></section>
            </div>
          </div>
        ) : loading ? <div className="mm-card mm-empty">Loading MegaGoldenClub business configuration…</div> : null}
      </main>
    </div>
  );
}
