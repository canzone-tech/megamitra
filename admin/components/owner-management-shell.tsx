'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import styles from './owner-portal.module.css';

type Section =
  | 'dashboard'
  | 'income'
  | 'members'
  | 'binary'
  | 'placement'
  | 'seasons'
  | 'draw'
  | 'winners'
  | 'prizes'
  | 'payments'
  | 'wallet'
  | 'epins'
  | 'auth-codes'
  | 'reports'
  | 'notifications'
  | 'support'
  | 'settings';

type NavItem = { section: Section; label: string; symbol: string; group: string };

const NAV: NavItem[] = [
  { section: 'dashboard', label: 'Dashboard', symbol: '▦', group: 'Main' },
  { section: 'income', label: '9 Income Types', symbol: '↗', group: 'Main' },
  { section: 'members', label: 'Members', symbol: '●', group: 'Main' },
  { section: 'binary', label: 'Binary 2:2 • AB : CD', symbol: '◇', group: 'Main' },
  { section: 'placement', label: 'Placement / Pairing', symbol: '⌁', group: 'Main' },
  { section: 'seasons', label: 'Season Management', symbol: '□', group: 'Season & Draw' },
  { section: 'draw', label: 'Monthly Draw', symbol: '◆', group: 'Season & Draw' },
  { section: 'winners', label: 'Winners', symbol: '★', group: 'Season & Draw' },
  { section: 'prizes', label: 'Prize Catalogue', symbol: '▣', group: 'Season & Draw' },
  { section: 'payments', label: 'Payments / Bills', symbol: '¤', group: 'Finance & Security' },
  { section: 'wallet', label: 'Wallet / Ledger', symbol: '▤', group: 'Finance & Security' },
  { section: 'epins', label: 'E-PIN Management', symbol: '⌘', group: 'Finance & Security' },
  { section: 'auth-codes', label: 'Auth Codes', symbol: '◈', group: 'Finance & Security' },
  { section: 'reports', label: 'Reports', symbol: '▥', group: 'Control' },
  { section: 'notifications', label: 'Notifications', symbol: '◉', group: 'Control' },
  { section: 'support', label: 'Support', symbol: '?', group: 'Control' },
  { section: 'settings', label: 'Settings', symbol: '⚙', group: 'Control' },
];

const GROUPED = NAV.reduce<Array<[string, NavItem[]]>>((groups, item) => {
  const current = groups.find(([group]) => group === item.group);
  if (current) current[1].push(item);
  else groups.push([item.group, [item]]);
  return groups;
}, []);

function href(section: Section) {
  return section === 'dashboard' ? '/operations' : `/portal/${section}`;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function OwnerManagementShell({
  title,
  currentSection,
  currentPath,
  children,
}: {
  title: string;
  currentSection?: Section;
  currentPath?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [mobileMore, setMobileMore] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/session/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/operations">
          <span className={styles.logo}>MG</span>
          <span>
            <span className={styles.brandName}>MEGA<em>GOLDEN</em>CLUB</span>
            <span className={styles.brandSub}>Professional Management Portal</span>
          </span>
        </Link>
        <nav className={styles.menu}>
          {GROUPED.map(([group, items]) => (
            <div key={group}>
              <div className={styles.menuTitle}>{group}</div>
              {items.map((item) => (
                <Link
                  key={item.section}
                  className={classNames(styles.navItem, currentSection === item.section && styles.activeNav)}
                  href={href(item.section)}
                >
                  <span>{item.symbol}</span><span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.profile}>
          <span className={styles.avatar}>A</span>
          <div><b>Administrator</b><span>Owner management access</span></div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.crumb}><b>{title}</b><span>MegaGoldenClub • Professional management portal</span></div>
          <div className={styles.actions}>
            <Link className={classNames(styles.iconButton, styles.linkButton, currentPath === '/presentation' && styles.activeAction)} href="/presentation" aria-label="Appearance">◐</Link>
            <Link className={classNames(styles.iconButton, styles.linkButton, currentPath === '/security' && styles.activeAction)} href="/security" aria-label="Security">◇</Link>
            <button className={styles.logout} type="button" onClick={logout} disabled={busy}>LOG OUT</button>
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </main>

      <nav className={styles.bottom}>
        {(['dashboard', 'income', 'binary', 'seasons', 'draw'] as Section[]).map((key) => {
          const item = NAV.find((entry) => entry.section === key)!;
          return (
            <Link key={key} className={currentSection === key ? styles.activeBottom : ''} href={href(key)}>
              <strong>{item.symbol}</strong>{key === 'dashboard' ? 'Home' : item.label.split(' ')[0]}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMobileMore(true)} className={mobileMore ? styles.activeBottom : ''}><strong>☰</strong>More</button>
      </nav>

      {mobileMore ? <>
        <div className={styles.drawerBackdrop} onClick={() => setMobileMore(false)} />
        <div className={styles.mobileMore}>
          <div className={styles.drawerHead}><b>All management tools</b><button type="button" onClick={() => setMobileMore(false)}>×</button></div>
          {NAV.map((item) => (
            <Link key={item.section} className={classNames(styles.navItem, currentSection === item.section && styles.activeNav)} href={href(item.section)} onClick={() => setMobileMore(false)}>
              <span>{item.symbol}</span><span>{item.label}</span>
            </Link>
          ))}
          <Link className={classNames(styles.navItem, currentPath === '/security' && styles.activeNav)} href="/security" onClick={() => setMobileMore(false)}><span>◇</span><span>Security & Registration</span></Link>
          <Link className={classNames(styles.navItem, currentPath === '/presentation' && styles.activeNav)} href="/presentation" onClick={() => setMobileMore(false)}><span>◐</span><span>Appearance</span></Link>
          <button className={classNames(styles.button, styles.dark)} type="button" onClick={logout}>LOG OUT</button>
        </div>
      </> : null}
    </div>
  );
}
