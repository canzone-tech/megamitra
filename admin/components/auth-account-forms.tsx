'use client';

import { useState } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Result = { tone: 'success' | 'error'; message: string } | null;
type Accepted = { accepted: boolean; message: string };

function ResultMessage({ result }: { result: Result }) {
  if (!result) return null;
  return <div className={result.tone === 'success' ? 'mm-success' : 'mm-error'} role="status">{result.message}</div>;
}

export function AdminForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await apiJson<Accepted>('/api/backend/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResult({ tone: 'success', message: response.message });
    } catch (reason) {
      setResult({ tone: 'error', message: reason instanceof ApiClientError ? reason.message : 'Unable to request password reset' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mm-field"><label htmlFor="admin-recovery-email">Account email</label><input className="mm-input" id="admin-recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
      <ResultMessage result={result} />
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Send reset link'}</button>
    </form>
  );
}

export function AdminVerificationRequestForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await apiJson<Accepted>('/api/backend/auth/email-verification/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResult({ tone: 'success', message: response.message });
    } catch (reason) {
      setResult({ tone: 'error', message: reason instanceof ApiClientError ? reason.message : 'Unable to request verification email' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mm-field"><label htmlFor="admin-verification-email">Account email</label><input className="mm-input" id="admin-verification-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
      <ResultMessage result={result} />
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Send verification link'}</button>
    </form>
  );
}

export function AdminEmailChangeForm() {
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await apiJson<Accepted>('/api/backend/auth/email-change/request', {
        method: 'POST',
        body: JSON.stringify({ newEmail, currentPassword }),
      });
      setResult({ tone: 'success', message: response.message });
      setCurrentPassword('');
    } catch (reason) {
      setResult({ tone: 'error', message: reason instanceof ApiClientError ? reason.message : 'Unable to request email change' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mm-field"><label htmlFor="admin-new-email">New email</label><input className="mm-input" id="admin-new-email" type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required /></div>
      <div className="mm-field"><label htmlFor="admin-current-password">Current password</label><input className="mm-input" id="admin-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
      <ResultMessage result={result} />
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Verify new email'}</button>
    </form>
  );
}
