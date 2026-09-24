'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type LoginResponse = { user: { mustChangePassword: boolean } };
type CaptchaChallenge = { captchaId: string; prompt: string; expiresInSeconds: number };

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestCaptcha(message: string) {
    try {
      const challenge = await apiJson<CaptchaChallenge>('/api/backend/captcha/challenge', { method: 'POST' });
      setCaptcha(challenge);
      setCaptchaAnswer('');
      setError(message);
    } catch {
      setError('CAPTCHA is required, but a challenge could not be loaded. Please try again.');
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await apiJson<LoginResponse>('/api/session/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier,
          password,
          ...(captcha ? { captchaId: captcha.captchaId, captchaAnswer } : {}),
        }),
      });
      router.replace(result.user.mustChangePassword ? '/member/change-password' : '/member');
      router.refresh();
    } catch (reason) {
      if (reason instanceof ApiClientError && /captcha/i.test(reason.message)) {
        await requestCaptcha(captcha ? 'CAPTCHA was incorrect or expired. Please solve the new challenge.' : 'CAPTCHA verification is enabled. Please solve the challenge and sign in again.');
      } else {
        setError(reason instanceof ApiClientError ? reason.message : 'Unable to sign in');
      }
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
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: -8, marginBottom: 18, fontSize: 13 }}>
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/request-email-verification">Resend verification email</Link>
      </div>
      {captcha ? (
        <div className="mm-field">
          <label htmlFor="captchaAnswer">Security check: {captcha.prompt}</label>
          <input className="mm-input" id="captchaAnswer" inputMode="numeric" autoComplete="off" value={captchaAnswer} onChange={(event) => setCaptchaAnswer(event.target.value)} required />
          <small style={{ color: 'var(--mm-ink-500)' }}>Challenge expires in about {captcha.expiresInSeconds} seconds.</small>
        </div>
      ) : null}
      {error ? <div className="mm-error" role="alert">{error}</div> : null}
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Open my dashboard'}</button>
    </form>
  );
}
