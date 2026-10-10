'use client';

import { useEffect, useState } from 'react';

type Props = { username: string };

export function MemberReferralCard({ username }: Props) {
  const [origin, setOrigin] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const referralLink = origin && username
    ? new URL('/signup?sponsor=' + encodeURIComponent(username), origin).toString()
    : '';
  const whatsappMessage = referralLink
    ? 'Join MegaGoldenClub with my sponsor ID ' + username +
      '. Register here: ' + referralLink +
      ' (a valid Activation E-PIN is required to join).'
    : '';
  const whatsappUrl = whatsappMessage
    ? 'https://wa.me/?text=' + encodeURIComponent(whatsappMessage)
    : '';

  async function copyReferralLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopyStatus('Referral link copied.');
    } catch {
      setCopyStatus('Could not copy automatically. Select and copy the referral link shown above.');
    }
  }

  return (
    <section className="mm-card mm-referral-card" aria-label="My referral details">
      <div className="mm-card-head">
        <h2>My referral code</h2>
        <span className="mm-chip">Share & invite</span>
      </div>
      <div className="mm-card-body mm-referral-body">
        <div className="mm-referral-identity">
          <span className="mm-referral-label">Your Sponsor / Referral ID</span>
          <strong data-referral-code>{username}</strong>
          <p>Invite new members with this ID. It is the same as your MegaGoldenClub username.</p>
        </div>
        <div className="mm-referral-share">
          <label htmlFor="memberReferralLink">Your invitation link</label>
          <input
            id="memberReferralLink"
            className="mm-input mm-referral-url"
            data-referral-link
            type="text"
            readOnly
            value={referralLink}
            placeholder="Preparing your referral link…"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="mm-referral-actions">
            <button
              className="mm-button blue"
              type="button"
              data-referral-copy
              disabled={!referralLink}
              onClick={() => void copyReferralLink()}
            >
              <span aria-hidden="true">🔗</span> Copy referral link
            </button>
            {whatsappUrl ? (
              <a
                className="mm-button mm-referral-whatsapp"
                data-referral-whatsapp
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span aria-hidden="true">💬</span> Share on WhatsApp
              </a>
            ) : (
              <span className="mm-button mm-referral-whatsapp mm-referral-disabled" aria-disabled="true">
                Share on WhatsApp
              </span>
            )}
          </div>
          {copyStatus ? <p role="status" className="mm-referral-copy-status">{copyStatus}</p> : null}
          <p className="mm-referral-note">The signup form verifies your sponsor ID. New members still need a valid Activation E-PIN to register.</p>
        </div>
      </div>
    </section>
  );
}
