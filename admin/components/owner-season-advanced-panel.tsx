'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { WorkspaceTabs } from '@/components/workspace-tabs';
import styles from './owner-portal.module.css';
import extension from './owner-portal-extension.module.css';

type Season = {
  id: string;
  code: string;
  name: string;
  status: string;
};

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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fail = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      router.replace('/login');
      return;
    }
    if (
      reason instanceof ApiClientError &&
      reason.status === 403 &&
      /password/i.test(reason.message)
    ) {
      router.replace('/change-password');
      return;
    }
    setError(reason instanceof Error ? reason.message : 'Request failed');
  }, [router]);

  const loadConfig = useCallback(async (id: string) => {
    if (!id) {
      setConfig(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setConfig(
        await apiJson<Advanced>(
          `${API}/seasons/${encodeURIComponent(id)}/advanced-configuration`,
        ),
      );
    } catch (reason) {
      fail(reason);
    } finally {
      setLoading(false);
    }
  }, [fail]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await apiJson<Season[]>(`${API}/seasons`);
      setSeasons(rows);
      const preferred =
        seasonId ||
        rows.find((row) => ['DRAFT', 'REVIEW'].includes(row.status))?.id ||
        rows[0]?.id ||
        '';
      setSeasonId(preferred);
      if (preferred) {
        setConfig(
          await apiJson<Advanced>(
            `${API}/seasons/${encodeURIComponent(preferred)}/advanced-configuration`,
          ),
        );
      } else {
        setConfig(null);
      }
    } catch (reason) {
      fail(reason);
    } finally {
      setLoading(false);
    }
  }, [fail, seasonId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function patchBinary(key: keyof Advanced['binary'], value: string | number | null) {
    setConfig((current) =>
      current
        ? { ...current, binary: { ...current.binary, [key]: value } }
        : current,
    );
  }

  function patchRules(
    key: keyof Advanced['automaticRules'],
    value: string | number | boolean | null | string[],
  ) {
    setConfig((current) =>
      current
        ? {
            ...current,
            automaticRules: { ...current.automaticRules, [key]: value },
          }
        : current,
    );
  }

  function toggleAllocation(value: string, checked: boolean) {
    if (!config) return;
    const current = config.automaticRules.requiredAllocationTypes;
    patchRules(
      'requiredAllocationTypes',
      checked
        ? [...new Set([...current, value])]
        : current.filter((item) => item !== value),
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !seasonId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData(event.currentTarget);
      const body = {
        qualifyingUnit: String(form.get('qualifyingUnit') ?? '').trim(),
        leftVolumePerPair: String(form.get('leftVolumePerPair') ?? '').trim(),
        rightVolumePerPair: String(form.get('rightVolumePerPair') ?? '').trim(),
        monthlyPairCap: optionalNumber(String(form.get('monthlyPairCap') ?? '')),
        carryForwardExpiryDays: optionalNumber(
          String(form.get('carryForwardExpiryDays') ?? ''),
        ),
        binaryUnitsPerEvent: Number(form.get('binaryUnitsPerEvent') ?? 0),
        referralHookEnabled:
          String(form.get('referralHookEnabled') ?? 'false') === 'true',
        referralBasisMode: String(
          form.get('referralBasisMode') ?? 'PAYMENT_AMOUNT',
        ),
        drawEligibilityHookEnabled:
          String(form.get('drawEligibilityHookEnabled') ?? 'false') === 'true',
        minimumPaymentAmount:
          String(form.get('minimumPaymentAmount') ?? '').trim() || undefined,
        minimumRegistrationAllocation:
          String(form.get('minimumRegistrationAllocation') ?? '').trim() ||
          undefined,
        minimumInstallmentAllocation:
          String(form.get('minimumInstallmentAllocation') ?? '').trim() ||
          undefined,
        requiredAllocationTypes: config.automaticRules.requiredAllocationTypes,
      };
      setConfig(
        await apiJson<Advanced>(
          `${API}/seasons/${encodeURIComponent(seasonId)}/advanced-configuration`,
          { method: 'PUT', body: JSON.stringify(body) },
        ),
      );
      setNotice(
        'Advanced Binary 2:2 and automatic payment rules saved as the Season draft.',
      );
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  const editable = Boolean(
    config && ['DRAFT', 'REVIEW'].includes(config.season.status),
  );
  const rules = config?.automaticRules;
  const binary = config?.binary;

  return (
    <section id="advanced-policy" className={embedded ? undefined : extension.extension}>
      <div className={styles.card}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>⚙</span>
            <div>
              <h2>Advanced Season Policy</h2>
              <small>Single authority for Binary 2:2 and automatic payment-event rules</small>
            </div>
          </div>
          <span className={styles.tag}>
            {rules?.configured
              ? `${rules.lifecycle ?? 'DRAFT'} AUTOMATIC RULES`
              : 'CONFIGURATION REQUIRED'}
          </span>
        </div>

        <div className={styles.notice}>
          The client reference defines the commercial values and Binary 2:2 model,
          but does not define which payment event should automatically create a
          Binary unit, referral hand-off or draw-eligibility hook. Configure those
          rules here before activation; the system will not invent them.
        </div>

        {error ? <div className={`${styles.notice} ${styles.error}`}>{error}</div> : null}
        {notice ? <div className={`${styles.notice} ${styles.success}`}>{notice}</div> : null}

        <div className={styles.fields}>
          <div className={styles.field}>
            <label>Season</label>
            <select
              className={styles.select}
              value={seasonId}
              onChange={(event) => {
                setSeasonId(event.target.value);
                void loadConfig(event.target.value);
              }}
            >
              <option value="">Select season</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name} • {season.status}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Policy Status</label>
            <input
              className={styles.input}
              readOnly
              value={config ? `${config.season.status} • Binary ${binary?.lifecycle ?? '—'}` : '—'}
            />
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading season policy…</div>
        ) : config && binary && rules ? (
          <form method="post" onSubmit={save}>
            <WorkspaceTabs
              ariaLabel="Advanced season policy sections"
              tabs={[
                { id: 'binary-engine', label: 'Binary 2:2 Engine' },
                { id: 'automatic-rules', label: 'Automatic Payment Rules' },
              ]}
            >
              {(activeTab) => <>
                <div hidden={activeTab !== 'binary-engine'}>
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionTitle}>
                      <span className={styles.sectionIcon}>◇</span>
                      <h2>Binary 2:2 Engine</h2>
                    </div>
                    <small>AB : CD defaults remain 2 : 2 until explicitly changed</small>
                  </div>
                  <div className={styles.fields}>
                    <div className={styles.field}>
                      <label>Qualifying Unit</label>
                      <input
                        name="qualifyingUnit"
                        className={styles.input}
                        inputMode="decimal"
                        required
                        disabled={!editable}
                        value={binary.qualifyingUnit}
                        onChange={(event) => patchBinary('qualifyingUnit', event.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>AB / Left Volume Per Pair</label>
                      <input
                        name="leftVolumePerPair"
                        className={styles.input}
                        inputMode="decimal"
                        required
                        disabled={!editable}
                        value={binary.leftVolumePerPair}
                        onChange={(event) => patchBinary('leftVolumePerPair', event.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>CD / Right Volume Per Pair</label>
                      <input
                        name="rightVolumePerPair"
                        className={styles.input}
                        inputMode="decimal"
                        required
                        disabled={!editable}
                        value={binary.rightVolumePerPair}
                        onChange={(event) => patchBinary('rightVolumePerPair', event.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Monthly Pair Cap (optional)</label>
                      <input
                        name="monthlyPairCap"
                        className={styles.input}
                        type="number"
                        min="0"
                        disabled={!editable}
                        value={binary.monthlyPairCap ?? ''}
                        onChange={(event) =>
                          patchBinary(
                            'monthlyPairCap',
                            event.target.value ? Number(event.target.value) : null,
                          )
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Carry Forward Expiry Days (optional)</label>
                      <input
                        name="carryForwardExpiryDays"
                        className={styles.input}
                        type="number"
                        min="1"
                        disabled={!editable}
                        value={binary.carryForwardExpiryDays ?? ''}
                        onChange={(event) =>
                          patchBinary(
                            'carryForwardExpiryDays',
                            event.target.value ? Number(event.target.value) : null,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>

                <div hidden={activeTab !== 'automatic-rules'}>
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionTitle}>
                      <span className={styles.sectionIcon}>↗</span>
                      <h2>Automatic Rules on Confirmed Payment</h2>
                    </div>
                    <small>Versioned and published with Season activation</small>
                  </div>
                  <div className={styles.fields}>
                    <div className={styles.field}>
                      <label>Binary Qualifying Units / Payment</label>
                      <input
                        name="binaryUnitsPerEvent"
                        className={styles.input}
                        type="number"
                        min="0"
                        required
                        disabled={!editable}
                        value={rules.binaryUnitsPerEvent}
                        onChange={(event) =>
                          patchRules('binaryUnitsPerEvent', Number(event.target.value) || 0)
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Direct Referral Hand-off</label>
                      <select
                        name="referralHookEnabled"
                        className={styles.select}
                        disabled={!editable}
                        value={String(rules.referralHookEnabled)}
                        onChange={(event) =>
                          patchRules('referralHookEnabled', event.target.value === 'true')
                        }
                      >
                        <option value="false">Disabled</option>
                        <option value="true">Enabled</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Referral Basis</label>
                      <select
                        name="referralBasisMode"
                        className={styles.select}
                        disabled={!editable || !rules.referralHookEnabled}
                        value={rules.referralBasisMode}
                        onChange={(event) => patchRules('referralBasisMode', event.target.value)}
                      >
                        <option value="PAYMENT_AMOUNT">Full Payment Amount</option>
                        <option value="REGISTRATION_ALLOCATION">Registration Allocation</option>
                        <option value="INSTALLMENT_ALLOCATION">Installment Allocation</option>
                        <option value="TOTAL_APPLIED_AMOUNT">Registration + Installment Applied</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Lucky Draw Eligibility Hook</label>
                      <select
                        name="drawEligibilityHookEnabled"
                        className={styles.select}
                        disabled={!editable}
                        value={String(rules.drawEligibilityHookEnabled)}
                        onChange={(event) =>
                          patchRules('drawEligibilityHookEnabled', event.target.value === 'true')
                        }
                      >
                        <option value="false">Disabled</option>
                        <option value="true">Enabled</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Minimum Payment Amount (optional)</label>
                      <input
                        name="minimumPaymentAmount"
                        className={styles.input}
                        inputMode="decimal"
                        disabled={!editable}
                        value={rules.minimumPaymentAmount ?? ''}
                        onChange={(event) =>
                          patchRules('minimumPaymentAmount', event.target.value || null)
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Minimum Registration Allocation</label>
                      <input
                        name="minimumRegistrationAllocation"
                        className={styles.input}
                        inputMode="decimal"
                        disabled={!editable}
                        value={rules.minimumRegistrationAllocation ?? ''}
                        onChange={(event) =>
                          patchRules('minimumRegistrationAllocation', event.target.value || null)
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Minimum Installment Allocation</label>
                      <input
                        name="minimumInstallmentAllocation"
                        className={styles.input}
                        inputMode="decimal"
                        disabled={!editable}
                        value={rules.minimumInstallmentAllocation ?? ''}
                        onChange={(event) =>
                          patchRules('minimumInstallmentAllocation', event.target.value || null)
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Required Allocation Types</label>
                      <div className={extension.checkGrid}>
                        {[
                          ['REGISTRATION_FEE', 'Registration Fee'],
                          ['INSTALLMENT', 'Installment'],
                          ['UNAPPLIED', 'Unapplied'],
                        ].map(([value, label]) => (
                          <label className={styles.check} key={value}>
                            <input
                              type="checkbox"
                              disabled={!editable}
                              checked={rules.requiredAllocationTypes.includes(value)}
                              onChange={(event) => toggleAllocation(value, event.target.checked)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>}
            </WorkspaceTabs>

            <div className={styles.notice} style={{ marginTop: 14 }}>
              Season activation is blocked until this automatic-rule draft exists
              and every Season month has a prize schedule. Activation publishes
              Membership, Binary, Referral and Automatic Rules together.
            </div>
            <div className={styles.buttonLine}>
              <button className={styles.button} disabled={busy || !editable}>
                {busy ? 'SAVING…' : 'SAVE ADVANCED SEASON POLICY'}
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.empty}>
            Create a Season draft before configuring advanced rules.
          </div>
        )}
      </div>
    </section>
  );
}
