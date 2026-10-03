'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  OWNER_MANAGEMENT_GROUPS,
  OWNER_MANAGEMENT_NAV,
  ownerManagementHref,
  type OwnerManagementSection,
} from './owner-management-nav';
import styles from './owner-portal.module.css';

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function OwnerManagementShell({
  title,
  currentSection,
  children,
}: {
  title: string;
  currentSection?: OwnerManagementSection;
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
          {OWNER_MANAGEMENT_GROUPS.map(([group, items]) => (
            <div key={group}>
              <div className={styles.menuTitle}>{group}</div>
              {items.map((item) => (
                <Link
                  key={item.section}
                  className={classNames(styles.navItem, currentSection === item.section && styles.activeNav)}
                  href={ownerManagementHref(item.section)}
                >
                  <span aria-hidden="true">{item.symbol}</span><span>{item.label}</span>
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
            <button className={styles.logout} type="button" onClick={logout} disabled={busy}>LOG OUT</button>
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </main>

      <nav className={styles.bottom}>
        {(['dashboard', 'income', 'binary', 'seasons', 'draw'] as OwnerManagementSection[]).map((key) => {
          const item = OWNER_MANAGEMENT_NAV.find((entry) => entry.section === key)!;
          return (
            <Link key={key} className={currentSection === key ? styles.activeBottom : ''} href={ownerManagementHref(key)}>
              <strong aria-hidden="true">{item.symbol}</strong>{key === 'dashboard' ? 'Home' : item.label.split(' ')[0]}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMobileMore(true)} className={mobileMore ? styles.activeBottom : ''}><strong>☰</strong>More</button>
      </nav>

      {mobileMore ? <>
        <div className={styles.drawerBackdrop} onClick={() => setMobileMore(false)} />
        <div className={styles.mobileMore}>
          <div className={styles.drawerHead}><b>All management tools</b><button type="button" onClick={() => setMobileMore(false)}>×</button></div>
          {OWNER_MANAGEMENT_NAV.map((item) => (
            <Link key={item.section} className={classNames(styles.navItem, currentSection === item.section && styles.activeNav)} href={ownerManagementHref(item.section)} onClick={() => setMobileMore(false)}>
              <span aria-hidden="true">{item.symbol}</span><span>{item.label}</span>
            </Link>
          ))}
          <button className={classNames(styles.button, styles.dark)} type="button" onClick={logout}>LOG OUT</button>
        </div>
      </> : null}
    </div>
  );
}
