'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmailChangeRequestForm } from '@/components/auth-recovery-forms';
import { ApiClientError, apiJson } from '@/lib/client-api';

type Me = {
  username: string;
  email: string | null;
  emailVerifiedAt: string | null;
};

export function MemberSecurity() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');

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

  return (
    <div className="mm-member-shell">
      <header className="mm-site-header">
        <Link className="mm-brand" href="/member"><span className="mm-brand-mark">M</span><span>Mega<span className="mm-brand-accent">Mitra</span></span></Link>
        <nav className="mm-nav"><Link className="mm-button light" href="/member">Dashboard</Link><Link className="mm-button light" href="/">Public site</Link></nav>
      </header>
      <main className="mm-member-main">
        <div className="mm-member-hero">
          <div><p className="mm-eyebrow">Account security</p><h1 className="mm-title">Identity & email</h1><p className="mm-subtitle">Email changes require your current password plus confirmation from the new address. Successful changes revoke existing sessions.</p></div>
        </div>
        {error ? <div className="mm-error" role="alert">{error}</div> : null}
        <div className="mm-wide-grid">
          <section className="mm-card">
            <div className="mm-card-head"><h2>Current identity</h2><span className="mm-chip">{me?.emailVerifiedAt ? 'Verified' : 'Unverified'}</span></div>
            <div className="mm-card-body mm-list">
              <div className="mm-list-row"><span>Username</span><strong>{me?.username ?? 'Loading…'}</strong></div>
              <div className="mm-list-row"><span>Email</span><strong>{me?.email ?? '—'}</strong></div>
              <div className="mm-list-row"><span>Email status</span><strong>{me?.emailVerifiedAt ? 'Verified' : 'Verification pending'}</strong></div>
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
