'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';

type RegistrationConfig = {
  publicRegistrationEnabled: boolean;
  captchaOnRegistrationEnabled: boolean;
  emailRequired: boolean;
  mobileRequired: boolean;
  passwordMode: 'AUTO' | 'MANUAL' | 'AUTO_OR_MANUAL';
  usernameMode: 'AUTO' | 'MANUAL' | 'AUTO_OR_MANUAL';
  usernamePrefixEnabled: boolean;
  usernamePrefix: string | null;
  passwordMinLength: number;
  passwordMaxLength: number;
  epinRequired: true;
  sponsorLookupEnabled: true;
};

type Sponsor = {
  id: string;
  username: string;
  fullName: string;
  memberType: string;
  status: string;
};

type CaptchaChallenge = {
  captchaId: string;
  prompt: string;
  expiresInSeconds: number;
};

type RegistrationResult = {
  user: {
    id: string;
    username: string;
    email: string | null;
    phone: string | null;
    status: string;
  };
  sponsor: { id: string; username: string; fullName: string } | null;
  placement: { slot?: string; side?: string } | null;
  initialPassword?: string;
};

function formString(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}

export function SignupForm() {
  const [config, setConfig] = useState<RegistrationConfig | null>(null);
  const [sponsorReference, setSponsorReference] = useState('');
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [sponsorResolvedFor, setSponsorResolvedFor] = useState('');
  const [sponsorState, setSponsorState] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  async function loadCaptcha() {
    const challenge = await apiJson<CaptchaChallenge>('/api/backend/captcha/challenge', {
      method: 'POST',
    });
    setCaptcha(challenge);
  }

  function changeSponsorReference(value: string) {
    const reference = value.trim();
    setSponsorReference(value);
    setSponsor(null);
    setSponsorResolvedFor('');
    setSponsorState(reference.length >= 3 ? 'checking' : 'idle');
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await apiJson<RegistrationConfig>('/api/backend/auth/registration-config');
        if (cancelled) return;
        setConfig(loaded);
        if (loaded.publicRegistrationEnabled && loaded.captchaOnRegistrationEnabled) {
          const challenge = await apiJson<CaptchaChallenge>('/api/backend/captcha/challenge', { method: 'POST' });
          if (!cancelled) setCaptcha(challenge);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Registration configuration is unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const reference = sponsorReference.trim();
    if (reference.length < 3) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiJson<Sponsor>(`/api/backend/auth/sponsor?reference=${encodeURIComponent(reference)}`, {
        signal: controller.signal,
      })
        .then((found) => {
          setSponsor(found);
          setSponsorResolvedFor(reference);
          setSponsorState('found');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSponsor(null);
          setSponsorResolvedFor(reference);
          setSponsorState('missing');
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sponsorReference]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config?.publicRegistrationEnabled) return;
    const reference = sponsorReference.trim();
    if (reference && (sponsorState !== 'found' || sponsorResolvedFor !== reference || !sponsor)) {
      setError('Please enter a valid sponsor and wait for the sponsor details to appear.');
      return;
    }

    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const registered = await apiJson<RegistrationResult>('/api/backend/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: formString(form, 'username') || undefined,
          email: formString(form, 'email') || undefined,
          phone: formString(form, 'phone') || undefined,
          password: formString(form, 'password') || undefined,
          fullName: formString(form, 'fullName'),
          dateOfBirth: formString(form, 'dateOfBirth') || undefined,
          state: formString(form, 'state') || undefined,
          city: formString(form, 'city') || undefined,
          memberType: formString(form, 'memberType') || 'PARTNER',
          sponsorReference: reference || undefined,
          epin: formString(form, 'epin'),
          ...(captcha
            ? {
                captchaId: captcha.captchaId,
                captchaAnswer: formString(form, 'captchaAnswer'),
              }
            : {}),
        }),
      });
      setResult(registered);
      event.currentTarget.reset();
      setSponsorReference('');
      setSponsor(null);
      setSponsorState('idle');
      setSponsorResolvedFor('');
      if (config.captchaOnRegistrationEnabled) await loadCaptcha();
    } catch (reason) {
      const message = reason instanceof ApiClientError ? reason.message : 'Unable to complete registration';
      setError(message);
      if (config.captchaOnRegistrationEnabled && /security check|captcha/i.test(message)) {
        try {
          await loadCaptcha();
        } catch {
          setCaptcha(null);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (!config && !error) {
    return <p className="mm-subtitle">Loading registration settings…</p>;
  }

  if (config && !config.publicRegistrationEnabled) {
    return (
      <div>
        <div className="mm-error" role="status">Public registration is currently disabled.</div>
        <Link className="mm-button blue" href="/login">Go to sign in</Link>
      </div>
    );
  }

  const usernameMode = config?.usernameMode ?? 'MANUAL';
  const passwordMode = config?.passwordMode ?? 'MANUAL';

  return (
    <form method="post" autoComplete="off" onSubmit={submit}>
      <div className="mm-field">
        <label htmlFor="sponsorReference">Sponsor ID, mobile or email</label>
        <input
          className="mm-input"
          id="sponsorReference"
          name="sponsorReference"
          value={sponsorReference}
          onChange={(event) => changeSponsorReference(event.target.value)}
          placeholder="Enter sponsor reference"
          autoComplete="off"
        />
        <div aria-live="polite" style={{ minHeight: 20, fontSize: 12 }}>
          {sponsorState === 'checking' ? <span style={{ color: 'var(--mm-ink-500)' }}>Checking sponsor…</span> : null}
          {sponsorState === 'missing' ? <span style={{ color: '#9f1d31' }}>Sponsor not found. Check the ID, mobile or email.</span> : null}
        </div>
      </div>

      {sponsorState === 'found' && sponsor ? (
        <div style={{ margin: '-4px 0 18px', padding: '13px 14px', borderRadius: 13, border: '1px solid rgba(7,150,77,.25)', background: 'var(--mm-green-100)' }}>
          <strong style={{ display: 'block', color: 'var(--mm-green-700)' }}>Sponsor verified ✓</strong>
          <span style={{ display: 'block', marginTop: 5, fontSize: 13 }}><b>{sponsor.fullName}</b> • {sponsor.username}</span>
          <span style={{ display: 'block', marginTop: 3, color: 'var(--mm-ink-500)', fontSize: 12 }}>{sponsor.memberType} • {sponsor.status}</span>
        </div>
      ) : null}

      <div className="mm-field">
        <label htmlFor="epin">E-PIN *</label>
        <input className="mm-input" id="epin" name="epin" required autoComplete="off" placeholder="Required E-PIN" />
      </div>
      <div className="mm-field">
        <label htmlFor="username">Username{usernameMode === 'MANUAL' ? ' *' : ''}</label>
        <input
          className="mm-input"
          id="username"
          name="username"
          required={usernameMode === 'MANUAL'}
          disabled={usernameMode === 'AUTO'}
          autoComplete="off"
          placeholder={usernameMode === 'AUTO' ? 'Generated by system' : 'Choose username'}
        />
      </div>
      <div className="mm-field">
        <label htmlFor="fullName">Full name *</label>
        <input className="mm-input" id="fullName" name="fullName" required autoComplete="name" />
      </div>
      <div className="mm-field">
        <label htmlFor="phone">Mobile{config?.mobileRequired ? ' *' : ''}</label>
        <input className="mm-input" id="phone" name="phone" required={Boolean(config?.mobileRequired)} autoComplete="tel" />
      </div>
      <div className="mm-field">
        <label htmlFor="email">Email{config?.emailRequired ? ' *' : ''}</label>
        <input className="mm-input" id="email" name="email" type="email" required={Boolean(config?.emailRequired)} autoComplete="email" />
      </div>
      <div className="mm-field">
        <label htmlFor="dateOfBirth">Date of birth</label>
        <input className="mm-input" id="dateOfBirth" name="dateOfBirth" type="date" />
      </div>
      <div className="mm-field">
        <label htmlFor="state">State</label>
        <input className="mm-input" id="state" name="state" autoComplete="address-level1" />
      </div>
      <div className="mm-field">
        <label htmlFor="city">City</label>
        <input className="mm-input" id="city" name="city" autoComplete="address-level2" />
      </div>
      <div className="mm-field">
        <label htmlFor="memberType">Member type</label>
        <select className="mm-input" id="memberType" name="memberType" defaultValue="PARTNER">
          <option value="PARTNER">Partner</option>
          <option value="CUSTOMER">Customer</option>
        </select>
      </div>
      <div className="mm-field">
        <label htmlFor="signupPassword">Password{passwordMode === 'MANUAL' ? ' *' : ''}</label>
        <input
          className="mm-input"
          id="signupPassword"
          name="password"
          type="password"
          required={passwordMode === 'MANUAL'}
          disabled={passwordMode === 'AUTO'}
          minLength={config?.passwordMinLength}
          maxLength={config?.passwordMaxLength}
          autoComplete="new-password"
          placeholder={passwordMode === 'AUTO' ? 'Generated by system' : passwordMode === 'AUTO_OR_MANUAL' ? 'Optional — leave blank to generate' : 'Create password'}
        />
      </div>

      {config?.captchaOnRegistrationEnabled ? (
        captcha ? (
          <div className="mm-field">
            <label htmlFor="captchaAnswer">Security check: {captcha.prompt}</label>
            <input className="mm-input" id="captchaAnswer" name="captchaAnswer" inputMode="numeric" autoComplete="off" required />
            <small style={{ color: 'var(--mm-ink-500)' }}>Challenge expires in about {captcha.expiresInSeconds} seconds.</small>
          </div>
        ) : <div className="mm-error">Security check could not be loaded. Refresh and try again.</div>
      ) : null}

      {error ? <div className="mm-error" role="alert">{error}</div> : null}
      <button className="mm-button" type="submit" disabled={busy || Boolean(config?.captchaOnRegistrationEnabled && !captcha)}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>

      {result ? (
        <div style={{ marginTop: 18, padding: 14, borderRadius: 13, background: 'var(--mm-green-100)', color: 'var(--mm-green-700)' }} role="status">
          <strong>Registration submitted successfully.</strong>
          <span style={{ display: 'block', marginTop: 5 }}>Username: <b>{result.user.username}</b> • Status: {result.user.status}</span>
          {result.sponsor ? <span style={{ display: 'block', marginTop: 4 }}>Sponsor: {result.sponsor.fullName} ({result.sponsor.username})</span> : null}
          {result.placement?.slot ? <span style={{ display: 'block', marginTop: 4 }}>Auto placement: Slot {result.placement.slot} • {result.placement.side}</span> : null}
          {result.initialPassword ? <span style={{ display: 'block', marginTop: 7 }}>One-time generated password: <b>{result.initialPassword}</b>. Save it now.</span> : null}
          <span style={{ display: 'block', marginTop: 7 }}>Complete any required verification/activation before signing in.</span>
        </div>
      ) : null}
    </form>
  );
}
