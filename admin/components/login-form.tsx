'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type LoginResponse = {
  user: { mustChangePassword: boolean };
};

type CaptchaChallenge = {
  captchaId: string;
  prompt: string;
  expiresInSeconds: number;
};

type PublicAuthConfig = {
  passwordResetEnabled: boolean;
  emailVerificationEnabled: boolean;
  emailVerificationRequiredForLogin: boolean;
};

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [authConfig, setAuthConfig] = useState<PublicAuthConfig | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiJson<PublicAuthConfig>('/api/backend/auth/public-config')
      .then((config) => {
        if (!cancelled) setAuthConfig(config);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function requestCaptcha(message: string) {
    try {
      const challenge = await apiJson<CaptchaChallenge>('/api/backend/captcha/challenge', { method: 'POST' });
      setCaptcha(challenge);
      setCaptchaAnswer('');
      setError(message);
    } catch {
      setError('A security check is required, but it could not be loaded. Please try again.');
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
      router.replace(result.user.mustChangePassword ? '/change-password' : '/operations');
      router.refresh();
    } catch (reason) {
      if (reason instanceof ApiClientError && /captcha/i.test(reason.message)) {
        await requestCaptcha(captcha ? 'The security check was incorrect or expired. Please try the new challenge.' : 'Please complete the security check and sign in again.');
      } else {
        setError(reason instanceof ApiClientError ? reason.message : 'Unable to sign in');
      }
    } finally {
      setBusy(false);
    }
  }

  const verificationRequired = Boolean(
    authConfig?.emailVerificationEnabled && authConfig.emailVerificationRequiredForLogin,
  );

  return (
    <form method="post" onSubmit={submit}>
      <div className="mm-field">
        <label htmlFor="identifier">Username, email or mobile</label>
        <input className="mm-input" id="identifier" name="identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
      </div>
      <div className="mm-field">
        <label htmlFor="password">Password</label>
        <input className="mm-input" id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </div>
      {(authConfig?.passwordResetEnabled || verificationRequired) ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: -8, marginBottom: 18, fontSize: 13 }}>
          {authConfig?.passwordResetEnabled ? <Link href="/forgot-password">Forgot password?</Link> : null}
          {verificationRequired ? <Link href="/request-email-verification">Resend verification email</Link> : null}
        </div>
      ) : null}
      {captcha ? (
        <div className="mm-field">
          <label htmlFor="captchaAnswer">Security check: {captcha.prompt}</label>
          <input className="mm-input" id="captchaAnswer" name="captchaAnswer" inputMode="numeric" autoComplete="off" value={captchaAnswer} onChange={(event) => setCaptchaAnswer(event.target.value)} required />
          <small style={{ color: 'var(--mm-ink-500)' }}>Challenge expires in about {captcha.expiresInSeconds} seconds.</small>
        </div>
      ) : null}
      {error ? <div className="mm-error" role="alert">{error}</div> : null}
      <button className="mm-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
