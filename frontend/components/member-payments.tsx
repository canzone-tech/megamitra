'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberHeader } from '@/components/member-header';

type Season = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  registrationFee: string;
  installmentAmount: string;
  joiningAmount: string;
};
type Installment = {
  seasonId: string;
  seasonCode: string;
  seasonName: string;
  currencyCode: string;
  installmentAmount: string;
  installmentCount: number;
  paidInstallmentCount: number;
  remainingInstallmentCount: number;
  nextUnpaidSequence: number | null;
  unpaidInstallments: Array<{ sequence: number; dueDate: string; amount: string }>;
  fullyPaid: boolean;
};
type Config = {
  paymentRail: {
    enabled: boolean;
    upiId: string | null;
    payeeName: string | null;
    qrImageDataUrl: string | null;
    instructions: string | null;
  };
  seasons: Season[];
  installment: Installment | null;
};
type Receipt = {
  id?: string;
  receiptNumber: string;
  receiptUrl?: string | null;
  purpose: 'INSTALLMENT' | 'EPIN_PURCHASE';
  amount: string;
  currencyCode: string;
  providerReference: string;
  status: string;
  details?: Record<string, unknown> | string | null;
  seasonCode?: string;
  seasonName?: string;
  submittedAt: string;
};
type Epin = {
  id: string;
  pin: string | null;
  seasonId: string | null;
  displaySuffix: string;
  status: string;
  pinType: 'ACTIVATION' | 'INSTALLMENT';
  seasonCode: string | null;
  seasonName: string | null;
  expiresAt: string;
};

function money(value: string | number | null | undefined, currency = 'INR') {
  const amount = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
  }
}

function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function statusLabel(status: string) {
  if (status === 'PENDING_VERIFICATION' || status === 'PROCESSING') return 'PENDING VERIFICATION';
  if (status === 'CONFIRMED') return 'CONFIRMED / PAID';
  return status;
}

function detailsObject(value: Receipt['details']): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function proofFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Payment screenshot must be an image');
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Unable to read payment screenshot'));
    reader.readAsDataURL(file);
  });
  if (raw.length <= 115_000) return raw;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Unable to process payment screenshot'));
    element.src = raw;
  });
  const scale = Math.min(1, 1100 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to process payment screenshot');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.78, 0.62, 0.46, 0.32]) {
    const result = canvas.toDataURL('image/jpeg', quality);
    if (result.length <= 115_000) return result;
  }
  throw new Error('Screenshot is still too large. Please crop it and upload again.');
}

