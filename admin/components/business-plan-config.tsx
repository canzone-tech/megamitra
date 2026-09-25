'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import {
  BusinessPlanDraftForm,
  type BusinessPlanFormOptions,
  type DomainKey,
  type DraftValues,
  type Row,
  type SelectOption,
} from '@/components/business-plan-forms';

type NamedPolicy = Row & { versions?: Row[] };
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
  program: 'Membership plan',
  binary: 'Pair income',
  referral: 'Referral reward',
  orchestration: 'Automatic rules',
  draw: 'Lucky draw',
};

const DOMAIN_DESCRIPTIONS: Record<DomainKey, string> = {
  program: 'Set joining fee, recurring payment, duration and payment flexibility.',
  binary: 'Set left/right matching, pair income, limits and carry-forward.',
  referral: 'Set the amount or percentage paid for a qualifying direct referral.',
  orchestration: 'Choose what should happen automatically when members join, pay, finish or receive a refund.',
  draw: 'Set who can enter, repeat-winner rules and prizes.',
};

function text(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function latestVersion(policy: NamedPolicy | undefined): Row | undefined {
  const versions = policy?.versions ?? [];
  return versions.length ? versions[versions.length - 1] : undefined;
}

function date(value: unknown): string {
  if (typeof value !== 'string') return text(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function toLocalInput(value?: unknown): string {
  const parsed = value ? new Date(String(value)) : new Date(Date.now() - 60_000);
  const safe = Number.isFinite(parsed.getTime()) ? parsed : new Date(Date.now() - 60_000);
  const adjusted = new Date(safe.getTime() - safe.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function toIso(value: unknown): string {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error('Choose a valid start date and time.');
  return parsed.toISOString();
}

function optionalIso(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error('Choose a valid end date and time.');
  return parsed.toISOString();
}

function optionalInt(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function internalCode(value: string, suffix = ''): string {
  const base = value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'PLAN';
  return suffix ? `${base}_${suffix}`.slice(0, 50) : base.slice(0, 50);
}

function triggerLabel(value: unknown): string {
  const labels: Record<string, string> = {
    ENROLLMENT_CREATED: 'Member joins',
    PAYMENT_CONFIRMED: 'Payment confirmed',
    PAYMENT_FAILED: 'Payment failed',
    REFUND_CONFIRMED: 'Refund confirmed',
    ENROLLMENT_COMPLETED: 'Membership completed',
    ENROLLMENT_REOPENED: 'Membership reopened',
  };
  return labels[text(value, '')] ?? text(value);
}

function lifecycleLabel(value: unknown): string {
  const status = text(value, '').toUpperCase();
  if (status === 'PUBLISHED') return 'LIVE';
  if (status === 'DRAFT') return 'DRAFT CHANGES';
  if (status === 'RETIRED') return 'PREVIOUS';
  return status || 'UNKNOWN';
}

function lifecycleTone(value: unknown): string {
  const status = text(value, '').toUpperCase();
  if (status === 'PUBLISHED') return 'success';
  if (status === 'DRAFT') return 'warning';
  return '';
}

function versionSummary(domain: DomainKey, row: Row): string {
  if (domain === 'program') return `${text(row.currencyCode)} ${text(row.registrationFee)} joining · ${text(row.installmentCount)} × ${text(row.currencyCode)} ${text(row.installmentAmount)}`;
  if (domain === 'binary') return `${text(row.leftVolumePerPair)} : ${text(row.rightVolumePerPair)} matching · ${text(row.currencyCode)} ${text(row.pairPayoutAmount)} per pair${row.dailyPairCap !== null && row.dailyPairCap !== undefined ? ` · ${text(row.dailyPairCap)} pairs/day` : ''}`;
  if (domain === 'referral') return row.rewardMode === 'PERCENTAGE' ? `${text(row.percentageRate)}% direct-referral reward` : `${text(row.currencyCode)} ${text(row.fixedAmount)} direct-referral reward`;
  if (domain === 'draw') {
    const tiers = Array.isArray(row.prizeTiers) ? row.prizeTiers : [];
    const winners = tiers.reduce((sum, tier) => sum + Number(tier && typeof tier === 'object' ? (tier as Row).winnerCount ?? 0 : 0), 0);
    return `${tiers.length} prize type(s) · ${winners} winner(s) configured`;
  }
  return `${triggerLabel(row.triggerType)} · pair income ${row.binaryPlanVersionId ? 'on' : 'off'} · referral ${bool(row.referralHookEnabled) ? 'on' : 'off'} · lucky draw ${bool(row.drawEligibilityHookEnabled) ? 'on' : 'off'}`;
}

function draftValues(domain: DomainKey, row?: Row): DraftValues {
  const effectiveFrom = toLocalInput(row?.effectiveFrom);
  const effectiveTo = row?.effectiveTo ? toLocalInput(row.effectiveTo) : '';
  if (domain === 'program') return {
    effectiveFrom, effectiveTo, currencyCode: text(row?.currencyCode, 'INR'), registrationFee: text(row?.registrationFee, '0.00'), installmentAmount: text(row?.installmentAmount, '0.00'),
    installmentCount: Number(row?.installmentCount ?? 18), installmentIntervalUnit: text(row?.installmentIntervalUnit, 'MONTH'), installmentIntervalCount: Number(row?.installmentIntervalCount ?? 1),
    firstInstallmentOffsetDays: Number(row?.firstInstallmentOffsetDays ?? 0), gracePeriodDays: Number(row?.gracePeriodDays ?? 0), maxActiveEnrollmentsPerUser: row?.maxActiveEnrollmentsPerUser ?? '',
    partialPaymentsAllowed: bool(row?.partialPaymentsAllowed), overpaymentsAllowed: bool(row?.overpaymentsAllowed), eligibilityRules: objectValue(row?.eligibilityRules),
  };
  if (domain === 'binary') return {
    effectiveFrom, effectiveTo, qualifyingUnit: text(row?.qualifyingUnit, '1.0000'), leftVolumePerPair: text(row?.leftVolumePerPair, '1.0000'), rightVolumePerPair: text(row?.rightVolumePerPair, '1.0000'),
    pairPayoutAmount: text(row?.pairPayoutAmount, '0.00'), currencyCode: text(row?.currencyCode, 'INR'), settlementTimezone: text(row?.settlementTimezone, 'Asia/Kolkata'), capOverflowMode: text(row?.capOverflowMode, 'CARRY'),
    dailyPairCap: row?.dailyPairCap ?? '', monthlyPairCap: row?.monthlyPairCap ?? '', carryForwardEnabled: row ? bool(row.carryForwardEnabled) : true, carryForwardExpiryDays: row?.carryForwardExpiryDays ?? '',
    qualificationRules: objectValue(row?.qualificationRules), settlementRules: objectValue(row?.settlementRules),
  };
  if (domain === 'referral') return {
    effectiveFrom, effectiveTo, rewardMode: text(row?.rewardMode, 'FIXED'), fixedAmount: text(row?.fixedAmount, '0.00'), percentageRate: text(row?.percentageRate, '0.0000'),
    currencyCode: text(row?.currencyCode, 'INR'), roundingMode: text(row?.roundingMode, 'HALF_UP'), minimumRewardAmount: row?.minimumRewardAmount ?? '', maximumRewardAmount: row?.maximumRewardAmount ?? '',
    eligibilityRules: objectValue(row?.eligibilityRules),
  };
  if (domain === 'draw') {
    const rawTiers = Array.isArray(row?.prizeTiers) ? row.prizeTiers : [];
    return {
      programVersionId: text(row?.programVersionId, ''), effectiveFrom, effectiveTo, entryMode: text(row?.entryMode, 'ONE_PER_USER'), priorWinnerMode: text(row?.priorWinnerMode, 'DISALLOW_WITHIN_POLICY'),
      allowMultipleWinsPerDraw: bool(row?.allowMultipleWinsPerDraw), insufficientEntrantsMode: text(row?.insufficientEntrantsMode, 'DRAW_AVAILABLE'),
      prizeTiers: rawTiers.length ? rawTiers : [{ code: 'PRIZE_1', name: 'Prize 1', winnerCount: 1, prizeKind: 'ITEM', prizeDefinition: {} }],
    };
  }
  return {
    programVersionId: text(row?.programVersionId, ''), triggerType: text(row?.triggerType, 'PAYMENT_CONFIRMED'), effectiveFrom, effectiveTo,
    binaryPlanVersionId: text(row?.binaryPlanVersionId, ''), binaryUnitsPerEvent: Number(row?.binaryUnitsPerEvent ?? 0), referralHookEnabled: bool(row?.referralHookEnabled),
    referralPolicyVersionId: text(row?.referralPolicyVersionId, ''), referralBasisMode: text(row?.referralBasisMode, 'PAYMENT_AMOUNT'), drawEligibilityHookEnabled: bool(row?.drawEligibilityHookEnabled), eligibilityRules: objectValue(row?.eligibilityRules),
  };
}

function normalizeDraft(domain: DomainKey, value: DraftValues): Record<string, unknown> {
  const effectiveFrom = toIso(value.effectiveFrom);
  const effectiveTo = optionalIso(value.effectiveTo);
  if (domain === 'program') return {
    effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}), currencyCode: text(value.currencyCode, 'INR').toUpperCase(), registrationFee: text(value.registrationFee, '0.00'), installmentAmount: text(value.installmentAmount, '0.00'),
    installmentCount: Number(value.installmentCount ?? 0), installmentIntervalUnit: text(value.installmentIntervalUnit, 'MONTH'), installmentIntervalCount: Number(value.installmentIntervalCount ?? 1),
    firstInstallmentOffsetDays: Number(value.firstInstallmentOffsetDays ?? 0), gracePeriodDays: Number(value.gracePeriodDays ?? 0),
    ...(optionalInt(value.maxActiveEnrollmentsPerUser) ? { maxActiveEnrollmentsPerUser: optionalInt(value.maxActiveEnrollmentsPerUser) } : {}), partialPaymentsAllowed: bool(value.partialPaymentsAllowed), overpaymentsAllowed: bool(value.overpaymentsAllowed), eligibilityRules: objectValue(value.eligibilityRules),
  };
  if (domain === 'binary') return {
    effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}), qualifyingUnit: text(value.qualifyingUnit, '1.0000'), leftVolumePerPair: text(value.leftVolumePerPair, '1.0000'), rightVolumePerPair: text(value.rightVolumePerPair, '1.0000'),
    pairPayoutAmount: text(value.pairPayoutAmount, '0.00'), currencyCode: text(value.currencyCode, 'INR').toUpperCase(), settlementTimezone: text(value.settlementTimezone, 'Asia/Kolkata'), capOverflowMode: text(value.capOverflowMode, 'CARRY'),
    ...(optionalInt(value.dailyPairCap) !== undefined ? { dailyPairCap: optionalInt(value.dailyPairCap) } : {}), ...(optionalInt(value.monthlyPairCap) !== undefined ? { monthlyPairCap: optionalInt(value.monthlyPairCap) } : {}),
    carryForwardEnabled: bool(value.carryForwardEnabled), ...(optionalInt(value.carryForwardExpiryDays) ? { carryForwardExpiryDays: optionalInt(value.carryForwardExpiryDays) } : {}), qualificationRules: objectValue(value.qualificationRules), settlementRules: objectValue(value.settlementRules),
  };
  if (domain === 'referral') {
    const rewardMode = text(value.rewardMode, 'FIXED');
    return {
      effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}), rewardMode, ...(rewardMode === 'PERCENTAGE' ? { percentageRate: text(value.percentageRate, '0.0000') } : { fixedAmount: text(value.fixedAmount, '0.00') }),
      currencyCode: text(value.currencyCode, 'INR').toUpperCase(), roundingMode: text(value.roundingMode, 'HALF_UP'),
      ...(value.minimumRewardAmount !== '' && value.minimumRewardAmount !== undefined ? { minimumRewardAmount: text(value.minimumRewardAmount) } : {}),
      ...(value.maximumRewardAmount !== '' && value.maximumRewardAmount !== undefined ? { maximumRewardAmount: text(value.maximumRewardAmount) } : {}), eligibilityRules: objectValue(value.eligibilityRules),
    };
  }
  if (domain === 'draw') {
    const tiers = Array.isArray(value.prizeTiers) ? value.prizeTiers : [];
    if (!tiers.length) throw new Error('Add at least one lucky-draw prize.');
    return {
      programVersionId: text(value.programVersionId, ''), effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}), entryMode: text(value.entryMode, 'ONE_PER_USER'), priorWinnerMode: text(value.priorWinnerMode, 'DISALLOW_WITHIN_POLICY'),
      allowMultipleWinsPerDraw: bool(value.allowMultipleWinsPerDraw), insufficientEntrantsMode: text(value.insufficientEntrantsMode, 'DRAW_AVAILABLE'), prizeTiers: tiers.map((tierValue, index) => {
        const tier = tierValue && typeof tierValue === 'object' ? tierValue as Row : {};
        const kind = text(tier.prizeKind, 'ITEM');
        return { code: text(tier.code, internalCode(text(tier.name, `Prize ${index + 1}`), String(index + 1))), name: text(tier.name, `Prize ${index + 1}`), winnerCount: Math.max(1, Number(tier.winnerCount ?? 1)), prizeKind: kind,
          ...(kind === 'CASH' ? { cashAmount: text(tier.cashAmount, '0.00'), currencyCode: text(tier.currencyCode, 'INR').toUpperCase() } : {}), prizeDefinition: objectValue(tier.prizeDefinition) };
      }),
    };
  }
  return {
    programVersionId: text(value.programVersionId, ''), triggerType: text(value.triggerType, 'PAYMENT_CONFIRMED'), effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}),
    ...(value.binaryPlanVersionId ? { binaryPlanVersionId: text(value.binaryPlanVersionId), binaryUnitsPerEvent: Number(value.binaryUnitsPerEvent ?? 0) } : { binaryUnitsPerEvent: 0 }),
    referralHookEnabled: bool(value.referralHookEnabled), ...(bool(value.referralHookEnabled) ? { referralPolicyVersionId: text(value.referralPolicyVersionId), referralBasisMode: text(value.referralBasisMode, 'PAYMENT_AMOUNT') } : {}),
    drawEligibilityHookEnabled: bool(value.drawEligibilityHookEnabled), eligibilityRules: objectValue(value.eligibilityRules),
  };
}

