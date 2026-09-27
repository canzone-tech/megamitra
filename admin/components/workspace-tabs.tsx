'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './owner-portal.module.css';

type WorkspaceTab = {
  id: string;
  label: string;
  count?: number | string;
};

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
  const fallback = initialTab && tabs.some((tab) => tab.id === initialTab)
    ? initialTab
    : tabs[0]?.id ?? '';
  const [activeTab, setActiveTab] = useState(fallback);
  const validIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, '');
    if (fromHash && validIds.has(fromHash)) setActiveTab(fromHash);
  }, [validIds]);

  function activate(id: string) {
    setActiveTab(id);
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      <div className={styles.workspaceTabs} role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.workspaceTab} ${activeTab === tab.id ? styles.workspaceTabActive : ''}`}
            onClick={() => activate(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? <b>{tab.count}</b> : null}
          </button>
        ))}
      </div>
      {children(activeTab)}
    </>
  );
}
