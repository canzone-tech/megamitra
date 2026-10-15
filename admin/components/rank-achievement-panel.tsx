'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/client-api';
import styles from './owner-portal.module.css';

type RankTier = {
  code: string;
  name: string;
  newDirect: number;
  newTeam: number;
  hours: number;
  cash: string;
  monthly: string;
  months: number;
  trip: string | null;
};

type PolicyRow = {
  id: string;
  programVersionId: string;
  version: number;
  lifecycle: string;
  tiers: RankTier[];
  programVersion: { program: { code: string; name: string } };
};

type AchievementRow = {
  id: string;
  tierCode: string;
  tierName: string;
  achievedAt: string;
  deadlineAt: string;
  cashAmount: string;
  monthlyAmount: string;
  monthlyMonths: number;
  tripDescription: string | null;
  tripStatus: string;
  member: { username: string };
  monthlyPayouts: Array<{ id: string; sequence: number }>;
};

type Overview = {
  policies: PolicyRow[];
  achievements: AchievementRow[];
};
type ProgramRecord = {
  id: string;
  code: string;
  name: string;
  versions: Array<{ id: string; version: number; lifecycle: string; currencyCode: string }>;
};
type SeasonRecord = {
  id: string;
  name: string;
  status: string;
  programVersionId: string | null;
};
type AvailableProgram = {
  programVersionId: string;
  label: string;
};

const ENDPOINT = '/api/backend/admin/rank-achievements';

function money(value: string | number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value));
}

function deadlineText(hours: number) {
  return hours % 24 ? hours + ' hours' : (hours / 24) + ' days';
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Rank reward request failed';
}

