'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';

type PaymentRail = {
  enabled: boolean;
  upiId: string | null;
  payeeName: string | null;
  qrImageDataUrl: string | null;
  instructions: string | null;
};

type Season = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  registrationFee: string;
  installmentAmount: string;
  joiningAmount: string;
  installmentCount: number;
  registrationClosesAt: string | null;
};

type InstallmentSummary = {
  enrollmentId: string;
  seasonId: string;
  seasonCode: string;
  seasonName: string;
  currencyCode: string;
  installmentAmount: string;
  installmentCount: number;
  paidInstallmentCount: number;
  remainingInstallmentCount: number;
  nextUnpaidSequence: number | null;
  fullyPaid: boolean;
};

type Config = {
  paymentRail: PaymentRail;
  seasons: Season[];
  installment: InstallmentSummary | null;
};

type Receipt = {
  id?: string;
  receiptNumber: string;
  publicToken?: string;
  receiptUrl?: string | null;
  receiptType?: 'PROVISIONAL' | 'FINAL' | 'REJECTED';
  purpose: 'INSTALLMENT' | 'EPIN_PURCHASE';
  amount: string;
  currencyCode: string;
  providerReference: string;
  status: string;
  details?: Record<string, unknown> | string | null;
  seasonCode?: string;
  seasonName?: string;
  submittedAt: string;
  reviewedAt?: string | null;
};

type MemberEpin = {
  id: string;
  pin: string | null;
  displaySuffix: string;
  status: string;
  seasonCode: string | null;
  seasonName: string | null;
  currencyCode: string | null;
  registrationFee: string | null;
  firstInstallment: string | null;
  expiresAt: string;
  usedAt: string | null;
  assignedAt: string | null;
};

function money(value: string | number | null | undefined, currency = 'INR') {
  const amount = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
  }
}

