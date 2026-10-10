'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiClientError, apiJson } from '@/lib/client-api';

const destinations = [
  { href: '/member', label: 'Dashboard', compact: 'Home', icon: '🏠' },
  { href: '/member/payments', label: 'Payments & E-PINs', compact: 'Payments', icon: '💳' },
  { href: '/member/entitlements', label: 'Benefits', compact: 'Benefits', icon: '🎁' },
  { href: '/member/rewards', label: 'Rewards & Lucky Draw', compact: 'Rewards', icon: '🏆' },
  { href: '/member/genealogy', label: 'My Genealogy', compact: 'Genealogy', icon: '🌳' },
  { href: '/member/installments', label: 'Installment history', compact: 'Installments', icon: '📅' },
  { href: '/member/withdrawals', label: 'Withdrawals', compact: 'Withdrawals', icon: '💸' },
  { href: '/member/kyc', label: 'KYC', compact: 'KYC', icon: '✅' },
  { href: '/member/security', label: 'Security', compact: 'Security', icon: '🔒' },
] as const;

export function MemberHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setPortalHost(document.querySelector('.mm-runtime-theme')), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      await apiJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to sign out. Please retry.');
      setSigningOut(false);
    }
  }

  return (
    <header className="mm-site-header">
      <Link className="mm-brand" href="/member" onClick={() => setMoreOpen(false)}>
        <span className="mm-brand-mark">M</span><span>Mega<span className="mm-brand-accent">GoldenClub</span></span>
      </Link>
      <nav className="mm-nav" aria-label="Member navigation">
        {destinations.map((item, index) => (
          <Link
            key={item.href}
            href={item.href}
            data-member-label={item.label}
            aria-current={pathname === item.href ? 'page' : undefined}
            className={'mm-button light mm-member-nav-link' + (index > 2 ? ' mm-member-secondary' : '')}
            onClick={() => setMoreOpen(false)}
          >
            <span className="mm-member-nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="mm-member-nav-desktop">{item.label}</span>
            <span className="mm-member-nav-mobile">{item.compact}</span>
          </Link>
        ))}
        <Link className="mm-button light mm-member-secondary" href="/" data-member-label="Public site" onClick={() => setMoreOpen(false)}>
          <span className="mm-member-nav-icon" aria-hidden="true">🌐</span>Public site
        </Link>
        <button className="mm-button mm-member-secondary mm-member-signout" type="button" data-member-label="Sign out" disabled={signingOut} onClick={() => void signOut()}>
          <span className="mm-member-nav-icon" aria-hidden="true">🚪</span>{signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        <button
          className="mm-button light mm-member-more-trigger"
          type="button"
          data-member-label="More"
          aria-controls="member-more-menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="mm-member-nav-icon" aria-hidden="true">☰</span><span>More</span>
        </button>
      </nav>
      {moreOpen && portalHost ? createPortal(
        <div className="mm-member-more-layer">
          <button className="mm-member-more-scrim" type="button" aria-label="Close member navigation" onClick={() => setMoreOpen(false)} />
        <div
        id="member-more-menu"
        className="mm-member-more-menu"
        aria-label="More member tools"
        onKeyDown={(event) => { if (event.key === 'Escape') setMoreOpen(false); }}
      >
        <strong>More member tools</strong>
        {destinations.slice(3).map((item) => (
          <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} data-member-label={item.label} onClick={() => setMoreOpen(false)}>
            <span aria-hidden="true">{item.icon}</span>{item.label}
          </Link>
        ))}
        <Link href="/" data-member-label="Public site" onClick={() => setMoreOpen(false)}><span aria-hidden="true">🌐</span>Public site</Link>
        <button type="button" data-member-label="Sign out" disabled={signingOut} onClick={() => void signOut()}>
          <span aria-hidden="true">🚪</span>{signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        </div>
        </div>,
        portalHost,
      ) : null}
      {error ? <div className="mm-member-nav-error" role="alert">{error}</div> : null}
    </header>
  );
}
