'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

export default function MemberChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiJson('/api/backend/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      router.replace('/member');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mm-login-wrap">
      <section className="mm-login-card" style={{ gridTemplateColumns: '1fr' }}>
        <div className="mm-login-form" style={{ maxWidth: 620, width: '100%', margin: '0 auto' }}>
          <p className="mm-eyebrow">Account security</p>
          <h1 className="mm-title">Choose a new password</h1>
          <p className="mm-subtitle" style={{ marginBottom: 26 }}>Your account requires a password change before the member dashboard can be used.</p>
          <form onSubmit={submit}>
            <div className="mm-field"><label htmlFor="currentPassword">Current password</label><input className="mm-input" id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
            <div className="mm-field"><label htmlFor="newPassword">New password</label><input className="mm-input" id="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div>
            {error ? <div className="mm-error" role="alert">{error}</div> : null}
            <button className="mm-button" disabled={busy} type="submit">{busy ? 'Updating…' : 'Update password'}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
