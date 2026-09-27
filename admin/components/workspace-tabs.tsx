'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './workspace-tabs.module.css';

type WorkspaceTab = {
  id: string;
  label: string;
  count?: number | string;
};

const WorkspaceTabsDepth = createContext(0);

export function WorkspaceTabs({
  tabs,
  initialTab,
  children,
  ariaLabel = 'Workspace sections',
}: {
  tabs: WorkspaceTab[];
  initialTab?: string;
  children: (activeTab: string) => ReactNode;
  ariaLabel?: string;
}) {
  const depth = useContext(WorkspaceTabsDepth);
  const ownsLocationHash = depth === 0;
  const fallback = initialTab && tabs.some((tab) => tab.id === initialTab)
    ? initialTab
    : tabs[0]?.id ?? '';
  const [activeTab, setActiveTab] = useState(fallback);
  const tabKey = tabs.map((tab) => tab.id).join('|');

  useEffect(() => {
    if (!ownsLocationHash) return;
    const validIds = new Set(tabKey.split('|').filter(Boolean));
    const syncFromHash = () => {
      const fromHash = window.location.hash.replace(/^#/, '');
      if (fromHash && validIds.has(fromHash)) setActiveTab(fromHash);
    };
    const timer = window.setTimeout(syncFromHash, 0);
    window.addEventListener('hashchange', syncFromHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, [ownsLocationHash, tabKey]);

  function activate(id: string) {
    setActiveTab(id);
    if (!ownsLocationHash) return;
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <WorkspaceTabsDepth.Provider value={depth + 1}>
      <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
            onClick={() => activate(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? <b>{tab.count}</b> : null}
          </button>
        ))}
      </div>
      {children(activeTab)}
    </WorkspaceTabsDepth.Provider>
  );
}
