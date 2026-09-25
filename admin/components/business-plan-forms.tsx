'use client';

export type DomainKey = 'program' | 'binary' | 'referral' | 'orchestration' | 'draw';
export type Row = Record<string, unknown>;
export type DraftValues = Record<string, unknown>;
export type SelectOption = { id: string; label: string };

export type BusinessPlanFormOptions = {
  programVersions: SelectOption[];
  binaryVersions: SelectOption[];
  referralVersions: SelectOption[];
};

type Props = {
  domain: DomainKey;
  value: DraftValues;
  onChange: (next: DraftValues) => void;
  options: BusinessPlanFormOptions;
  disabled?: boolean;
};

type PrizeTier = {
  code: string;
  name: string;
  winnerCount: number;
  prizeKind: string;
  cashAmount?: string;
  currencyCode?: string;
  prizeDefinition?: Record<string, unknown>;
};

function str(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function checked(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function patch(value: DraftValues, onChange: Props['onChange'], next: DraftValues) {
  onChange({ ...value, ...next });
}

function Field({ label, hint, children }: { label: string; hint?: string; children: import('react').ReactNode }) {
  return (
    <label className="mm-field">
      <span>{label}</span>
      {children}
      {hint ? <span className="mm-note">{hint}</span> : null}
    </label>
  );
}

function Toggle({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="mm-field" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span><strong>{label}</strong>{hint ? <><br /><span className="mm-note">{hint}</span></> : null}</span>
    </label>
  );
}

function Dates({ value, onChange, disabled }: Omit<Props, 'domain' | 'options'>) {
  return (
    <div className="mm-grid two">
      <Field label="Starts from" hint="When these settings should become effective.">
        <input type="datetime-local" value={str(value.effectiveFrom)} disabled={disabled} onChange={(event) => patch(value, onChange, { effectiveFrom: event.target.value })} required />
      </Field>
      <Field label="Ends on (optional)" hint="Leave blank when there is no planned end date.">
        <input type="datetime-local" value={str(value.effectiveTo)} disabled={disabled} onChange={(event) => patch(value, onChange, { effectiveTo: event.target.value })} />
      </Field>
    </div>
  );
}

function ProgramForm({ value, onChange, disabled }: Omit<Props, 'domain' | 'options'>) {
  return (
    <>
      <Dates value={value} onChange={onChange} disabled={disabled} />
      <div className="mm-grid two">
        <Field label="Registration fee"><input type="number" min="0" step="0.01" value={str(value.registrationFee)} disabled={disabled} onChange={(event) => patch(value, onChange, { registrationFee: event.target.value })} required /></Field>
        <Field label="Monthly / recurring payment"><input type="number" min="0" step="0.01" value={str(value.installmentAmount)} disabled={disabled} onChange={(event) => patch(value, onChange, { installmentAmount: event.target.value })} required /></Field>
        <Field label="Number of payments"><input type="number" min="0" step="1" value={str(value.installmentCount)} disabled={disabled} onChange={(event) => patch(value, onChange, { installmentCount: event.target.value })} required /></Field>
        <Field label="Currency"><input maxLength={3} value={str(value.currencyCode, 'INR')} disabled={disabled} onChange={(event) => patch(value, onChange, { currencyCode: event.target.value.toUpperCase() })} required /></Field>
        <Field label="Payment frequency">
          <select value={str(value.installmentIntervalUnit, 'MONTH')} disabled={disabled} onChange={(event) => patch(value, onChange, { installmentIntervalUnit: event.target.value })}>
            <option value="DAY">Daily</option><option value="WEEK">Weekly</option><option value="MONTH">Monthly</option>
          </select>
        </Field>
        <Field label="Every" hint="For example: 1 month, or 2 weeks."><input type="number" min="1" step="1" value={str(value.installmentIntervalCount, '1')} disabled={disabled} onChange={(event) => patch(value, onChange, { installmentIntervalCount: event.target.value })} required /></Field>
        <Field label="First payment after (days)"><input type="number" min="0" step="1" value={str(value.firstInstallmentOffsetDays, '0')} disabled={disabled} onChange={(event) => patch(value, onChange, { firstInstallmentOffsetDays: event.target.value })} required /></Field>
        <Field label="Grace period (days)"><input type="number" min="0" step="1" value={str(value.gracePeriodDays, '0')} disabled={disabled} onChange={(event) => patch(value, onChange, { gracePeriodDays: event.target.value })} required /></Field>
        <Field label="Maximum active memberships per member (optional)"><input type="number" min="1" step="1" value={str(value.maxActiveEnrollmentsPerUser)} disabled={disabled} onChange={(event) => patch(value, onChange, { maxActiveEnrollmentsPerUser: event.target.value })} /></Field>
      </div>
      <Toggle label="Allow partial payments" value={checked(value.partialPaymentsAllowed)} disabled={disabled} onChange={(next) => patch(value, onChange, { partialPaymentsAllowed: next })} />
      <Toggle label="Allow overpayments" value={checked(value.overpaymentsAllowed)} disabled={disabled} onChange={(next) => patch(value, onChange, { overpaymentsAllowed: next })} />
    </>
  );
}

function BinaryForm({ value, onChange, disabled }: Omit<Props, 'domain' | 'options'>) {
  return (
    <>
      <Dates value={value} onChange={onChange} disabled={disabled} />
      <div className="mm-grid two">
        <Field label="Qualifying unit" hint="Usually 1 for one qualifying business unit."><input type="number" min="0" step="0.0001" value={str(value.qualifyingUnit, '1')} disabled={disabled} onChange={(event) => patch(value, onChange, { qualifyingUnit: event.target.value })} required /></Field>
        <Field label="Pair income"><input type="number" min="0" step="0.01" value={str(value.pairPayoutAmount)} disabled={disabled} onChange={(event) => patch(value, onChange, { pairPayoutAmount: event.target.value })} required /></Field>
        <Field label="Left units needed for one pair"><input type="number" min="0" step="0.0001" value={str(value.leftVolumePerPair, '1')} disabled={disabled} onChange={(event) => patch(value, onChange, { leftVolumePerPair: event.target.value })} required /></Field>
        <Field label="Right units needed for one pair"><input type="number" min="0" step="0.0001" value={str(value.rightVolumePerPair, '1')} disabled={disabled} onChange={(event) => patch(value, onChange, { rightVolumePerPair: event.target.value })} required /></Field>
        <Field label="Daily pair limit (optional)"><input type="number" min="0" step="1" value={str(value.dailyPairCap)} disabled={disabled} onChange={(event) => patch(value, onChange, { dailyPairCap: event.target.value })} /></Field>
        <Field label="Monthly pair limit (optional)"><input type="number" min="0" step="1" value={str(value.monthlyPairCap)} disabled={disabled} onChange={(event) => patch(value, onChange, { monthlyPairCap: event.target.value })} /></Field>
        <Field label="Currency"><input maxLength={3} value={str(value.currencyCode, 'INR')} disabled={disabled} onChange={(event) => patch(value, onChange, { currencyCode: event.target.value.toUpperCase() })} required /></Field>
        <Field label="Business day timezone"><select value={str(value.settlementTimezone, 'Asia/Kolkata')} disabled={disabled} onChange={(event) => patch(value, onChange, { settlementTimezone: event.target.value })}><option value="Asia/Kolkata">India (Asia/Kolkata)</option><option value="UTC">UTC</option></select></Field>
      </div>
      <Toggle label="Carry unused units forward" hint="Unused left/right units remain available for future matching." value={checked(value.carryForwardEnabled)} disabled={disabled} onChange={(next) => patch(value, onChange, { carryForwardEnabled: next })} />
      {checked(value.carryForwardEnabled) ? <div className="mm-grid two">
        <Field label="Carry-forward expires after (days, optional)"><input type="number" min="1" step="1" value={str(value.carryForwardExpiryDays)} disabled={disabled} onChange={(event) => patch(value, onChange, { carryForwardExpiryDays: event.target.value })} /></Field>
        <Field label="When a payout limit is reached"><select value={str(value.capOverflowMode, 'CARRY')} disabled={disabled} onChange={(event) => patch(value, onChange, { capOverflowMode: event.target.value })}><option value="CARRY">Keep extra units for later</option><option value="FLUSH">Remove extra units</option></select></Field>
      </div> : null}
    </>
  );
}

function ReferralForm({ value, onChange, disabled }: Omit<Props, 'domain' | 'options'>) {
  const mode = str(value.rewardMode, 'FIXED');
  return (
    <>
      <Dates value={value} onChange={onChange} disabled={disabled} />
      <div className="mm-grid two">
        <Field label="Reward type"><select value={mode} disabled={disabled} onChange={(event) => patch(value, onChange, { rewardMode: event.target.value })}><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option></select></Field>
        <Field label="Currency"><input maxLength={3} value={str(value.currencyCode, 'INR')} disabled={disabled} onChange={(event) => patch(value, onChange, { currencyCode: event.target.value.toUpperCase() })} required /></Field>
        {mode === 'PERCENTAGE'
          ? <Field label="Referral percentage"><input type="number" min="0" step="0.0001" value={str(value.percentageRate)} disabled={disabled} onChange={(event) => patch(value, onChange, { percentageRate: event.target.value })} required /></Field>
          : <Field label="Referral reward amount"><input type="number" min="0" step="0.01" value={str(value.fixedAmount)} disabled={disabled} onChange={(event) => patch(value, onChange, { fixedAmount: event.target.value })} required /></Field>}
        <Field label="Minimum reward (optional)"><input type="number" min="0" step="0.01" value={str(value.minimumRewardAmount)} disabled={disabled} onChange={(event) => patch(value, onChange, { minimumRewardAmount: event.target.value })} /></Field>
        <Field label="Maximum reward (optional)"><input type="number" min="0" step="0.01" value={str(value.maximumRewardAmount)} disabled={disabled} onChange={(event) => patch(value, onChange, { maximumRewardAmount: event.target.value })} /></Field>
      </div>
    </>
  );
}

const triggerOptions = [
  ['ENROLLMENT_CREATED', 'When a member joins'],
  ['PAYMENT_CONFIRMED', 'When a payment is confirmed'],
  ['PAYMENT_FAILED', 'When a payment fails'],
  ['REFUND_CONFIRMED', 'When a refund is confirmed'],
  ['ENROLLMENT_COMPLETED', 'When the membership is completed'],
  ['ENROLLMENT_REOPENED', 'When a membership is reopened'],
] as const;

function AutomationForm({ value, onChange, options, disabled }: Props) {
  const pairIncomeEnabled = Boolean(str(value.binaryPlanVersionId));
  const referralEnabled = checked(value.referralHookEnabled);
  return (
    <>
      <p className="mm-note">Choose what the system should do automatically when a member action happens. Technical IDs are hidden.</p>
      <Field label="For membership plan"><select value={str(value.programVersionId)} disabled={disabled} onChange={(event) => patch(value, onChange, { programVersionId: event.target.value })} required><option value="">Choose live membership plan</option>{options.programVersions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
      <Field label="When this happens"><select value={str(value.triggerType, 'PAYMENT_CONFIRMED')} disabled={disabled} onChange={(event) => patch(value, onChange, { triggerType: event.target.value })}>{triggerOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Dates value={value} onChange={onChange} disabled={disabled} />
      <section className="mm-card" style={{ boxShadow: 'none' }}><div className="mm-card-body">
        <Toggle label="Give pair-income units" value={pairIncomeEnabled} disabled={disabled} onChange={(next) => patch(value, onChange, next ? { binaryPlanVersionId: options.binaryVersions[0]?.id ?? '', binaryUnitsPerEvent: num(value.binaryUnitsPerEvent, 1) || 1 } : { binaryPlanVersionId: '', binaryUnitsPerEvent: 0 })} />
        {pairIncomeEnabled ? <div className="mm-grid two"><Field label="Pair-income plan"><select value={str(value.binaryPlanVersionId)} disabled={disabled} onChange={(event) => patch(value, onChange, { binaryPlanVersionId: event.target.value })} required><option value="">Choose live pair-income plan</option>{options.binaryVersions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field><Field label="Units earned for this event"><input type="number" min="0" step="1" value={str(value.binaryUnitsPerEvent, '1')} disabled={disabled} onChange={(event) => patch(value, onChange, { binaryUnitsPerEvent: event.target.value })} /></Field></div> : null}
      </div></section>
      <section className="mm-card" style={{ boxShadow: 'none' }}><div className="mm-card-body">
        <Toggle label="Give direct-referral reward" value={referralEnabled} disabled={disabled} onChange={(next) => patch(value, onChange, next ? { referralHookEnabled: true, referralPolicyVersionId: options.referralVersions[0]?.id ?? '', referralBasisMode: str(value.referralBasisMode, 'PAYMENT_AMOUNT') } : { referralHookEnabled: false, referralPolicyVersionId: '', referralBasisMode: '' })} />
        {referralEnabled ? <div className="mm-grid two"><Field label="Referral reward plan"><select value={str(value.referralPolicyVersionId)} disabled={disabled} onChange={(event) => patch(value, onChange, { referralPolicyVersionId: event.target.value })} required><option value="">Choose live referral plan</option>{options.referralVersions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field><Field label="Reward is calculated from"><select value={str(value.referralBasisMode, 'PAYMENT_AMOUNT')} disabled={disabled} onChange={(event) => patch(value, onChange, { referralBasisMode: event.target.value })}><option value="PAYMENT_AMOUNT">Payment amount</option><option value="REGISTRATION_ALLOCATION">Registration fee portion</option><option value="INSTALLMENT_ALLOCATION">Installment portion</option><option value="TOTAL_APPLIED_AMOUNT">Total amount applied</option></select></Field></div> : null}
      </div></section>
      <Toggle label="Add member to lucky-draw eligibility" value={checked(value.drawEligibilityHookEnabled)} disabled={disabled} onChange={(next) => patch(value, onChange, { drawEligibilityHookEnabled: next })} />
    </>
  );
}

function normalizeTiers(value: unknown): PrizeTier[] {
  if (!Array.isArray(value)) return [];
  return value.map((tier, index) => {
    const row = tier && typeof tier === 'object' ? tier as Row : {};
    return {
      code: str(row.code, `PRIZE_${index + 1}`),
      name: str(row.name, `Prize ${index + 1}`),
      winnerCount: Math.max(1, num(row.winnerCount, 1)),
      prizeKind: str(row.prizeKind, 'ITEM'),
      ...(row.cashAmount !== undefined ? { cashAmount: str(row.cashAmount) } : {}),
      ...(row.currencyCode !== undefined ? { currencyCode: str(row.currencyCode) } : {}),
      prizeDefinition: row.prizeDefinition && typeof row.prizeDefinition === 'object' && !Array.isArray(row.prizeDefinition) ? row.prizeDefinition as Record<string, unknown> : {},
    };
  });
}

function DrawForm({ value, onChange, options, disabled }: Props) {
  const tiers = normalizeTiers(value.prizeTiers);
  function setTiers(next: PrizeTier[]) { patch(value, onChange, { prizeTiers: next }); }
  function updateTier(index: number, next: Partial<PrizeTier>) { setTiers(tiers.map((tier, itemIndex) => itemIndex === index ? { ...tier, ...next } : tier)); }
  function addTier() { setTiers([...tiers, { code: `PRIZE_${tiers.length + 1}`, name: `Prize ${tiers.length + 1}`, winnerCount: 1, prizeKind: 'ITEM', prizeDefinition: {} }]); }
  return (
    <>
      <Field label="Membership plan"><select value={str(value.programVersionId)} disabled={disabled} onChange={(event) => patch(value, onChange, { programVersionId: event.target.value })} required><option value="">Choose live membership plan</option>{options.programVersions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
      <Dates value={value} onChange={onChange} disabled={disabled} />
      <div className="mm-grid two">
        <Field label="Entries per member"><select value={str(value.entryMode, 'ONE_PER_USER')} disabled={disabled} onChange={(event) => patch(value, onChange, { entryMode: event.target.value })}><option value="ONE_PER_USER">One entry per member</option><option value="PER_ELIGIBLE_HOOK">One entry each time they qualify</option></select></Field>
        <Field label="Previous winners"><select value={str(value.priorWinnerMode, 'DISALLOW_WITHIN_POLICY')} disabled={disabled} onChange={(event) => patch(value, onChange, { priorWinnerMode: event.target.value })}><option value="DISALLOW_WITHIN_POLICY">Cannot win again in this plan</option><option value="ALLOW">Can win again</option></select></Field>
        <Field label="If there are fewer eligible members than prizes"><select value={str(value.insufficientEntrantsMode, 'DRAW_AVAILABLE')} disabled={disabled} onChange={(event) => patch(value, onChange, { insufficientEntrantsMode: event.target.value })}><option value="DRAW_AVAILABLE">Draw as many prizes as possible</option><option value="REQUIRE_FULL">Wait until all prizes can be drawn</option></select></Field>
      </div>
      <Toggle label="Allow one member to win more than once in the same draw" value={checked(value.allowMultipleWinsPerDraw)} disabled={disabled} onChange={(next) => patch(value, onChange, { allowMultipleWinsPerDraw: next })} />
      <div className="mm-card" style={{ boxShadow: 'none' }}>
        <div className="mm-card-head"><h3>Prizes</h3><button className="mm-button secondary" type="button" disabled={disabled} onClick={addTier}>Add prize</button></div>
        <div className="mm-card-body mm-list">
          {tiers.length ? tiers.map((tier, index) => <div className="mm-list-row" key={`${tier.code}-${index}`} style={{ alignItems: 'flex-start' }}><div style={{ flex: 1 }}><div className="mm-grid two"><Field label="Prize name"><input value={tier.name} disabled={disabled} onChange={(event) => updateTier(index, { name: event.target.value })} required /></Field><Field label="Number of winners"><input type="number" min="1" step="1" value={tier.winnerCount} disabled={disabled} onChange={(event) => updateTier(index, { winnerCount: Math.max(1, Number(event.target.value) || 1) })} required /></Field><Field label="Prize type"><select value={tier.prizeKind} disabled={disabled} onChange={(event) => updateTier(index, { prizeKind: event.target.value })}><option value="ITEM">Product / item</option><option value="BENEFIT">Benefit</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></Field>{tier.prizeKind === 'CASH' ? <><Field label="Cash amount"><input type="number" min="0" step="0.01" value={tier.cashAmount ?? ''} disabled={disabled} onChange={(event) => updateTier(index, { cashAmount: event.target.value })} required /></Field><Field label="Currency"><input maxLength={3} value={tier.currencyCode ?? 'INR'} disabled={disabled} onChange={(event) => updateTier(index, { currencyCode: event.target.value.toUpperCase() })} required /></Field></> : null}</div></div><button className="mm-button secondary" type="button" disabled={disabled || tiers.length <= 1} onClick={() => setTiers(tiers.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>) : <div className="mm-empty">Add at least one prize.</div>}
        </div>
      </div>
    </>
  );
}

export function BusinessPlanDraftForm(props: Props) {
  if (props.domain === 'program') return <ProgramForm value={props.value} onChange={props.onChange} disabled={props.disabled} />;
  if (props.domain === 'binary') return <BinaryForm value={props.value} onChange={props.onChange} disabled={props.disabled} />;
  if (props.domain === 'referral') return <ReferralForm value={props.value} onChange={props.onChange} disabled={props.disabled} />;
  if (props.domain === 'draw') return <DrawForm {...props} />;
  return <AutomationForm {...props} />;
}
