'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type GenericAccepted = { accepted: boolean; message: string };

type ResultState = { tone: 'success' | 'error'; message: string } | null;

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await apiJson<GenericAccepted>('/api/backend/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResult({ tone: 'success', message: response.message });
    } catch (reason) {
      setResult({
        tone: 'error',
        message: reason instanceof ApiClientError ? reason.message : 'Unable to submit password reset request',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mm-field">
        <label htmlFor="recovery-email">Account email</label>
        <input className="mm-input" id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </div>
      {result ? <div className={result.tone === 'success' ? 'mm-success' : 'mm-error'} role="status">{result.message}</div> : null}
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Send reset link'}</button>
    </form>
  );
}

export function RequestEmailVerificationForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await apiJson<GenericAccepted>('/api/backend/auth/email-verification/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResult({ tone: 'success', message: response.message });
    } catch (reason) {
      setResult({
        tone: 'error',
        message: reason instanceof ApiClientError ? reason.message : 'Unable to request a verification email',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mm-field">
        <label htmlFor="verification-email">Account email</label>
        <input className="mm-input" id="verification-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </div>
      {result ? <div className={result.tone === 'success' ? 'mm-success' : 'mm-error'} role="status">{result.message}</div> : null}
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Send verification link'}</button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setResult({ tone: 'error', message: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await apiJson<{ success: boolean }>('/api/backend/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: password }),
      });
      setResult({ tone: 'success', message: 'Password reset completed. All previous sessions were revoked.' });
      window.setTimeout(() => router.replace('/login'), 900);
    } catch (reason) {
      setResult({ tone: 'error', message: reason instanceof ApiClientError ? reason.message : 'Unable to reset password' });
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <div className="mm-error">This password reset link is missing its secure token.</div>;
  return (
    <form onSubmit={submit}>
      <div className="mm-field"><label htmlFor="new-password">New password</label><input className="mm-input" id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
      <div className="mm-field"><label htmlFor="confirm-password">Confirm new password</label><input className="mm-input" id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
      {result ? <div className={result.tone === 'success' ? 'mm-success' : 'mm-error'} role="status">{result.message}</div> : null}
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
    </form>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState>(null);

  async function verify() {
    if (!token) {
      setResult({ tone: 'error', message: 'This verification link is missing its secure token.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await apiJson<{ success: boolean }>('/api/backend/auth/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setResult({ tone: 'success', message: 'Email verified successfully. You can now sign in when your account is active.' });
    } catch (reason) {
      setResult({ tone: 'error', message: reason instanceof ApiClientError ? reason.message : 'Unable to verify email' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {result ? <div className={result.tone === 'success' ? 'mm-success' : 'mm-error'} role="status">{result.message}</div> : null}
      <button className="mm-button" type="button" disabled={busy || !token} onClick={() => void verify()}>{busy ? 'Verifying…' : 'Verify email'}</button>
    </div>
  );
}

export function ConfirmEmailChangeForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState>(null);

  async function confirmChange() {
    if (!token) {
      setResult({ tone: 'error', message: 'This email-change link is missing its secure token.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await apiJson<{ success: boolean }>('/api/backend/auth/email-change/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setResult({ tone: 'success', message: 'Email changed and verified. Existing sessions were revoked; please sign in again.' });
    } catch (reason) {
      setResult({ tone: 'error', message: reason instanceof ApiClientError ? reason.message : 'Unable to confirm email change' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {result ? <div className={result.tone === 'success' ? 'mm-success' : 'mm-error'} role="status">{result.message}</div> : null}
      <button className="mm-button" type="button" disabled={busy || !token} onClick={() => void confirmChange()}>{busy ? 'Confirming…' : 'Confirm new email'}</button>
    </div>
  );
}

export function EmailChangeRequestForm() {
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await apiJson<GenericAccepted>('/api/backend/auth/email-change/request', {
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
      <div className="mm-field"><label htmlFor="new-email">New email</label><input className="mm-input" id="new-email" type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required /></div>
      <div className="mm-field"><label htmlFor="email-change-password">Current password</label><input className="mm-input" id="email-change-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
      {result ? <div className={result.tone === 'success' ? 'mm-success' : 'mm-error'} role="status">{result.message}</div> : null}
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Verify new email'}</button>
    </form>
  );
}
