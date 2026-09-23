'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type LoginResponse = { user: { mustChangePassword: boolean } };

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await apiJson<LoginResponse>('/api/session/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      router.replace(result.user.mustChangePassword ? '/member/change-password' : '/member');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mm-field">
        <label htmlFor="identifier">Username, email or mobile</label>
        <input className="mm-input" id="identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
      </div>
      <div className="mm-field">
        <label htmlFor="password">Password</label>
        <input className="mm-input" id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </div>
      {error ? <div className="mm-error" role="alert">{error}</div> : null}
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Open my dashboard'}</button>
    </form>
  );
}