function dateTime(value: string | null | undefined) {
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

async function fileToPaymentProof(file: File): Promise<string> {
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
  for (const quality of [0.78, 0.65, 0.52, 0.4, 0.3]) {
    const compressed = canvas.toDataURL('image/jpeg', quality);
    if (compressed.length <= 115_000) return compressed;
  }
  throw new Error('Screenshot is still too large. Please crop it and upload again.');
}

export function MemberPayments() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [history, setHistory] = useState<Receipt[]>([]);
  const [epins, setEpins] = useState<MemberEpin[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [epinQuantity, setEpinQuantity] = useState(1);
  const [installmentCount, setInstallmentCount] = useState(1);
  const [installmentProof, setInstallmentProof] = useState('');
  const [epinProof, setEpinProof] = useState('');
  const [installmentFileName, setInstallmentFileName] = useState('');
  const [epinFileName, setEpinFileName] = useState('');
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
        apiJson<MemberEpin[]>('/api/backend/member/payments/epins'),
      ]);
      setConfig(nextConfig);
      setHistory(nextHistory);
      setEpins(nextEpins);
      setSelectedSeasonId((current) => current || nextConfig.seasons[0]?.id || '');
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

  const selectedSeason = useMemo(
    () => config?.seasons.find((season) => season.id === selectedSeasonId) ?? null,
    [config, selectedSeasonId],
  );
  const installment = config?.installment ?? null;
  const installmentAmount = Number(installment?.installmentAmount ?? 0) * installmentCount;
  const epinAmount = Number(selectedSeason?.joiningAmount ?? 0) * epinQuantity;

  async function processProof(
    file: File | undefined,
    setProof: (value: string) => void,
    setName: (value: string) => void,
  ) {
    setError('');
    if (!file) {
      setProof('');
      setName('');
      return;
    }
    try {
      const proof = await fileToPaymentProof(file);
      setProof(proof);
      setName(file.name);
    } catch (reason) {
      setProof('');
      setName('');
      handleError(reason);
    }
  }

  async function submitInstallment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installment || installment.fullyPaid) return;
    if (!installmentProof) {
      setError('Payment screenshot is required');
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const receipt = await apiJson<Receipt>('/api/backend/member/payments/installments', {
        method: 'POST',
        body: JSON.stringify({
          amount: installmentAmount.toFixed(2),
          utr: String(form.get('utr') ?? '').trim(),
          paymentProofDataUrl: installmentProof,
        }),
      });
      setLatestReceipt(receipt);
      setInstallmentProof('');
      setInstallmentFileName('');
      setNotice('Installment payment submitted. Receipt created with PENDING VERIFICATION status.');
      event.currentTarget.reset();
      await load();
    } catch (reason) {
      handleError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function submitEpin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSeason) {
      setError('Select an open session');
      return;
    }
    if (!epinProof) {
      setError('Payment screenshot is required');
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const receipt = await apiJson<Receipt>('/api/backend/member/payments/epins', {
        method: 'POST',
        body: JSON.stringify({
          seasonId: selectedSeason.id,
          quantity: epinQuantity,
          utr: String(form.get('utr') ?? '').trim(),
          paymentProofDataUrl: epinProof,
        }),
      });
      setLatestReceipt(receipt);
      setEpinProof('');
      setEpinFileName('');
      setNotice('E-PIN purchase submitted. E-PINs are generated only after Super Admin verification.');
      event.currentTarget.reset();
      setEpinQuantity(1);
      await load();
    } catch (reason) {
      handleError(reason);
    } finally {
      setBusy(false);
    }
  }

  const rail = config?.paymentRail;

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/member">
          <span className="mm-brand-mark">M</span>
          <span>Mega<span className="mm-brand-accent">GoldenClub</span></span>
        </Link>
        <nav className="mm-nav" aria-label="Payment navigation">
          <Link className="mm-button light" href="/member">Dashboard</Link>
          <Link className="mm-button light" href="/member/entitlements">Products</Link>
          <Link className="mm-button light" href="/member/withdrawals">Withdrawals</Link>
        </nav>
      </header>

      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div>
            <p className="mm-eyebrow">Member payments</p>
            <h1 className="mm-title">Installments & E-PINs</h1>
            <p className="mm-subtitle">Pay by QR / UPI, submit UTR and screenshot, and keep the same public receipt through verification.</p>
            <span className="mm-portal-pill">Super Admin verification required</span>
          </div>
          <button className="mm-button blue" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        {notice ? <div className="mm-success" role="status">{notice}</div> : null}

        <section className="mm-portal-grid">
          <article className="mm-card">
            <div className="mm-card-head"><h2>QR / UPI payment</h2><span className="mm-chip">{rail?.enabled ? 'Available' : 'Unavailable'}</span></div>
            <div className="mm-card-body">
              {rail?.enabled ? (
                <div className="mm-list">
                  {rail.qrImageDataUrl ? <img src={rail.qrImageDataUrl} alt="MegaGoldenClub payment QR" style={{ maxWidth: 280, width: '100%', height: 'auto', borderRadius: 12 }} /> : null}
                  <div><strong>UPI ID</strong><br />{rail.upiId || '—'}</div>
                  <div><strong>Payee</strong><br />{rail.payeeName || '—'}</div>
                  {rail.instructions ? <div><strong>Instructions</strong><br />{rail.instructions}</div> : null}
                </div>
              ) : <p>QR / UPI payment is not currently enabled.</p>}
            </div>
          </article>

          <article className="mm-card">
            <div className="mm-card-head"><h2>Installment status</h2><span className="mm-chip">{installment?.seasonCode ?? 'No enrollment'}</span></div>
            <div className="mm-card-body">
              {installment ? <div className="mm-list">
                <div><strong>{installment.seasonName}</strong><br />Paid {installment.paidInstallmentCount} of {installment.installmentCount} installments</div>
                <div>Remaining: <strong>{installment.remainingInstallmentCount}</strong> • Next unpaid: <strong>{installment.nextUnpaidSequence ?? 'Complete'}</strong></div>
                <div>Per installment: <strong>{money(installment.installmentAmount, installment.currencyCode)}</strong></div>
              </div> : <p>No active session enrollment was found.</p>}
            </div>
          </article>
        </section>

        <section className="mm-portal-grid">
          <article className="mm-card">
            <div className="mm-card-head"><h2>Pay installment</h2><span className="mm-chip">No partial EMI</span></div>
            <div className="mm-card-body">
              <form onSubmit={submitInstallment}>
                <div className="mm-field">
                  <label htmlFor="installmentCount">Installment count</label>
                  <input id="installmentCount" className="mm-input" type="number" min="1" max={Math.max(1, installment?.remainingInstallmentCount ?? 1)} value={installmentCount} disabled={!rail?.enabled || !installment || installment.fullyPaid || busy} onChange={(event) => setInstallmentCount(Math.max(1, Number(event.target.value) || 1))} />
                </div>
                <div className="mm-field"><label>Amount</label><input className="mm-input" value={money(installmentAmount, installment?.currencyCode)} readOnly /></div>
                <div className="mm-field"><label htmlFor="installmentUtr">UTR / reference</label><input id="installmentUtr" name="utr" className="mm-input" minLength={4} maxLength={191} required disabled={busy} /></div>
                <div className="mm-field"><label htmlFor="installmentProof">Payment screenshot</label><input id="installmentProof" className="mm-input" type="file" accept="image/*" required={!installmentProof} disabled={busy} onChange={(event) => void processProof(event.target.files?.[0], setInstallmentProof, setInstallmentFileName)} />{installmentFileName ? <small>{installmentFileName} ready</small> : null}</div>
                <button className="mm-button blue" disabled={busy || !rail?.enabled || !installment || installment.fullyPaid || !installmentProof}>{busy ? 'Submitting…' : 'Submit installment payment'}</button>
              </form>
            </div>
          </article>

          <article className="mm-card">
            <div className="mm-card-head"><h2>Buy E-PINs</h2><span className="mm-chip">Session-bound</span></div>
            <div className="mm-card-body">
              <form onSubmit={submitEpin}>
                <div className="mm-field"><label htmlFor="seasonId">Session</label><select id="seasonId" className="mm-input" value={selectedSeasonId} required disabled={busy} onChange={(event) => setSelectedSeasonId(event.target.value)}><option value="">Select session</option>{config?.seasons.map((season) => <option key={season.id} value={season.id}>{season.name} ({season.code})</option>)}</select></div>
                <div className="mm-field"><label htmlFor="epinQuantity">Quantity</label><input id="epinQuantity" className="mm-input" type="number" min="1" max="100" value={epinQuantity} disabled={busy} onChange={(event) => setEpinQuantity(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></div>
                <div className="mm-field"><label>Amount</label><input className="mm-input" value={money(epinAmount, selectedSeason?.currencyCode)} readOnly /></div>
                <div className="mm-field"><label htmlFor="epinUtr">UTR / reference</label><input id="epinUtr" name="utr" className="mm-input" minLength={4} maxLength={191} required disabled={busy} /></div>
                <div className="mm-field"><label htmlFor="epinProof">Payment screenshot</label><input id="epinProof" className="mm-input" type="file" accept="image/*" required={!epinProof} disabled={busy} onChange={(event) => void processProof(event.target.files?.[0], setEpinProof, setEpinFileName)} />{epinFileName ? <small>{epinFileName} ready</small> : null}</div>
                <button className="mm-button blue" disabled={busy || !rail?.enabled || !selectedSeason || !epinProof}>{busy ? 'Submitting…' : 'Submit E-PIN purchase'}</button>
              </form>
            </div>
          </article>
        </section>

        {latestReceipt ? <section className="mm-card">
          <div className="mm-card-head"><h2>Provisional receipt</h2><span className="mm-chip">{statusLabel(latestReceipt.status)}</span></div>
          <div className="mm-card-body">
            <p><strong>{latestReceipt.receiptNumber}</strong> • {latestReceipt.purpose.replace('_', ' ')} • {money(latestReceipt.amount, latestReceipt.currencyCode)}</p>
            <p>UTR: {latestReceipt.providerReference} • Submitted: {dateTime(latestReceipt.submittedAt)}</p>
            {latestReceipt.receiptUrl ? <Link className="mm-button blue" href={latestReceipt.receiptUrl} target="_blank">Open public receipt</Link> : null}
          </div>
        </section> : null}

        <section className="mm-card">
          <div className="mm-card-head"><h2>Payment receipts</h2><span className="mm-chip">{history.length}</span></div>
          <div className="mm-card-body">
            {history.length ? <div className="mm-list">{history.map((receipt) => {
              const details = detailsObject(receipt.details);
              return <div key={receipt.id ?? receipt.receiptNumber}>
                <strong>{receipt.receiptNumber}</strong> • {receipt.purpose.replace('_', ' ')} • {money(receipt.amount, receipt.currencyCode)}<br />
                <span>{statusLabel(receipt.status)} • UTR {receipt.providerReference} • {receipt.seasonName ?? receipt.seasonCode ?? 'Session'}</span><br />
                <small>{receipt.purpose === 'INSTALLMENT' ? `${String(details.installmentCount ?? '—')} installment(s)` : `${String(details.quantity ?? '—')} E-PIN(s)`} • {dateTime(receipt.submittedAt)}</small>{' '}
                {receipt.receiptUrl ? <Link href={receipt.receiptUrl} target="_blank">Public receipt</Link> : null}
              </div>;
            })}</div> : <p>No payment submissions yet.</p>}
          </div>
        </section>

        <section className="mm-card">
          <div className="mm-card-head"><h2>My E-PINs</h2><span className="mm-chip">{epins.length}</span></div>
          <div className="mm-card-body">
            {epins.length ? <div className="mm-list">{epins.map((epin) => <div key={epin.id}>
              <strong>{epin.pin ?? `••••${epin.displaySuffix}`}</strong> • {epin.status}<br />
              <span>{epin.seasonName ?? epin.seasonCode ?? 'Session'} • Expires {dateTime(epin.expiresAt)}</span>
            </div>)}</div> : <p>No E-PINs assigned yet. Verified purchases will appear here.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
