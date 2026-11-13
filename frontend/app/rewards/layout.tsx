import Link from 'next/link';
import type { ReactNode } from 'react';
import './rewards.css';

export default function PublicRewardsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mm-home mm-rewards-site">
      <a className="mm-home-skip" href="#main-content">Skip to main content</a>
      <header className="mm-home-header">
        <div className="mm-home-header-inner">
          <Link className="mm-home-brand" href="/" aria-label="MegaGoldenClub home">
            <span className="mm-brand-mark" aria-hidden="true">M</span>
            <span>Mega<span className="mm-home-brand-accent">GoldenClub</span><small>MEMBER EXPERIENCE</small></span>
          </Link>
          <nav className="mm-home-nav" aria-label="Primary navigation">
            <Link href="/">Home</Link>
            <Link className="mm-home-nav-reward" href="/rewards">Awards &amp; Rewards</Link>
            <Link className="mm-home-nav-reward" href="/rewards/monthly-prizes">Monthly prizes</Link>
            <Link className="mm-home-nav-login" href="/login">Member login <span aria-hidden="true">↗</span></Link>
          </nav>
        </div>

        <nav className="mm-home-mobile-rewards-nav" aria-label="Rewards shortcuts">
          <Link href="/rewards">Awards &amp; Rewards</Link>
          <Link href="/rewards/monthly-prizes">Monthly prizes</Link>
        </nav>
      </header>
      {children}
      <footer className="mm-home-footer">
        <div className="mm-home-footer-upper">
          <Link className="mm-home-brand mm-home-brand-footer" href="/" aria-label="MegaGoldenClub home">
            <span className="mm-brand-mark" aria-hidden="true">M</span>
            <span>Mega<span className="mm-home-brand-accent">GoldenClub</span><small>MEMBER EXPERIENCE</small></span>
          </Link>
          <nav aria-label="Footer navigation">
            <Link href="/">Home</Link>
            <Link href="/rewards">Awards &amp; Rewards</Link>
            <Link href="/rewards/monthly-prizes">Monthly prizes</Link>
            <Link href="/login">Member login</Link>
          </nav>
        </div>
        <div className="mm-home-footer-lower">
          <span>© {new Date().getFullYear()} MegaGoldenClub. Member participation portal.</span>
          <span>All rewards and prizes depend on official published policies. No award or prize is guaranteed.</span>
        </div>
      </footer>
    </div>
  );
}