export function RankAchievementPanel() {
  const [overview, setOverview] = useState<Overview>({ policies: [], achievements: [] });
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [availablePrograms, setAvailablePrograms] = useState<AvailableProgram[]>([]);
  const [initialProgramVersionId, setInitialProgramVersionId] = useState('');
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<RankTier[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [summary, versions, programs, seasons] = await Promise.all([
      apiJson<Overview>(ENDPOINT + '/overview'),
      apiJson<PolicyRow[]>(ENDPOINT + '/policies'),
      apiJson<ProgramRecord[]>('/api/backend/admin/programs'),
      apiJson<SeasonRecord[]>('/api/backend/admin/owner-portal/seasons'),
    ]);
    // A rank policy is attached to the published program version for the active season,
    // not to a local-dev program or a historical/retired version.
    const publishedPrograms = new Map(
      programs.flatMap((program) => program.versions
        .filter((version) => version.lifecycle === 'PUBLISHED')
        .map((version) => [version.id, {
          programVersionId: version.id,
          label: `${program.code} • Program v${version.version} • ${version.currencyCode}`,
        }] as const)),
    );
    const available = Array.from(new Map(
      seasons
        .filter((season) => ['ACTIVE', 'PAUSED'].includes(season.status) &&
          season.programVersionId && publishedPrograms.has(season.programVersionId))
        .map((season) => {
          const program = publishedPrograms.get(season.programVersionId!)!;
          return [program.programVersionId, {
            ...program,
            label: `${season.name} • ${program.label}`,
          }] as const;
        }),
    ).values());
    const missing = available.filter((program) =>
      !versions.some((version) => version.programVersionId === program.programVersionId));
    setAvailablePrograms(missing);
    setInitialProgramVersionId((current) =>
      missing.some((program) => program.programVersionId === current)
        ? current : (missing[0]?.programVersionId ?? ''));
    setOverview(summary);
    setPolicies(versions);
    const currentPolicy = versions.find((p) => p.id === selected)
      ?? versions.find((p) => p.lifecycle === 'PUBLISHED') ?? versions[0];
    setSelected(currentPolicy?.id ?? '');
    setEditing(currentPolicy?.tiers.map((tier) => ({ ...tier })) ?? []);
  }, [selected]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load().catch((reason: unknown) => setError(message(reason)));
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const policy = policies.find((p) => p.id === selected);
  const active = overview.policies[0];
  const displayTiers = active?.tiers ?? [];

  async function perform(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await load();
      setNotice(success);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  function changeTier(index: number, key: keyof RankTier, value: string) {
    setEditing((previous) => previous.map((tier, i) => {
      if (i !== index) return tier;
      if (key === 'newDirect' || key === 'newTeam' || key === 'hours' || key === 'months') {
        return { ...tier, [key]: Number(value) };
      }
      if (key === 'trip') return { ...tier, trip: value.trim() || null };
      return { ...tier, [key]: value };
    }));
  }

  async function createFirstDraft() {
    const target = availablePrograms.find((program) =>
      program.programVersionId === initialProgramVersionId);
    if (!target) return;
    if (!window.confirm(
      'Create an UNPUBLISHED achievement-policy draft for ' + target.label +
      ' using the approved five-level flyer values? This does not activate rewards.',
    )) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const draft = await apiJson<PolicyRow>(ENDPOINT + '/policies', {
        method: 'POST',
        body: JSON.stringify({ programVersionId: target.programVersionId }),
      });
      await load();
      setSelected(draft.id);
      setEditing(draft.tiers.map((tier) => ({ ...tier })));
      setNotice('Initial five-level draft created for ' + target.label +
        '. Review the values and SAVE DRAFT. Publishing needs separate financial approval.');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function clonePublished() {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      const draft = await apiJson<PolicyRow>(ENDPOINT + '/policies', {
        method: 'POST',
        body: JSON.stringify({
          programVersionId: active.programVersionId,
          tiers: active.tiers,
        }),
      });
      await load();
      setSelected(draft.id);
      setNotice('New draft created. Published bonus rules are unchanged until approval.');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className={styles.card}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}><span className={styles.sectionIcon}>🏅</span><h2>Lightning Start & Level 1–4 Achievement Bonuses</h2></div>
        <small>Automatic qualification • Joining-date deadlines • New members per level</small>
      </div>
      {error ? <div className={styles.notice}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}
      <div className={styles.notice}>
        Each level starts a fresh direct-referral and sponsor-team member count. All deadlines remain anchored to the original paid joining date. Verified cash bonuses and eligible monthly income are credited automatically. Gold and Diamond incomes never run together: Diamond achievement immediately closes future Gold installments, while previously due Gold installments remain valid. The 18-month term is a maximum for each tier, never two concurrent incomes. Family-trip fulfilment is recorded manually.
      </div>
      {displayTiers.length ? <div className={styles.tableBox}>
        <table className={styles.table}>
          <thead><tr><th>ACHIEVEMENT</th><th>NEW DIRECT</th><th>NEW TEAM</th><th>JOINING DEADLINE</th><th>CASH BONUS</th><th>FAMILY TRIP</th><th>MONTHLY REWARD</th></tr></thead>
          <tbody>{displayTiers.map((tier) => <tr key={tier.code}>
            <td><b>{tier.name}</b></td>
            <td>{tier.newDirect}</td>
            <td>{tier.newTeam || '—'}</td>
            <td>{deadlineText(tier.hours)}</td>
            <td>{money(tier.cash)}</td>
            <td>{tier.trip ?? '—'}</td>
            <td>{Number(tier.monthly) > 0 ? money(tier.monthly) + ' × up to ' + tier.months + ' months' : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div> : <div className={styles.notice}>No published rank-bonus policy for a program version. Publish a policy before rewards become payable.</div>}
    </div>
    <div className={styles.card}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}><span className={styles.sectionIcon}>🎁</span><h2>Achievement & Reward Register</h2></div>
        <small>{overview.achievements.length} recent achievements</small>
      </div>
      {overview.achievements.length ? <div className={styles.tableBox}>
        <table className={styles.table}>
          <thead><tr><th>MEMBER</th><th>LEVEL</th><th>ACHIEVED</th><th>CASH PAID</th><th>MONTHLY PAID</th><th>TRIP STATUS</th><th>ACTION</th></tr></thead>
          <tbody>{overview.achievements.map((award) => <tr key={award.id}>
            <td><b>{award.member.username}</b></td>
            <td>{award.tierName}</td>
            <td>{new Date(award.achievedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
            <td>{money(award.cashAmount)}</td>
            <td>{award.monthlyPayouts.length} / {award.monthlyMonths}</td>
            <td>{award.tripStatus === 'NOT_APPLICABLE' ? '—' : award.tripStatus}</td>
            <td>{award.tripStatus === 'PENDING' ?
              <button type="button" className={styles.button} disabled={busy} onClick={() => {
                const reference = window.prompt('Enter verified family-trip fulfilment reference');
                if (reference?.trim()) void perform(
                  () => apiJson(ENDPOINT + '/trips/' + award.id + '/fulfill', {
                    method: 'POST', body: JSON.stringify({ reference: reference.trim() }),
                  }),
                  'Trip fulfilment recorded with audit trail.',
                );
              }}>RECORD FULFILMENT</button> : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div> : <div className={styles.notice}>No eligible member has achieved a published rank yet.</div>}
    </div>
    <div className={styles.card}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}><span className={styles.sectionIcon}>⚙️</span><h2>Versioned Achievement Policy</h2></div>
        <small>Admin governance • Draft → Publish</small>
      </div>
      <div className={styles.buttonLine}>
        <select className={styles.select} disabled={busy} value={selected} onChange={(event) => {
            const id = event.target.value;
            setSelected(id);
            setEditing(policies.find((p) => p.id === id)?.tiers.map((tier) => ({ ...tier })) ?? []);
          }}>
          {policies.map((p) => <option key={p.id} value={p.id}>
            {p.programVersion.program.code} • Version {p.version} • {p.lifecycle}
          </option>)}
        </select>
        {active ? <button type="button" disabled={busy} className={styles.button} onClick={() => void clonePublished()}>CREATE DRAFT FROM PUBLISHED</button> : null}
      </div>
      {availablePrograms.length > 0 ? (
        <div className={styles.notice} style={{ marginTop: 12 }}>
          <label htmlFor="initialRankProgram" style={{ display: 'block', marginBottom: 8, fontWeight: 800 }}>
            First-time setup — Active season / published program version
          </label>
          <div className={styles.buttonLine}>
            <select
              id="initialRankProgram"
              aria-label="Choose active season program version for first rank policy"
              className={styles.select}
              style={{ maxWidth: 460 }}
              disabled={busy}
              value={initialProgramVersionId}
              onChange={(event) => setInitialProgramVersionId(event.target.value)}
            >
              {availablePrograms.map((program) => (
                <option key={program.programVersionId} value={program.programVersionId}>
                  {program.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.button}
              disabled={busy || !initialProgramVersionId}
              onClick={() => void createFirstDraft()}
            >
              CREATE INITIAL BONUS DRAFT
            </button>
          </div>
          Creates a draft from the locked Lightning/Bronze/Silver/Gold/Diamond values.
          Review and save before publishing. No policy is published, no cash is posted,
          and finance/payout HOLD stays in place until separate approval.
        </div>
      ) : (!policies.length ? (
        <div className={styles.notice}>
          No initial draft is available because there is no active/paused season with a
          published program version. Check Season Management before configuring bonuses.
        </div>
      ) : null)}
      {policy?.lifecycle === 'DRAFT' ? <>
        <div className={styles.tableBox}><table className={styles.table}>
          <thead><tr><th>LEVEL</th><th>NEW DIRECT</th><th>NEW TEAM</th><th>DEADLINE HOURS</th><th>CASH ₹</th><th>MONTHLY ₹</th><th>MONTHS</th><th>TRIP</th></tr></thead>
          <tbody>{editing.map((tier, index) => <tr key={tier.code}>
            <td>{tier.name}</td>
            {(['newDirect', 'newTeam', 'hours', 'cash', 'monthly', 'months', 'trip'] as const).map((key) => <td key={key}>
              <input className={styles.input}
                aria-label={tier.name + ' ' + key}
                type={key === 'trip' ? 'text' : 'number'}
                min={key === 'trip' ? undefined : 0}
                step={key === 'cash' || key === 'monthly' ? '0.01' : '1'}
                value={tier[key] ?? ''}
                onChange={(event) => changeTier(index, key, event.target.value)} />
            </td>)}
          </tr>)}</tbody>
        </table></div>
        <div className={styles.buttonLine}>
          <button type="button" disabled={busy} className={styles.button} onClick={() => void perform(
            () => apiJson(ENDPOINT + '/policies/' + policy.id, {
              method: 'PATCH',
              body: JSON.stringify({ tiers: editing.map((tier) => ({
                ...tier,
                cash: Number(tier.cash).toFixed(2),
                monthly: Number(tier.monthly).toFixed(2),
              })) }),
            }),
            'Draft policy saved.',
          )}>SAVE DRAFT</button>
          <button type="button" disabled={busy} className={styles.button} onClick={() => {
            if (!window.confirm('Publish this financial reward policy for new qualifications?')) return;
            void perform(
              () => apiJson(ENDPOINT + '/policies/' + policy.id + '/publish', { method: 'POST' }),
              'New achievement policy published.',
            );
          }}>PUBLISH APPROVED DRAFT</button>
        </div>
      </> : <div className={styles.notice}>
        Published policies are immutable. Create a new draft, edit and explicitly publish an approved version. Already posted financial rewards are preserved.
      </div>}
    </div>
  </>;
}
