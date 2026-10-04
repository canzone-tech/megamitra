'use client';

import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberSearchSelect } from './member-search-select';
import { OwnerManagementShell } from './owner-management-shell';
import { WorkspaceTabs } from '@/components/workspace-tabs';
import styles from './owner-portal.module.css';

export type OwnerFinanceSection = 'payments' | 'wallet' | 'epins' | 'auth-codes';
type Row = Record<string, unknown>;
type Settings = { companyName?: string; currencyCode?: string; timezone?: string };
type MemberPaymentSettings = {
  upiId: string | null;
  payeeName: string | null;
  qrImageDataUrl: string | null;
  instructions: string | null;
  enabled: boolean | number;
};

const API = '/api/backend/admin/owner-portal';
const TITLES: Record<OwnerFinanceSection, string> = {
  payments: 'Payments / Bills',
  wallet: 'Wallet / Ledger',
  epins: 'E-PIN Management',
  'auth-codes': 'Auth Codes',
};

function text(value: unknown, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
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
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(number(value));
  } catch {
    return `${code} ${number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}
function dateTime(value: unknown) {
  const raw = text(value, '');
  return raw ? raw.replace('T', ' ').slice(0, 19) : '—';
}
function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
function formString(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}
function formNumber(form: FormData, name: string, fallback = 0) {
  const parsed = Number(form.get(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}
async function qrFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('UPI QR must be an image');
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Unable to read UPI QR image'));
    reader.readAsDataURL(file);
  });
  if (raw.length <= 115_000) return raw;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Unable to process UPI QR image'));
    element.src = raw;
  });
  const scale = Math.min(1, 900 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to process UPI QR image');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.9, 0.78, 0.66, 0.54]) {
    const result = canvas.toDataURL('image/jpeg', quality);
    if (result.length <= 115_000) return result;
  }
  throw new Error('UPI QR image is too large. Please crop it and upload again.');
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

export function OwnerFinancePortal({ section }: { section: OwnerFinanceSection }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({});
  const [data, setData] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<Row[]>([]);
  const [wallet, setWallet] = useState<Row | null>(null);
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [memberPaymentSettings, setMemberPaymentSettings] = useState<MemberPaymentSettings | null>(null);
  const [qrImageDataUrl, setQrImageDataUrl] = useState('');
  const [generatedEpins, setGeneratedEpins] = useState<string[]>([]);
  const [generatedAuthCode, setGeneratedAuthCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyPaymentSettings, setBusyPaymentSettings] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleApiError = useCallback((err: unknown) => {
    if (err instanceof ApiClientError && err.status === 401) {
      router.push('/login');
      return;
    }
    if (err instanceof ApiClientError && err.status === 403 && /password/i.test(err.message)) {
      router.push('/change-password');
      return;
    }
    setError(err instanceof Error ? err.message : 'Request failed');
  }, [router]);

  const load = useCallback(async () => {
    try {
      const portalSettings = await apiJson<Settings>(`${API}/settings`);
      if (section === 'payments') {
        const rows = await apiJson<Row[]>(`${API}/payments`);
        setData(rows);
        setSeasons([]);
        try {
          const nextPaymentSettings = await apiJson<MemberPaymentSettings>(
            '/api/backend/admin/member-payments/settings',
          );
          setMemberPaymentSettings(nextPaymentSettings);
          setQrImageDataUrl(nextPaymentSettings.qrImageDataUrl ?? '');
        } catch (settingsError) {
          if (!(settingsError instanceof ApiClientError) || settingsError.status !== 403) {
            throw settingsError;
          }
          setMemberPaymentSettings(null);
          setQrImageDataUrl('');
        }
      } else if (section === 'epins') {
        const [rows, seasonRows] = await Promise.all([
          apiJson<Row[]>(`${API}/epins`),
          apiJson<Row[]>(`${API}/seasons`),
        ]);
        setData(rows);
        setSeasons(seasonRows);
      } else if (section === 'auth-codes') {
        setData(await apiJson<Row[]>(`${API}/auth-codes`));
        setSeasons([]);
      } else {
        setData([]);
        setSeasons([]);
      }
      setSettings(portalSettings);
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, section]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const currencyCode = text(settings.currencyCode, 'INR');

  function showTab(id: string) {
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  async function run<T>(work: () => Promise<T>, success: string, reload = true) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (reload) await load();
      setNotice(success);
      return result;
    } catch (err) {
      handleApiError(err);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run(
      () => apiJson<Row>(`${API}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          memberReference: formString(form, 'memberReference'),
          amount: formString(form, 'amount'),
          paymentType: formString(form, 'paymentType'),
          paymentMode: formString(form, 'paymentMode'),
          transactionReference: formString(form, 'transactionReference') || undefined,
          authorizationCode: formString(form, 'authorizationCode'),
        }),
      }),
      'Payment recorded and receipt generated',
    );
    const nextReceipt = result?.receipt;
    if (nextReceipt && typeof nextReceipt === 'object') {
      setReceipt(nextReceipt as Row);
      showTab('payment-receipt');
    }
  }

  async function savePaymentSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyPaymentSettings(true);
    setError('');
    setNotice('');
    try {
      await apiJson('/api/backend/admin/member-payments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          upiId: formString(form, 'upiId') || undefined,
          payeeName: formString(form, 'payeeName') || undefined,
          qrImageDataUrl: qrImageDataUrl || undefined,
          instructions: formString(form, 'instructions') || undefined,
          enabled: form.get('enabled') === 'on',
        }),
      });
      setNotice('QR / UPI payment settings saved. Members will see the updated payment rail immediately.');
      await load();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusyPaymentSettings(false);
    }
  }

  async function openReceipt(id: string) {
    const row = await run(
      () => apiJson<Row>(`${API}/payments/${encodeURIComponent(id)}`),
      'Receipt loaded',
      false,
    );
    if (row) {
      setReceipt(row);
      showTab('payment-receipt');
    }
  }

  async function lookupWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const member = formString(form, 'member');
    const currency = formString(form, 'currency') || currencyCode;
    const row = await run(
      () => apiJson<Row>(`${API}/wallet?member=${encodeURIComponent(member)}&currency=${encodeURIComponent(currency)}`),
      'Wallet loaded',
      false,
    );
    if (row) {
      setWallet(row);
      showTab('wallet-ledger');
    }
  }

  async function generateEpins(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiresAt = formString(form, 'expiresAt');
    const result = await run(
      () => apiJson<{ generated: Array<{ pin: string }> }>(`${API}/epins`, {
        method: 'POST',
        body: JSON.stringify({
          seasonId: formString(form, 'seasonId'),
          pinType: formString(form, 'pinType') || 'ACTIVATION',
          quantity: formNumber(form, 'quantity', 1),
          assignUserReference: formString(form, 'assignUserReference') || undefined,
          expiresAt: new Date(expiresAt).toISOString(),
        }),
      }),
      'E-PIN batch generated',
    );
    if (result) setGeneratedEpins(result.generated.map((item) => item.pin));
  }

  async function revokeEpin(id: string) {
    await run(
      () => apiJson(`${API}/epins/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Revoked from owner portal' }),
      }),
      'E-PIN revoked',
    );
  }

  async function generateAuthCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run(
      () => apiJson<{ code: string }>(`${API}/auth-codes`, {
        method: 'POST',
        body: JSON.stringify({
          roleScope: formString(form, 'roleScope'),
          purpose: formString(form, 'purpose'),
          validityMinutes: formNumber(form, 'validityMinutes', 30),
        }),
      }),
      'Authorization code generated',
    );
    if (result) setGeneratedAuthCode(result.code);
  }

  return (
    <OwnerManagementShell title={TITLES[section]} currentSection={section}>
      {error ? <div className={classNames(styles.notice, styles.error)}>{error}</div> : null}
      {notice ? <div className={classNames(styles.notice, styles.success)}>{notice}</div> : null}
      {section === 'payments' ? renderPayments() : section === 'wallet' ? renderWallet() : section === 'epins' ? renderEpins() : renderAuthCodes()}
    </OwnerManagementShell>
  );

  function renderPayments() {
    const rows = data;
    return <><Hero title="Payments & Bills" subtitle="Configure QR / UPI, record payments, and keep E-PIN as the alternate payment rail." pill={`${currencyCode} • QR / UPI + E-PIN`} />
      <WorkspaceTabs ariaLabel="Payments workspace" tabs={[
        { id: 'payment-methods', label: 'QR / UPI Settings' },
        { id: 'payment-record', label: 'Record Payment' },
        { id: 'payment-register', label: 'Payment Register', count: rows.length },
        { id: 'payment-receipt', label: 'Receipt Preview' },
      ]}>
        {(activeTab) => <>
          {activeTab === 'payment-methods' ? <div className={styles.card}>
            <SectionHead icon="📲" title="QR / UPI Payment Settings" note="Super Admin controls the member-facing QR payment rail" />
            {memberPaymentSettings ? <form method="post" onSubmit={savePaymentSettings}>
              <div className={styles.fields}>
                <Field label="UPI ID"><input name="upiId" className={styles.input} defaultValue={memberPaymentSettings.upiId ?? ''} placeholder="example@bank" /></Field>
                <Field label="Payee Name"><input name="payeeName" className={styles.input} defaultValue={memberPaymentSettings.payeeName ?? ''} placeholder="Account / business name" /></Field>
                <Field label="UPI QR Image">
                  <input
                    className={styles.input}
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void qrFileToDataUrl(file)
                        .then(setQrImageDataUrl)
                        .catch(handleApiError);
                    }}
                  />
                </Field>
                <Field label="Member QR Payments">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 42 }}>
                    <input name="enabled" type="checkbox" defaultChecked={Boolean(memberPaymentSettings.enabled)} />
                    <span>Enable QR / UPI payment option</span>
                  </label>
                </Field>
                <Field label="Payment Instructions" full>
                  <textarea name="instructions" className={styles.input} rows={3} defaultValue={memberPaymentSettings.instructions ?? ''} placeholder="Example: Scan QR, pay exact amount, then submit UTR and payment screenshot." />
                </Field>
              </div>
              {qrImageDataUrl ? <div className={styles.notice}>
                <b>Current member-facing QR preview</b><br />
                <NextImage src={qrImageDataUrl} alt="Configured UPI payment QR" width={220} height={220} unoptimized style={{ width: 220, maxWidth: '100%', height: 'auto', marginTop: 10, borderRadius: 12 }} />
                <div className={styles.buttonLine}>
                  <button className={classNames(styles.button, styles.outline)} type="button" disabled={busyPaymentSettings} onClick={() => setQrImageDataUrl('')}>REMOVE QR</button>
                </div>
              </div> : <div className={styles.empty}>No UPI QR image configured yet.</div>}
              <div className={styles.buttonLine}>
                <button className={styles.button} disabled={busyPaymentSettings}>{busyPaymentSettings ? 'SAVING…' : 'SAVE QR / UPI SETTINGS'}</button>
              </div>
            </form> : <div className={styles.notice}>QR / UPI settings require Admin / Super Admin access. Saving changes is restricted by the backend to Super Admin.</div>}
          </div> : null}
          {activeTab === 'payment-record' ? <div className={styles.card}><SectionHead icon="💳" title="Record Payment" note="Purpose-bound authorization required" /><form method="post" onSubmit={submitPayment}><div className={styles.fields}><Field label="Member"><MemberSearchSelect name="memberReference" required /></Field><Field label={`Payment Amount (${currencyCode})`}><input name="amount" className={styles.input} inputMode="decimal" required defaultValue="1000" /></Field><Field label="Payment Type"><select name="paymentType" className={styles.select}><option value="MONTHLY_EMI">Monthly EMI</option><option value="REGISTRATION">Registration</option><option value="OTHER">Other</option></select></Field><Field label="Payment Mode"><select name="paymentMode" className={styles.select}><option value="CASH">Cash</option><option value="UPI_ONLINE">UPI / Online</option><option value="BANK_TRANSFER">Bank Transfer</option></select></Field><Field label="Transaction / Receipt Reference"><input name="transactionReference" className={styles.input} placeholder="Optional provider/reference number" /></Field><Field label="Admin / Agent Auth Code"><input name="authorizationCode" className={styles.input} required placeholder="Generate under Auth Codes" /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>SUBMIT PAYMENT</button></div></form></div> : null}
          {activeTab === 'payment-register' ? <div className={styles.card}><SectionHead icon="🧾" title="Payment Register" note="Recorded payments with refund/reconciliation state" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>DATE</th><th>RECEIPT</th><th>MEMBER</th><th>TYPE</th><th>MODE</th><th>AMOUNT</th><th>REFUNDED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>{dateTime(row.occurredAt)}</td><td>{text(row.receiptNumber)}</td><td><b>{text(row.username)}</b><br />{[text(row.firstName, ''), text(row.lastName, '')].filter(Boolean).join(' ') || '—'}</td><td>{text(row.paymentType)}</td><td>{text(row.paymentMode)}</td><td>{money(row.amount, text(row.currencyCode, currencyCode))}</td><td>{money(row.refundedAmount, text(row.currencyCode, currencyCode))}</td><td className={text(row.status) === 'RECORDED' ? styles.status : styles.statusOff}>{text(row.status)}</td><td><button type="button" className={classNames(styles.button, styles.outline)} onClick={() => void openReceipt(text(row.id))}>VIEW RECEIPT</button></td></tr>)}</tbody></table></div> : <Empty>No payments recorded yet.</Empty>}</div> : null}
          {activeTab === 'payment-receipt' ? <div className={styles.card}><SectionHead icon="🧾" title="Receipt Preview" note="Authoritative payment record" />{receipt ? <><div className={styles.notice}><b>{text(receipt.companyName, text(settings.companyName, 'MegaGoldenClub'))}</b> • Receipt {text(receipt.receiptNumber)} • Member {text((receipt.member as Row | undefined)?.fullName)} • User ID {text((receipt.member as Row | undefined)?.username)} • {text(receipt.paymentType)} {money(receipt.amount, text(receipt.currencyCode, currencyCode))} • Season {text((receipt.season as Row | undefined)?.name, 'Unmapped')} • Mode {text(receipt.paymentMode)} • Reference {text(receipt.transactionReference)} • Status {text(receipt.status)} • Refunds {money(receipt.refundedAmount, text(receipt.currencyCode, currencyCode))}.</div><div className={styles.buttonLine}><button className={classNames(styles.button, styles.dark)} type="button" onClick={() => window.print()}>PRINT RECEIPT</button></div></> : <Empty>Submit a payment or open a payment record to preview its receipt.</Empty>}</div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }

  function renderWallet() {
    const entries = wallet && Array.isArray(wallet.recentEntries) ? wallet.recentEntries as Row[] : [];
    const walletCurrency = text(wallet?.currencyCode, currencyCode);
    return <><Hero title="Wallet & Ledger" subtitle="Separate income, reward, adjustment and payout ledger with running balances." pill={`${currencyCode} • AUTHORITATIVE LEDGER`} />
      <WorkspaceTabs ariaLabel="Wallet workspace" tabs={[
        { id: 'wallet-lookup', label: 'Member Lookup' },
        { id: 'wallet-ledger', label: 'Ledger', count: entries.length },
      ]}>
        {(activeTab) => <>
          {activeTab === 'wallet-lookup' ? <div className={styles.card}><SectionHead icon="📒" title="Load Member Wallet" /><form method="post" onSubmit={lookupWallet}><div className={styles.fields}><Field label="Member"><MemberSearchSelect name="member" required /></Field><Field label="Currency"><input name="currency" className={styles.input} value={currencyCode} readOnly /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>VIEW WALLET</button></div></form></div> : null}
          {activeTab === 'wallet-ledger' ? wallet ? <><div className={styles.kpis}><Kpi label="Wallet Balance" value={money(wallet.balance, walletCurrency)} note="Settled balance" /><Kpi label="Total Credits" value={money(wallet.creditTotal, walletCurrency)} note="All posted credits" /><Kpi label="Total Debits" value={money(wallet.debitTotal, walletCurrency)} note="All posted debits" /><Kpi label="Member" value={text((wallet.user as Row | undefined)?.username)} note="Ledger owner" /></div><div className={styles.card}><SectionHead icon="📒" title="Ledger" note={`${entries.length} latest entries`} />{entries.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>DATE</th><th>REFERENCE</th><th>TYPE</th><th>CREDIT</th><th>DEBIT</th><th>BALANCE</th></tr></thead><tbody>{entries.map((entry) => { const credit = text(entry.direction) === 'CREDIT'; return <tr key={text(entry.id)}><td>{dateTime((entry.transaction as Row | undefined)?.occurredAt ?? entry.createdAt)}</td><td>{text((entry.transaction as Row | undefined)?.sourceKey)}</td><td>{text((entry.transaction as Row | undefined)?.type)}</td><td>{credit ? money(entry.amount, walletCurrency) : '—'}</td><td>{credit ? '—' : money(entry.amount, walletCurrency)}</td><td>{money(entry.runningBalance, walletCurrency)}</td></tr>; })}</tbody></table></div> : <Empty>No ledger entries yet.</Empty>}</div></> : <div className={styles.card}><Empty>Load a member wallet first.</Empty></div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }

  function renderEpins() {
    const rows = data;
    return <><Hero title="E-PIN Management" subtitle="Generate, assign, validate, expire, revoke and audit E-PINs." pill="SEASON-AWARE INVENTORY" />
      <WorkspaceTabs ariaLabel="E-PIN workspace" tabs={[
        { id: 'epin-generate', label: 'Generate E-PINs' },
        { id: 'epin-inventory', label: 'Inventory', count: rows.length },
      ]}>
        {(activeTab) => <>
          {activeTab === 'epin-generate' ? <div className={styles.card}><SectionHead icon="➕" title="Generate E-PIN Batch" /><form method="post" onSubmit={generateEpins}><div className={styles.fields}><Field label="Season"><select name="seasonId" className={styles.select} required><option value="">Select active season</option>{seasons.filter((season) => text(season.status) === 'ACTIVE').map((season) => <option key={text(season.id)} value={text(season.id)}>{text(season.name)} • {text(season.status)}</option>)}</select></Field><Field label="E-PIN Type"><select name="pinType" className={styles.select} defaultValue="ACTIVATION"><option value="ACTIVATION">Activation — registration + installment #1</option><option value="INSTALLMENT">Installment — one monthly installment</option></select></Field><Field label="Quantity"><input name="quantity" className={styles.input} type="number" min="1" max="500" defaultValue="5" required /></Field><Field label="Assign Existing Member"><MemberSearchSelect name="assignUserReference" placeholder="Search existing member (optional)" /></Field><Field label="Expiry Date"><input name="expiresAt" className={styles.input} type="datetime-local" required /></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>GENERATE E-PINS</button></div></form>{generatedEpins.length ? <div className={classNames(styles.notice, styles.success)}><b>Copy these new E-PINs now:</b><br />{generatedEpins.join(' • ')}</div> : null}</div> : null}
          {activeTab === 'epin-inventory' ? <div className={styles.card}><SectionHead icon="🔑" title="E-PIN Inventory" note="Expired entries are derived from their expiry timestamp" /><div className={styles.buttonLine}><button className={classNames(styles.button, styles.outline)} type="button" onClick={() => exportCsv(rows, 'epins.csv')}>DOWNLOAD CSV</button></div>{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>E-PIN</th><th>TYPE</th><th>ASSIGNED TO</th><th>SEASON</th><th>CREATED</th><th>EXPIRY</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>••••{text(row.displaySuffix)}</td><td>{text(row.pinType, 'ACTIVATION')}</td><td>{text(row.assignedUsername)}</td><td>{text(row.seasonName)}</td><td>{dateTime(row.createdAt)}</td><td>{dateTime(row.expiresAt)}</td><td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td><td>{text(row.status) === 'ACTIVE' ? <button type="button" className={classNames(styles.button, styles.red)} disabled={busy} onClick={() => void revokeEpin(text(row.id))}>REVOKE</button> : '—'}</td></tr>)}</tbody></table></div> : <Empty>No E-PINs generated yet.</Empty>}</div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }

  function renderAuthCodes() {
    const rows = data;
    return <><Hero title="Authentication & Authorization" subtitle="Admin / agent codes, role controls, expiry and audit protection." pill="PURPOSE-BOUND ONE-TIME CODES" />
      <WorkspaceTabs ariaLabel="Authorization code workspace" tabs={[
        { id: 'authcode-generate', label: 'Generate Code' },
        { id: 'authcode-register', label: 'Authorization Register', count: rows.length },
      ]}>
        {(activeTab) => <>
          {activeTab === 'authcode-generate' ? <div className={styles.card}><SectionHead icon="➕" title="Generate Authorization Code" /><form method="post" onSubmit={generateAuthCode}><div className={styles.fields}><Field label="Role"><select name="roleScope" className={styles.select}><option value="SUPER_ADMIN">Super Admin</option><option value="ADMIN">Admin</option><option value="AGENT">Agent</option></select></Field><Field label="Validity"><select name="validityMinutes" className={styles.select}><option value="30">30 Minutes</option><option value="60">1 Hour</option><option value="1440">24 Hours</option></select></Field><Field label="Operator"><input className={styles.input} value="Current signed-in administrator" readOnly /></Field><Field label="Purpose"><select name="purpose" className={styles.select}><option value="PAYMENT_AUTHORIZATION">Payment Authorization</option><option value="WINNER_APPROVAL">Winner Approval</option><option value="SEASON_CHANGE">Season Change</option><option value="EPIN_OPERATION">E-PIN Operation</option></select></Field></div><div className={styles.buttonLine}><button className={styles.button} disabled={busy}>GENERATE AUTH CODE</button></div></form>{generatedAuthCode ? <div className={classNames(styles.notice, styles.success)}><b>{generatedAuthCode}</b> • Copy this one-time authorization code now. Only its masked suffix remains visible in the register.</div> : null}</div> : null}
          {activeTab === 'authcode-register' ? <div className={styles.card}><SectionHead icon="🔐" title="Authorization Register" note="Operator, purpose, expiry and consumption state" />{rows.length ? <div className={styles.tableBox}><table className={styles.table}><thead><tr><th>CODE</th><th>ROLE</th><th>OPERATOR</th><th>PURPOSE</th><th>CREATED</th><th>EXPIRY</th><th>STATUS</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.id)}><td>••••{text(row.displaySuffix)}</td><td>{text(row.roleScope)}</td><td>{text(row.operatorUsername)}</td><td>{text(row.purpose)}</td><td>{dateTime(row.createdAt)}</td><td>{dateTime(row.expiresAt)}</td><td className={text(row.status) === 'ACTIVE' ? styles.status : styles.statusOff}>{text(row.status)}</td></tr>)}</tbody></table></div> : <Empty>No authorization codes generated yet.</Empty>}</div> : null}
        </>}
      </WorkspaceTabs>
    </>;
  }
}

function exportCsv(rows: Row[], filename: string) {
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => {
    const value = row[key];
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
  })))];
  const escape = (value: unknown) => `"${text(value, '').replaceAll('"', '""')}"`;
  const csv = [keys.map(escape).join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