export function MemberPayments() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [history, setHistory] = useState<Receipt[]>([]);
  const [epins, setEpins] = useState<Epin[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'EPIN'>('UPI');
  const [selectedEpinId, setSelectedEpinId] = useState('');
  const [epinQuantity, setEpinQuantity] = useState(1);
  const [epinType, setEpinType] = useState<'ACTIVATION' | 'INSTALLMENT'>('INSTALLMENT');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [installmentProof, setInstallmentProof] = useState('');
  const [epinProof, setEpinProof] = useState('');
  const [latestReceipt, setLatestReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleError = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      router.replace('/login');
      return;
    }
    if (reason instanceof ApiClientError && reason.status === 403 && /password/i.test(reason.message)) {
      router.replace('/member/change-password');
      return;
    }
    setError(reason instanceof Error ? reason.message : 'Request failed');
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextConfig, nextHistory, nextEpins] = await Promise.all([
        apiJson<Config>('/api/backend/member/payments/config'),
        apiJson<Receipt[]>('/api/backend/member/payments'),
        apiJson<Epin[]>('/api/backend/member/payments/epins'),
      ]);
      setConfig(nextConfig);
      setHistory(nextHistory);
      setEpins(nextEpins);
      setSeasonId((current) => current || nextConfig.installment?.seasonId || nextConfig.seasons[0]?.id || '');
      const remaining = nextConfig.installment?.remainingInstallmentCount ?? 0;
      setInstallmentCount((current) => Math.max(1, Math.min(current, Math.max(1, remaining))));
    } catch (reason) {
      handleError(reason);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedSeason = useMemo(() => config?.seasons.find((item) => item.id === seasonId) ?? null, [config, seasonId]);
  const installment = config?.installment ?? null;
  const installmentTotal = Number(installment?.installmentAmount ?? 0) * installmentCount;
  const unpaidInstallments = installment?.unpaidInstallments ?? [];
  const dueSelection = unpaidInstallments.slice(0, installmentCount);
  const upiReady = Boolean(config?.paymentRail?.enabled && config.paymentRail.upiId && config.paymentRail.qrImageDataUrl);
  const assignedInstallmentEpins = epins.filter((item) => item.pinType === 'INSTALLMENT' && item.status === 'ACTIVE' && item.seasonId === installment?.seasonId);
  const chosenEpinId = assignedInstallmentEpins.some((item) => item.id === selectedEpinId) ? selectedEpinId : assignedInstallmentEpins[0]?.id ?? '';
  const pendingInstallment = history.some((item) => item.purpose === 'INSTALLMENT' && (item.status === 'PENDING_VERIFICATION' || item.status === 'PROCESSING'));
  const epinUnitValue = epinType === 'ACTIVATION'
    ? Number(selectedSeason?.joiningAmount ?? 0)
    : Number(selectedSeason?.installmentAmount ?? 0);
  const epinTotal = epinUnitValue * epinQuantity;

  async function setProof(file: File | undefined, setter: (value: string) => void) {
    if (!file) {
      setter('');
      return;
    }
    try {
      setter(await proofFromFile(file));
    } catch (reason) {
      setter('');
      handleError(reason);
    }
  }

  async function submitInstallment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installment || installment.fullyPaid || !installmentProof) return setError('Payment screenshot is required');
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      const receipt = await apiJson<Receipt>('/api/backend/member/payments/installments', {
        method: 'POST',
        body: JSON.stringify({ amount: installmentTotal.toFixed(2), utr: String(form.get('utr') ?? '').trim(), paymentProofDataUrl: installmentProof }),
      });
      setLatestReceipt(receipt);
      setInstallmentProof('');
      setNotice('Installment submitted. The receipt is PENDING VERIFICATION until Super Admin review.');
      event.currentTarget.reset();
      await load();
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  }

  async function redeemInstallmentEpin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installment || installment.fullyPaid || !chosenEpinId) {
      setError('Select an available INSTALLMENT E-PIN for this session');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const redeemed = await apiJson<{ status: string; installmentSequence: number; reconciliationPending?: boolean }>(
        '/api/backend/member/payments/installments/redeem-epin',
        { method: 'POST', body: JSON.stringify({ epinId: chosenEpinId }) },
      );
      setSelectedEpinId('');
      setNotice(
        'Installment #' + redeemed.installmentSequence + ' confirmed using your prepaid E-PIN.' +
        (redeemed.reconciliationPending ? ' Reward processing is pending reconciliation.' : ''),
      );
      await load();
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  }

  async function submitEpin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSeason || !epinProof) return setError('Select a session and attach the payment screenshot');
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      const receipt = await apiJson<Receipt>('/api/backend/member/payments/epins', {
        method: 'POST',
        body: JSON.stringify({ seasonId: selectedSeason.id, epinType, quantity: epinQuantity, utr: String(form.get('utr') ?? '').trim(), paymentProofDataUrl: epinProof }),
      });
      setLatestReceipt(receipt);
      setEpinProof(''); setEpinQuantity(1);
      setNotice(`${epinType === 'ACTIVATION' ? 'Activation' : 'Installment'} E-PIN purchase submitted. Session-bound E-PINs are generated only after Super Admin verification.`);
      event.currentTarget.reset();
      await load();
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  }

  return (
    <div className="mm-member-shell">
      <MemberHeader />
      <main className="mm-member-main">
        <div className="mm-member-hero"><div><p className="mm-eyebrow">Member payments</p><h1 className="mm-title">Installments & E-PINs</h1><p className="mm-subtitle">Pay by QR / UPI, submit UTR and screenshot, and keep the same public receipt through verification.</p><span className="mm-portal-pill">Super Admin verification required</span></div><button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {notice ? <div className="mm-success" role="status">{notice}</div> : null}

        <section className="mm-portal-grid">
          <article className="mm-card">
            <div className="mm-card-head"><h2>QR / UPI payment</h2><span className="mm-chip">{upiReady ? 'Ready' : 'Setup incomplete'}</span></div>
            <div className="mm-card-body mm-list">
              {config?.paymentRail?.qrImageDataUrl ? (
                <img src={config.paymentRail.qrImageDataUrl} alt="Configured MegaGoldenClub payment QR" className="mm-payment-qr" />
              ) : <div className="mm-payment-qr-missing">QR image has not been configured. Super Admin must upload the official receiving QR in Member Payment Verification before UPI submissions can be accepted.</div>}
              <div><strong>UPI ID</strong><p>{config?.paymentRail?.upiId || 'Not configured'}</p></div>
              <div><strong>Payee</strong><p>{config?.paymentRail?.payeeName || '—'}</p></div>
              {config?.paymentRail?.instructions ? <div><strong>Instructions</strong><p>{config.paymentRail.instructions}</p></div> : null}
              {config && !config.paymentRail.enabled ? <p>UPI payment rail is disabled by Super Admin.</p> : null}
            </div>
          </article>
          <article className="mm-card">
            <div className="mm-card-head"><h2>Session installment status</h2><span className="mm-chip">{installment?.seasonCode ?? 'No enrollment'}</span></div>
            <div className="mm-card-body mm-list">
              {installment ? (
                <>
                  <div><strong>{installment.seasonName}</strong><p>{installment.seasonCode} · Paid {installment.paidInstallmentCount} of {installment.installmentCount} installments</p></div>
                  <div><strong>Remaining installments:</strong> {installment.remainingInstallmentCount}</div>
                  {installment.fullyPaid ? <div className="mm-success">All installments are paid.</div> : (
                    <div className="mm-payment-due">
                      <strong>Next unpaid installment: #{installment.nextUnpaidSequence}</strong>
                      <span>Due: {unpaidInstallments[0]?.dueDate ?? '—'}</span>
                      <strong>{money(unpaidInstallments[0]?.amount ?? installment.installmentAmount, installment.currencyCode)}</strong>
                    </div>
                  )}
                  <div>Per installment: <strong>{money(installment.installmentAmount, installment.currencyCode)}</strong></div>
                </>
              ) : <p>No active session enrollment was found.</p>}
            </div>
          </article>
        </section>

        <section className="mm-card">
          <div className="mm-card-head"><h2>Pay session installment</h2><span className="mm-chip">Next unpaid · no partial EMI</span></div>
          <div className="mm-card-body">
            {installment && !installment.fullyPaid ? (
              <>
                <p className="mm-payment-context">
                  <strong>{installment.seasonName}</strong> — installment #{installment.nextUnpaidSequence},
                  due {unpaidInstallments[0]?.dueDate ?? '—'} · {money(installment.installmentAmount, installment.currencyCode)}
                </p>
                {pendingInstallment ? <div className="mm-payment-pending">A UPI installment is pending Super Admin verification. Do not pay the same installment again. E-PIN redemption is paused until review.</div> : null}
                <div className="mm-payment-tabs" role="group" aria-label="Installment payment method">
                  <button type="button" className={paymentMethod === 'UPI' ? 'mm-payment-tab active' : 'mm-payment-tab'} aria-pressed={paymentMethod === 'UPI'} onClick={() => setPaymentMethod('UPI')}>UPI / QR</button>
                  <button type="button" className={paymentMethod === 'EPIN' ? 'mm-payment-tab active' : 'mm-payment-tab'} aria-pressed={paymentMethod === 'EPIN'} onClick={() => setPaymentMethod('EPIN')}>Use E-PIN</button>
                </div>
                {paymentMethod === 'UPI' ? (
                  <form method="post" className="mm-payment-form" onSubmit={submitInstallment}>
                    <p>Pay using the official QR / UPI ID above, then attach the transfer proof. The installment remains pending until Super Admin confirms.</p>
                    <div className="mm-field"><label htmlFor="installmentCount">Installments to pay (from next unpaid)</label><input id="installmentCount" className="mm-input" type="number" min="1" max={Math.max(1, installment.remainingInstallmentCount)} value={installmentCount} disabled={!upiReady || busy || pendingInstallment} onChange={(event) => setInstallmentCount(Math.max(1, Math.min(installment.remainingInstallmentCount, Number(event.target.value) || 1)))} /></div>
                    <p className="mm-payment-context">Covers: {dueSelection.map((item) => '#' + item.sequence).join(', ')} {dueSelection.length ? '· first due ' + dueSelection[0].dueDate : ''}</p>
                    <div className="mm-field"><label htmlFor="installmentTotal">Total payment</label><input id="installmentTotal" className="mm-input" value={money(installmentTotal, installment.currencyCode)} readOnly /></div>
                    <div className="mm-field"><label htmlFor="installmentUtr">UTR / reference</label><input id="installmentUtr" name="utr" className="mm-input" minLength={4} maxLength={191} required disabled={!upiReady || busy || pendingInstallment} /></div>
                    <div className="mm-field"><label htmlFor="installmentProof">Payment screenshot</label><input id="installmentProof" className="mm-input" type="file" accept="image/*" required={!installmentProof} disabled={!upiReady || busy || pendingInstallment} onChange={(event) => void setProof(event.target.files?.[0], setInstallmentProof)} /></div>
                    <button className="mm-button blue" disabled={busy || !upiReady || pendingInstallment || !installmentProof}>{busy ? 'Submitting…' : 'Submit UPI payment for verification'}</button>
                    {!upiReady ? <p className="mm-payment-note">UPI submissions are unavailable until Super Admin enables the rail and configures both receiving UPI ID and QR image.</p> : null}
                  </form>
                ) : (
                  <form method="post" className="mm-payment-form" onSubmit={redeemInstallmentEpin}>
                    <p>Use an eligible, already-paid INSTALLMENT E-PIN assigned to your account for this same session. It covers one next-unpaid installment and can only be used once.</p>
                    <div className="mm-field">
                      <label htmlFor="redeemEpin">Available session E-PIN</label>
                      <select id="redeemEpin" className="mm-input" value={chosenEpinId} onChange={(event) => setSelectedEpinId(event.target.value)} disabled={busy || pendingInstallment || !assignedInstallmentEpins.length}>
                        {assignedInstallmentEpins.length ? assignedInstallmentEpins.map((item) => (
                          <option key={item.id} value={item.id}>INSTALLMENT E-PIN ending {item.displaySuffix} · expires {dateTime(item.expiresAt)}</option>
                        )) : <option value="">No eligible E-PIN for this session</option>}
                      </select>
                    </div>
                    <button className="mm-button blue" disabled={busy || pendingInstallment || !chosenEpinId}>{busy ? 'Applying…' : 'Apply E-PIN to installment #' + installment.nextUnpaidSequence}</button>
                    {!assignedInstallmentEpins.length ? <p className="mm-payment-note">No unused INSTALLMENT E-PIN assigned to this session. You can purchase one below using UPI; it becomes available only after Super Admin verification.</p> : null}
                  </form>
                )}
              </>
            ) : <p>{installment?.fullyPaid ? 'Your session installment schedule is fully paid.' : 'An active session enrollment is required before paying an installment.'}</p>}
          </div>
        </section>

        <section className="mm-card">
          <div className="mm-card-head"><h2>Purchase E-PINs via UPI</h2><span className="mm-chip">Separate purchase · verified by Super Admin</span></div>
          <div className="mm-card-body">
            <p className="mm-payment-context">Purchased E-PINs are inventory, not automatic installment payments. Select <strong>Use E-PIN</strong> above to apply an assigned INSTALLMENT pin to your dues.</p>
            <form method="post" onSubmit={submitEpin}>
              <div className="mm-portal-grid">
                <div className="mm-field"><label htmlFor="seasonId">Session</label><select id="seasonId" className="mm-input" value={seasonId} required disabled={busy} onChange={(event) => setSeasonId(event.target.value)}><option value="">Select session</option>{config?.seasons.map((season) => <option key={season.id} value={season.id}>{season.name} ({season.code})</option>)}</select></div>
                <div className="mm-field"><label htmlFor="epinType">E-PIN type</label><select id="epinType" className="mm-input" value={epinType} disabled={busy} onChange={(event) => setEpinType(event.target.value as 'ACTIVATION' | 'INSTALLMENT')}><option value="INSTALLMENT">Installment — one monthly EMI</option><option value="ACTIVATION">Activation — registration + installment #1</option></select></div>
                <div className="mm-field"><label htmlFor="epinQuantity">Quantity</label><input id="epinQuantity" className="mm-input" type="number" min="1" max="100" value={epinQuantity} disabled={busy} onChange={(event) => setEpinQuantity(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></div>
                <div className="mm-field"><label htmlFor="epinAmount">Amount</label><input id="epinAmount" className="mm-input" value={money(epinTotal, selectedSeason?.currencyCode)} readOnly /></div>
                <div className="mm-field"><label htmlFor="epinUtr">UTR / reference</label><input id="epinUtr" name="utr" className="mm-input" minLength={4} maxLength={191} required disabled={!upiReady || busy} /></div>
                <div className="mm-field"><label htmlFor="epinProof">Payment screenshot</label><input id="epinProof" className="mm-input" type="file" accept="image/*" required={!epinProof} disabled={!upiReady || busy} onChange={(event) => void setProof(event.target.files?.[0], setEpinProof)} /></div>
              </div>
              <button className="mm-button blue" disabled={busy || !upiReady || !selectedSeason || !epinProof}>{busy ? 'Submitting…' : 'Submit E-PIN purchase for verification'}</button>
            </form>
          </div>
        </section>

        {latestReceipt ? <section className="mm-card"><div className="mm-card-head"><h2>Provisional receipt</h2><span className="mm-chip">{statusLabel(latestReceipt.status)}</span></div><div className="mm-card-body"><p><strong>{latestReceipt.receiptNumber}</strong> • {latestReceipt.purpose.replace('_', ' ')} • {money(latestReceipt.amount, latestReceipt.currencyCode)}</p><p>UTR: {latestReceipt.providerReference} • Submitted: {dateTime(latestReceipt.submittedAt)}</p>{latestReceipt.receiptUrl ? <Link className="mm-button blue" href={latestReceipt.receiptUrl} target="_blank">Open public receipt</Link> : null}</div></section> : null}

        <section className="mm-card"><div className="mm-card-head"><h2>Payment receipts</h2><span className="mm-chip">{history.length}</span></div><div className="mm-card-body">{history.length ? <div className="mm-list">{history.map((receipt) => { const details = detailsObject(receipt.details); return <div key={receipt.id ?? receipt.receiptNumber}><strong>{receipt.receiptNumber}</strong> • {receipt.purpose.replace('_', ' ')} • {money(receipt.amount, receipt.currencyCode)}<br /><span>{statusLabel(receipt.status)} • UTR {receipt.providerReference} • {receipt.seasonName ?? receipt.seasonCode ?? 'Session'}</span><br /><small>{receipt.purpose === 'INSTALLMENT' ? `${String(details.installmentCount ?? '—')} installment(s)` : `${String(details.quantity ?? '—')} ${String(details.epinType ?? 'ACTIVATION')} E-PIN(s)`} • {dateTime(receipt.submittedAt)}</small>{' '}{receipt.receiptUrl ? <Link href={receipt.receiptUrl} target="_blank">Public receipt</Link> : null}</div>; })}</div> : <p>No payment submissions yet.</p>}</div></section>
        <section className="mm-card"><div className="mm-card-head"><h2>My E-PINs</h2><span className="mm-chip">{epins.length}</span></div><div className="mm-card-body">{epins.length ? <div className="mm-list">{epins.map((epin) => <div key={epin.id}><strong>{epin.pin ?? `••••${epin.displaySuffix}`}</strong> • {epin.status}<br /><span>{epin.pinType === 'INSTALLMENT' ? 'Installment E-PIN' : 'Activation E-PIN'} • {epin.seasonName ?? epin.seasonCode ?? 'Session'} • Expires {dateTime(epin.expiresAt)}</span></div>)}</div> : <p>No E-PINs assigned yet. Verified purchases will appear here.</p>}</div></section>
      </main>
    </div>
  );
}
