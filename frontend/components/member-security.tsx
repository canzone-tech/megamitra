'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmailChangeRequestForm } from '@/components/auth-recovery-forms';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberHeader } from '@/components/member-header';

type Me = {
  username: string;
  email: string | null;
  emailVerifiedAt: string | null;
};

export function MemberSecurity() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [verificationNotice, setVerificationNotice] = useState('');
  const [requestingVerification, setRequestingVerification] = useState(false);

  const load = useCallback(async () => {
    try {
      setMe(await apiJson<Me>('/api/backend/auth/me'));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login');
        return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load account security details');
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function requestVerification() {
    if (!me?.email || requestingVerification) return;
    setRequestingVerification(true);
    setVerificationNotice('');
    setError('');
    try {
      const response = await apiJson<{ message: string }>('/api/backend/auth/email-verification/request', {
        method: 'POST',
        body: JSON.stringify({ email: me.email }),
      });
      setVerificationNotice(response.message);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to request email verification');
    } finally {
      setRequestingVerification(false);
    }
  }

  return (
    <div className="mm-member-shell">
      <MemberHeader />
      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div><p className="mm-eyebrow">Account security</p><h1 className="mm-title">Identity & email</h1><p className="mm-subtitle">To change your email, enter your current password and confirm the new address. For your security, you will be signed out after the change.</p></div>
        </div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        <div className="mm-wide-grid mm-security-identity-grid">
          <section className="mm-card">
            <div className="mm-card-head"><h2>Current identity</h2><span className="mm-chip">{!me ? 'Loading' : me.emailVerifiedAt ? 'Verified' : 'Unverified'}</span></div>
            <div className="mm-card-body mm-list">
              <div className="mm-list-row"><span>Username</span><strong>{me?.username ?? 'Loading…'}</strong></div>
              <div className="mm-list-row"><span>Email</span><strong>{me?.email ?? '—'}</strong></div>
              <div className="mm-list-row"><span>Email status</span><strong>{!me ? 'Loading…' : me.emailVerifiedAt ? 'Verified' : 'Verification pending'}</strong></div>
              {me?.email && !me.emailVerifiedAt ? <div className="mm-member-verify-email"><p>Verify your current email address to complete your profile.</p><button className="mm-button light" type="button" disabled={requestingVerification} onClick={() => void requestVerification()}>{requestingVerification ? 'Sending…' : 'Resend verification link'}</button>{verificationNotice ? <div className="mm-success" role="status">{verificationNotice}</div> : null}</div> : null}
            </div>
          </section>
          <section className="mm-card">
            <div className="mm-card-head"><h2>Change email</h2><span className="mm-chip">Re-verification required</span></div>
            <div className="mm-card-body"><EmailChangeRequestForm /></div>
          </section>
        </div>
      </main>
    </div>
  );
}
