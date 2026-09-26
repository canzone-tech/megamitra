'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Row = Record<string, unknown>;
type PlatformConfig = {
  auth: Row;
  security: Row;
  registration: Row;
};

type Role = {
  name: string;
  status: string;
};

const API = '/api/backend/admin/platform-config';

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback = ''): string {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function checked(form: FormData, name: string): boolean {
  return form.get(name) === 'on';
}

function integer(form: FormData, name: string): number {
  return Number(form.get(name));
}

function Check({ name, label, defaultChecked, note }: { name: string; label: string; defaultChecked: boolean; note?: string }) {
  return (
    <label style={{ display: 'flex', gridTemplateColumns: 'none', alignItems: 'flex-start', gap: 10 }}>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} style={{ marginTop: 3 }} />
      <span style={{ display: 'grid', gap: 3, color: 'var(--mm-ink-700)', fontWeight: 800 }}>
        {label}
        {note ? <span style={{ fontWeight: 600 }}>{note}</span> : null}
      </span>
    </label>
  );
}

export function PlatformConfigAdmin() {
  const router = useRouter();
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiClientError && err.status === 401) {
      router.push('/login');
      return;
    }
    setError(err instanceof Error ? err.message : 'Configuration request failed');
  }, [router]);

  const load = useCallback(async () => {
    try {
      const [nextConfig, nextRoles] = await Promise.all([
        apiJson<PlatformConfig>(API),
        apiJson<Role[]>('/api/backend/admin/rbac/roles'),
      ]);
      setConfig(nextConfig);
      setRoles(nextRoles.filter((role) => role.status === 'ACTIVE'));
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(path: string, payload: Row, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiJson(`${API}/${path}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setNotice(success);
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save('auth', {
      loginWithUsername: checked(form, 'loginWithUsername'),
      loginWithEmail: checked(form, 'loginWithEmail'),
      loginWithMobile: checked(form, 'loginWithMobile'),
      captchaOnLoginEnabled: checked(form, 'captchaOnLoginEnabled'),
      captchaOnRegistrationEnabled: checked(form, 'captchaOnRegistrationEnabled'),
      captchaTtlSeconds: integer(form, 'captchaTtlSeconds'),
      accessTokenTtlSeconds: integer(form, 'accessTokenTtlSeconds'),
      refreshTokenTtlSeconds: integer(form, 'refreshTokenTtlSeconds'),
      passwordResetEnabled: checked(form, 'passwordResetEnabled'),
      passwordResetTokenTtlMinutes: integer(form, 'passwordResetTokenTtlMinutes'),
      passwordResetRequestWindowMinutes: integer(form, 'passwordResetRequestWindowMinutes'),
      passwordResetMaxRequestsPerWindow: integer(form, 'passwordResetMaxRequestsPerWindow'),
      emailVerificationEnabled: checked(form, 'emailVerificationEnabled'),
      emailVerificationRequiredForLogin: checked(form, 'emailVerificationRequiredForLogin'),
      emailVerificationTokenTtlMinutes: integer(form, 'emailVerificationTokenTtlMinutes'),
      emailVerificationRequestWindowMinutes: integer(form, 'emailVerificationRequestWindowMinutes'),
      emailVerificationMaxRequestsPerWindow: integer(form, 'emailVerificationMaxRequestsPerWindow'),
      emailChangeEnabled: checked(form, 'emailChangeEnabled'),
    }, 'Authentication configuration saved.');
  }

  async function saveSecurity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save('security', {
      idleTimeoutMinutes: integer(form, 'idleTimeoutMinutes'),
      absoluteSessionTimeoutMinutes: integer(form, 'absoluteSessionTimeoutMinutes'),
      maxActiveSessions: integer(form, 'maxActiveSessions'),
      maxFailedLoginAttempts: integer(form, 'maxFailedLoginAttempts'),
      lockoutMinutes: integer(form, 'lockoutMinutes'),
      passwordMinLength: integer(form, 'passwordMinLength'),
      passwordMaxLength: integer(form, 'passwordMaxLength'),
      refreshTokenRotationEnabled: checked(form, 'refreshTokenRotationEnabled'),
    }, 'Security policy saved.');
  }

  async function saveRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save('registration', {
      publicRegistrationEnabled: checked(form, 'publicRegistrationEnabled'),
      emailRequired: checked(form, 'emailRequired'),
      mobileRequired: checked(form, 'mobileRequired'),
      passwordMode: text(form.get('passwordMode')),
      usernameMode: text(form.get('usernameMode')),
      usernamePrefixEnabled: checked(form, 'usernamePrefixEnabled'),
      usernamePrefix: text(form.get('usernamePrefix')).trim(),
      defaultRoleName: text(form.get('defaultRoleName')).trim(),
      allowMultipleAccountsPerEmail: checked(form, 'allowMultipleAccountsPerEmail'),
      allowMultipleAccountsPerMobile: checked(form, 'allowMultipleAccountsPerMobile'),
    }, 'Registration policy saved.');
  }

  if (!config) {
    return <section className="mm-card"><div className="mm-card-body"><p className="mm-note">Loading platform configuration…</p>{error ? <div className="mm-error">{error}</div> : null}</div></section>;
  }

  const auth = config.auth;
  const security = config.security;
  const registration = config.registration;

  return (
    <div className="mm-grid">
      {error ? <div className="mm-error">{error}</div> : null}
      {notice ? <div className="mm-success">{notice}</div> : null}

      <section className="mm-card">
        <div className="mm-card-head"><h2>Authentication & recovery</h2><span className="mm-chip">DB CONFIG</span></div>
        <div className="mm-card-body">
          <p className="mm-note" style={{ marginBottom: 18 }}>Control allowed login identifiers, CAPTCHA, credential lifetimes and email-based recovery. At least one login method must remain enabled.</p>
          <form className="mm-form" method="post" key={text(auth.updatedAt, 'auth')} onSubmit={saveAuth}>
            <div className="mm-grid two">
              <div className="mm-card-body" style={{ padding: 0 }}>
                <h3>Login methods</h3>
                <Check name="loginWithUsername" label="Username login" defaultChecked={bool(auth.loginWithUsername)} />
                <Check name="loginWithEmail" label="Email login" defaultChecked={bool(auth.loginWithEmail)} />
                <Check name="loginWithMobile" label="Mobile login" defaultChecked={bool(auth.loginWithMobile)} />
                <Check name="captchaOnLoginEnabled" label="CAPTCHA on login" defaultChecked={bool(auth.captchaOnLoginEnabled)} />
                <Check name="captchaOnRegistrationEnabled" label="CAPTCHA on registration" defaultChecked={bool(auth.captchaOnRegistrationEnabled)} />
                <label>CAPTCHA validity (seconds)<input name="captchaTtlSeconds" type="number" min="30" defaultValue={num(auth.captchaTtlSeconds, 300)} required /></label>
                <label>Short-session credential TTL (seconds)<input name="accessTokenTtlSeconds" type="number" min="60" defaultValue={num(auth.accessTokenTtlSeconds, 900)} required /></label>
                <label>Renewal credential TTL (seconds)<input name="refreshTokenTtlSeconds" type="number" min="300" defaultValue={num(auth.refreshTokenTtlSeconds, 2592000)} required /></label>
              </div>
              <div className="mm-card-body" style={{ padding: 0 }}>
                <h3>Recovery & verification</h3>
                <Check name="passwordResetEnabled" label="Password reset" defaultChecked={bool(auth.passwordResetEnabled)} note="Requires SMTP configuration." />
                <label>Password reset token (minutes)<input name="passwordResetTokenTtlMinutes" type="number" min="5" max="1440" defaultValue={num(auth.passwordResetTokenTtlMinutes, 30)} required /></label>
                <label>Reset request window (minutes)<input name="passwordResetRequestWindowMinutes" type="number" min="1" max="1440" defaultValue={num(auth.passwordResetRequestWindowMinutes, 60)} required /></label>
                <label>Max reset requests / window<input name="passwordResetMaxRequestsPerWindow" type="number" min="1" max="100" defaultValue={num(auth.passwordResetMaxRequestsPerWindow, 5)} required /></label>
                <Check name="emailVerificationEnabled" label="Email verification" defaultChecked={bool(auth.emailVerificationEnabled)} note="Requires SMTP configuration." />
                <Check name="emailVerificationRequiredForLogin" label="Require verified email for login" defaultChecked={bool(auth.emailVerificationRequiredForLogin)} />
                <label>Email verification token (minutes)<input name="emailVerificationTokenTtlMinutes" type="number" min="5" max="10080" defaultValue={num(auth.emailVerificationTokenTtlMinutes, 1440)} required /></label>
                <label>Verification request window (minutes)<input name="emailVerificationRequestWindowMinutes" type="number" min="1" max="1440" defaultValue={num(auth.emailVerificationRequestWindowMinutes, 60)} required /></label>
                <label>Max verification requests / window<input name="emailVerificationMaxRequestsPerWindow" type="number" min="1" max="100" defaultValue={num(auth.emailVerificationMaxRequestsPerWindow, 5)} required /></label>
                <Check name="emailChangeEnabled" label="Allow account email change" defaultChecked={bool(auth.emailChangeEnabled)} note="Requires SMTP configuration." />
              </div>
            </div>
            <div><button className="mm-button" type="submit" disabled={busy}>SAVE AUTHENTICATION</button></div>
          </form>
        </div>
      </section>

      <section className="mm-card">
        <div className="mm-card-head"><h2>Session & password security</h2><span className="mm-chip">ENFORCED</span></div>
        <div className="mm-card-body">
          <form className="mm-form" method="post" key={text(security.updatedAt, 'security')} onSubmit={saveSecurity}>
            <div className="mm-grid two">
              <label>Idle timeout (minutes)<input name="idleTimeoutMinutes" type="number" min="1" defaultValue={num(security.idleTimeoutMinutes, 30)} required /></label>
              <label>Absolute session timeout (minutes)<input name="absoluteSessionTimeoutMinutes" type="number" min="1" defaultValue={num(security.absoluteSessionTimeoutMinutes, 1440)} required /></label>
              <label>Maximum active sessions<input name="maxActiveSessions" type="number" min="1" max="100" defaultValue={num(security.maxActiveSessions, 5)} required /></label>
              <label>Failed login attempts before lock<input name="maxFailedLoginAttempts" type="number" min="1" max="100" defaultValue={num(security.maxFailedLoginAttempts, 5)} required /></label>
              <label>Account lock duration (minutes)<input name="lockoutMinutes" type="number" min="1" defaultValue={num(security.lockoutMinutes, 15)} required /></label>
              <label>Minimum password length<input name="passwordMinLength" type="number" min="8" max="256" defaultValue={num(security.passwordMinLength, 12)} required /></label>
              <label>Maximum password length<input name="passwordMaxLength" type="number" min="8" max="256" defaultValue={num(security.passwordMaxLength, 128)} required /></label>
              <Check name="refreshTokenRotationEnabled" label="Rotate renewal credentials" defaultChecked={bool(security.refreshTokenRotationEnabled)} note="Recommended for session replay protection." />
            </div>
            <div><button className="mm-button" type="submit" disabled={busy}>SAVE SECURITY POLICY</button></div>
          </form>
        </div>
      </section>

      <section className="mm-card">
        <div className="mm-card-head"><h2>Registration policy</h2><span className="mm-chip warning">BEFORE MEMBER ONBOARDING</span></div>
        <div className="mm-card-body">
          <p className="mm-note" style={{ marginBottom: 18 }}>Configure member account creation before onboarding starts. The default role must be an active RBAC role.</p>
          <form className="mm-form" method="post" key={text(registration.updatedAt, 'registration')} onSubmit={saveRegistration}>
            <div className="mm-grid two">
              <div className="mm-card-body" style={{ padding: 0 }}>
                <Check name="publicRegistrationEnabled" label="Public/self registration enabled" defaultChecked={bool(registration.publicRegistrationEnabled)} />
                <Check name="emailRequired" label="Email required" defaultChecked={bool(registration.emailRequired)} />
                <Check name="mobileRequired" label="Mobile required" defaultChecked={bool(registration.mobileRequired)} />
                <Check name="allowMultipleAccountsPerEmail" label="Allow multiple accounts per email" defaultChecked={bool(registration.allowMultipleAccountsPerEmail)} />
                <Check name="allowMultipleAccountsPerMobile" label="Allow multiple accounts per mobile" defaultChecked={bool(registration.allowMultipleAccountsPerMobile)} />
              </div>
              <div className="mm-card-body" style={{ padding: 0 }}>
                <label>Password creation<select name="passwordMode" defaultValue={text(registration.passwordMode, 'MANUAL')}><option value="MANUAL">Member/Admin enters password</option><option value="AUTO">System generates password</option><option value="AUTO_OR_MANUAL">Either auto or manual</option></select></label>
                <label>Username creation<select name="usernameMode" defaultValue={text(registration.usernameMode, 'AUTO_OR_MANUAL')}><option value="AUTO">System generates username</option><option value="MANUAL">Member/Admin enters username</option><option value="AUTO_OR_MANUAL">Either auto or manual</option></select></label>
                <Check name="usernamePrefixEnabled" label="Use username prefix" defaultChecked={bool(registration.usernamePrefixEnabled)} />
                <label>Username prefix<input name="usernamePrefix" maxLength={20} defaultValue={text(registration.usernamePrefix)} placeholder="MGC" /></label>
                <label>Default member role<select name="defaultRoleName" defaultValue={text(registration.defaultRoleName, 'MEMBER')} required>{roles.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select></label>
              </div>
            </div>
            <div><button className="mm-button" type="submit" disabled={busy || roles.length === 0}>SAVE REGISTRATION POLICY</button></div>
          </form>
        </div>
      </section>
    </div>
  );
}