function publishedOptions(items: NamedPolicy[]): SelectOption[] {
  return items.flatMap((policy) => (policy.versions ?? []).filter((version) => version.lifecycle === 'PUBLISHED').map((version) => ({ id: String(version.id), label: `${text(policy.name)} · live v${text(version.version)}` })));
}

function hasPublished(items: NamedPolicy[]): boolean {
  return items.some((policy) => (policy.versions ?? []).some((version) => version.lifecycle === 'PUBLISHED'));
}

export function BusinessPlanConfig() {
  const router = useRouter();
  const [data, setData] = useState<ConfigData | null>(null);
  const [domain, setDomain] = useState<DomainKey>('program');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedOrchestrationId, setSelectedOrchestrationId] = useState('');
  const [draft, setDraft] = useState<DraftValues>(() => draftValues('program'));
  const [shellName, setShellName] = useState('');
  const [shellDescription, setShellDescription] = useState('');
  const [hook, setHook] = useState<HookResponse | null>(null);
  const [hookPolicyVersionId, setHookPolicyVersionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [programs, binaryPlans, referrals, orchestration, draws, entitlements] = await Promise.all([
        apiJson<NamedPolicy[]>('/api/backend/admin/programs'), apiJson<NamedPolicy[]>('/api/backend/admin/binary-plans'), apiJson<NamedPolicy[]>('/api/backend/admin/referral-reward-policies'),
        apiJson<Row[]>('/api/backend/admin/program-orchestration/policies'), apiJson<NamedPolicy[]>('/api/backend/admin/lucky-draw-policies'), apiJson<NamedPolicy[]>('/api/backend/admin/entitlements/policies'),
      ]);
      setData({ programs, binaryPlans, referrals, orchestration, draws, entitlements });
      setSelectedParentId((current) => current || String(programs[0]?.id ?? ''));
      setSelectedOrchestrationId((current) => current || String(orchestration[0]?.id ?? ''));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) { router.replace('/login'); return; }
      if (reason instanceof ApiClientError && reason.status === 403 && reason.message.toLowerCase().includes('password')) { router.replace('/change-password'); return; }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load business settings');
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const namedItems = useMemo(() => {
    if (!data) return [] as NamedPolicy[];
    if (domain === 'program') return data.programs;
    if (domain === 'binary') return data.binaryPlans;
    if (domain === 'referral') return data.referrals;
    if (domain === 'draw') return data.draws;
    return [] as NamedPolicy[];
  }, [data, domain]);
  const selectedParent = useMemo(() => namedItems.find((item) => String(item.id) === selectedParentId), [namedItems, selectedParentId]);
  const selectedOrchestration = useMemo(() => data?.orchestration.find((item) => String(item.id) === selectedOrchestrationId), [data, selectedOrchestrationId]);
  const versions = domain === 'orchestration' ? (selectedOrchestration ? [selectedOrchestration] : []) : selectedParent?.versions ?? [];

  const formOptions = useMemo<BusinessPlanFormOptions>(() => ({
    programVersions: publishedOptions(data?.programs ?? []), binaryVersions: publishedOptions(data?.binaryPlans ?? []), referralVersions: publishedOptions(data?.referrals ?? []),
  }), [data]);
  const entitlementOptions = useMemo(() => publishedOptions(data?.entitlements ?? []), [data]);

  const refreshHook = useCallback(async (policyId: string) => {
    if (!policyId) { setHook(null); setHookPolicyVersionId(''); return; }
    try {
      const next = await apiJson<HookResponse>(`/api/backend/admin/program-orchestration/policies/${policyId}/entitlement-hook`);
      setHook(next); setHookPolicyVersionId(next.binding?.entitlementPolicyVersionId ? String(next.binding.entitlementPolicyVersionId) : '');
    } catch (reason) {
      setHook(null); setHookPolicyVersionId('');
      if (reason instanceof ApiClientError && reason.status !== 404) setError(reason.message);
    }
  }, []);

  useEffect(() => {
    if (domain !== 'orchestration') return;
    const timer = window.setTimeout(() => void refreshHook(selectedOrchestrationId), 0);
    return () => window.clearTimeout(timer);
  }, [domain, refreshHook, selectedOrchestrationId]);

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(successMessage); await load(); }
    catch (reason) { setError(reason instanceof ApiClientError ? reason.message : reason instanceof Error ? reason.message : 'Unable to save changes'); }
    finally { setBusy(false); }
  }

  function selectParent(id: string) {
    setSelectedParentId(id);
    const selected = namedItems.find((item) => String(item.id) === id);
    setDraft(draftValues(domain, latestVersion(selected)));
  }

  function selectAutomaticRule(id: string) {
    setSelectedOrchestrationId(id);
    const selected = data?.orchestration.find((item) => String(item.id) === id);
    setDraft(draftValues('orchestration', selected));
    setHook(null); setHookPolicyVersionId('');
  }

  function switchDomain(next: DomainKey) {
    setDomain(next); setError(''); setMessage(''); setHook(null); setHookPolicyVersionId('');
    if (!data) { setDraft(draftValues(next)); return; }
    if (next === 'orchestration') {
      const selected = data.orchestration[0];
      setSelectedOrchestrationId(String(selected?.id ?? ''));
      setDraft(draftValues(next, selected));
      return;
    }
    const items = next === 'program' ? data.programs : next === 'binary' ? data.binaryPlans : next === 'referral' ? data.referrals : data.draws;
    const selected = items[0];
    setSelectedParentId(String(selected?.id ?? ''));
    setDraft(draftValues(next, latestVersion(selected)));
  }

  async function createShell(event: React.FormEvent) {
    event.preventDefault();
    if (domain === 'orchestration' || shellName.trim().length < 2) return;
    const suffix = Date.now().toString(36).toUpperCase().slice(-5);
    const path = domain === 'program' ? '/api/backend/admin/programs' : domain === 'binary' ? '/api/backend/admin/binary-plans' : domain === 'referral' ? '/api/backend/admin/referral-reward-policies' : '/api/backend/admin/lucky-draw-policies';
    await runAction(async () => {
      const created = await apiJson<Row>(path, { method: 'POST', body: JSON.stringify({ code: internalCode(shellName, suffix), name: shellName.trim(), ...(shellDescription.trim() ? { description: shellDescription.trim() } : {}) }) });
      setSelectedParentId(String(created.id)); setShellName(''); setShellDescription(''); setDraft(draftValues(domain));
    }, `${DOMAIN_LABELS[domain]} created. Review the settings below and save a draft.`);
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    if (domain !== 'orchestration' && !selectedParentId) { setError(`Choose or create a ${DOMAIN_LABELS[domain].toLowerCase()} first.`); return; }
    const payload = normalizeDraft(domain, draft);
    const path = domain === 'program' ? `/api/backend/admin/programs/${selectedParentId}/versions` : domain === 'binary' ? `/api/backend/admin/binary-plans/${selectedParentId}/versions` : domain === 'referral' ? `/api/backend/admin/referral-reward-policies/${selectedParentId}/versions` : domain === 'draw' ? `/api/backend/admin/lucky-draw-policies/${selectedParentId}/versions` : '/api/backend/admin/program-orchestration/policies';
    await runAction(async () => {
      const created = await apiJson<Row>(path, { method: 'POST', body: JSON.stringify(payload) });
      if (domain === 'orchestration' && created.id) setSelectedOrchestrationId(String(created.id));
    }, 'Draft saved. Nothing is live until you publish it.');
  }

  function lifecyclePath(versionId: string, action: 'publish' | 'retire') {
    if (domain === 'program') return `/api/backend/admin/programs/versions/${versionId}/${action}`;
    if (domain === 'binary') return `/api/backend/admin/binary-plans/versions/${versionId}/${action}`;
    if (domain === 'referral') return `/api/backend/admin/referral-reward-policies/versions/${versionId}/${action}`;
    if (domain === 'draw') return `/api/backend/admin/lucky-draw-policies/versions/${versionId}/${action}`;
    return `/api/backend/admin/program-orchestration/policies/${versionId}/${action}`;
  }

  async function changeLifecycle(version: Row, action: 'publish' | 'retire') {
    const prompt = action === 'publish' ? 'Make these settings live now? Existing historical records will keep their original settings.' : 'Stop using this version for new business? Historical records will remain unchanged.';
    if (!window.confirm(prompt)) return;
    await runAction(async () => { await apiJson(lifecyclePath(String(version.id), action), { method: 'POST' }); }, action === 'publish' ? 'Settings are now live.' : 'This version is no longer used for new business.');
  }

  async function configureHook(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOrchestrationId || !hookPolicyVersionId) { setError('Choose a live product-benefit plan first.'); return; }
    await runAction(async () => {
      await apiJson(`/api/backend/admin/program-orchestration/policies/${selectedOrchestrationId}/entitlement-hook`, { method: 'PUT', body: JSON.stringify({ entitlementPolicyVersionId: hookPolicyVersionId }) });
      await refreshHook(selectedOrchestrationId);
    }, 'Product benefit automation saved.');
  }

  async function removeHook() {
    if (!selectedOrchestrationId || !window.confirm('Stop automatically creating product benefits for this rule?')) return;
    await runAction(async () => {
      await apiJson(`/api/backend/admin/program-orchestration/policies/${selectedOrchestrationId}/entitlement-hook`, { method: 'DELETE' });
      await refreshHook(selectedOrchestrationId);
    }, 'Product benefit automation removed.');
  }

  async function logout() { await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' }); router.replace('/login'); router.refresh(); }

  const setupCards = data ? [
    ['Membership', hasPublished(data.programs) ? 'LIVE' : data.programs.length ? 'DRAFT' : 'NOT SET'],
    ['Pair income', hasPublished(data.binaryPlans) ? 'LIVE' : data.binaryPlans.length ? 'DRAFT' : 'NOT SET'],
    ['Referral reward', hasPublished(data.referrals) ? 'LIVE' : data.referrals.length ? 'DRAFT' : 'NOT SET'],
    ['Automatic rules', data.orchestration.some((row) => row.lifecycle === 'PUBLISHED') ? 'LIVE' : data.orchestration.length ? 'DRAFT' : 'NOT SET'],
    ['Lucky draw', hasPublished(data.draws) ? 'LIVE' : data.draws.length ? 'DRAFT' : 'NOT SET'],
    ['Product benefits', hasPublished(data.entitlements) ? 'LIVE' : data.entitlements.length ? 'DRAFT' : 'NOT SET'],
  ] as const : [];

  return (
    <div className="mm-admin-shell">
      <header className="mm-topbar">
        <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">GoldenClub</span></div><div className="mm-brand-subtitle">Simple business setup</div></div></div>
        <nav className="mm-config-actions"><Link className="mm-button secondary" href="/operations">Dashboard</Link><Link className="mm-button secondary" href="/entitlements">Product benefits</Link><Link className="mm-button secondary" href="/security">Account security</Link><button className="mm-button secondary" type="button" onClick={() => void logout()}>Sign out</button></nav>
      </header>
      <main className="mm-page">
        <div className="mm-hero-row"><div><p className="mm-eyebrow">Owner settings</p><h1 className="mm-title">Business setup</h1><p className="mm-subtitle">Set membership fees, pair income, referral rewards, automatic actions and lucky draws using simple forms. No technical configuration is required.</p></div><button className="mm-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {message ? <div className="mm-success" role="status">{message}</div> : null}
        {data ? <div className="mm-grid stats" style={{ marginBottom: 20 }}>{setupCards.map(([label, value]) => <div className="mm-card mm-stat" key={label}><div className="mm-stat-label">{label}</div><div className="mm-stat-value" style={{ fontSize: '1rem' }}>{value}</div></div>)}</div> : null}
        <div className="mm-tabs" role="tablist" aria-label="Business settings">{(Object.keys(DOMAIN_LABELS) as DomainKey[]).map((key) => <button className={`mm-tab ${domain === key ? 'active' : ''}`} type="button" role="tab" aria-selected={domain === key} onClick={() => switchDomain(key)} key={key}>{DOMAIN_LABELS[key]}</button>)}</div>
        {data ? <div className="mm-config-layout">
          <section className="mm-card">
            <div className="mm-card-head"><div><h2>{DOMAIN_LABELS[domain]}</h2><p className="mm-note">{DOMAIN_DESCRIPTIONS[domain]}</p></div><span className="mm-chip">Draft first → publish when ready</span></div>
            <div className="mm-card-body">
              {domain !== 'orchestration' ? <label className="mm-field"><span>Choose saved plan</span><select className="mm-input" value={selectedParentId} onChange={(event) => selectParent(event.target.value)}><option value="">Choose plan</option>{namedItems.map((item) => <option value={String(item.id)} key={String(item.id)}>{text(item.name)}</option>)}</select></label> : <label className="mm-field"><span>Choose saved automatic rule</span><select className="mm-input" value={selectedOrchestrationId} onChange={(event) => selectAutomaticRule(event.target.value)}><option value="">Choose rule</option>{data.orchestration.map((item) => <option value={String(item.id)} key={String(item.id)}>{triggerLabel(item.triggerType)} · {lifecycleLabel(item.lifecycle).toLowerCase()}</option>)}</select></label>}
              <div className="mm-list" style={{ marginTop: 16 }}>{versions.length ? versions.map((version) => <div className="mm-list-row" key={String(version.id)}><div><strong>{lifecycleLabel(version.lifecycle)}</strong><br /><span>{versionSummary(domain, version)}</span><br /><span>From {date(version.effectiveFrom)}{version.effectiveTo ? ` until ${date(version.effectiveTo)}` : ''}</span></div><div className="mm-config-actions"><span className={`mm-chip ${lifecycleTone(version.lifecycle)}`}>{lifecycleLabel(version.lifecycle)}</span>{version.lifecycle === 'DRAFT' ? <button className="mm-button" disabled={busy} type="button" onClick={() => void changeLifecycle(version, 'publish')}>Make live</button> : null}{version.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" disabled={busy} type="button" onClick={() => void changeLifecycle(version, 'retire')}>Stop using</button> : null}</div></div>) : <div className="mm-empty">No saved settings yet.</div>}</div>
            </div>
          </section>
          <div className="mm-grid">
            {domain !== 'orchestration' ? <section className="mm-card"><div className="mm-card-head"><h2>Create another {DOMAIN_LABELS[domain].toLowerCase()}</h2><span className="mm-chip">Only when needed</span></div><form method="post" className="mm-card-body mm-form" onSubmit={(event) => void createShell(event)}><label>Plan name<input minLength={2} maxLength={120} value={shellName} onChange={(event) => setShellName(event.target.value)} required /></label><label>Short description (optional)<textarea rows={2} maxLength={500} value={shellDescription} onChange={(event) => setShellDescription(event.target.value)} /></label><button className="mm-button" disabled={busy} type="submit">Create plan</button></form></section> : null}
            <section className="mm-card"><div className="mm-card-head"><div><h2>{domain === 'orchestration' ? 'Set automatic rule' : 'Update settings'}</h2><p className="mm-note">Saving creates a draft. Customers are not affected until you choose “Make live”.</p></div><button className="mm-button secondary" disabled={busy || (domain !== 'orchestration' && !selectedParentId)} type="button" onClick={() => setDraft(draftValues(domain, domain === 'orchestration' ? selectedOrchestration : latestVersion(selectedParent)))}>Reset to current</button></div><form method="post" className="mm-card-body mm-form" onSubmit={(event) => void createDraft(event)}><BusinessPlanDraftForm domain={domain} value={draft} onChange={setDraft} options={formOptions} disabled={busy} /><button className="mm-button" disabled={busy || (domain !== 'orchestration' && !selectedParentId)} type="submit">Save draft</button></form></section>
            {domain === 'orchestration' && selectedOrchestrationId ? <section className="mm-card"><div className="mm-card-head"><h2>Product benefit after this event</h2><span className={`mm-chip ${hook?.configured ? 'success' : 'warning'}`}>{hook?.configured ? 'ON' : 'OFF'}</span></div><form method="post" className="mm-card-body mm-form" onSubmit={(event) => void configureHook(event)}><p className="mm-note">Optional: automatically create the member’s configured product benefit when this rule runs.</p><label>Product benefit plan<select value={hookPolicyVersionId} disabled={busy || selectedOrchestration?.lifecycle !== 'DRAFT'} onChange={(event) => setHookPolicyVersionId(event.target.value)} required><option value="">Choose live product benefit</option>{entitlementOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><div className="mm-config-actions"><button className="mm-button" disabled={busy || selectedOrchestration?.lifecycle !== 'DRAFT' || !hookPolicyVersionId} type="submit">Save benefit</button><button className="mm-button secondary" disabled={busy || !hook?.configured || selectedOrchestration?.lifecycle !== 'DRAFT'} type="button" onClick={() => void removeHook()}>Turn off</button></div></form></section> : null}
            <section className="mm-card"><div className="mm-card-head"><h2>Products & member benefits</h2><span className="mm-chip">{data.entitlements.length ? 'AVAILABLE' : 'NOT SET'}</span></div><div className="mm-card-body"><p className="mm-note">Manage product catalog, non-winner benefits, claim windows and delivery from the dedicated page.</p><Link className="mm-button" href="/entitlements">Open product benefits</Link></div></section>
          </div>
        </div> : loading ? <div className="mm-card mm-empty">Loading business settings…</div> : null}
      </main>
    </div>
  );
}
