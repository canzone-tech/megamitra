'use client';

import type { CSSProperties, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiJson } from '@/lib/client-api';

export type RuntimeTheme = {
  primary: string; secondary: string; accent: string; pageBackground: string; cardBackground: string;
  textColor: string; mutedTextColor: string; borderColor: string; gradientFrom: string; gradientVia: string;
  gradientTo: string; radius: 'SMALL' | 'MEDIUM' | 'LARGE'; density: 'COMPACT' | 'COMFORTABLE' | 'SPACIOUS';
  shadow: 'SUBTLE' | 'MEDIUM' | 'STRONG';
};
export type RuntimeTemplate = {
  sidebarVisible: boolean; sidebarPosition: 'LEFT' | 'RIGHT'; sidebarWidth: 'COMPACT' | 'DEFAULT' | 'WIDE';
  sidebarStyle: 'LIGHT' | 'DARK' | 'BRAND'; navigationStyle: 'FLAT' | 'PILL'; topbarVisible: boolean;
  topbarSticky: boolean; topbarStyle: 'LIGHT' | 'DARK' | 'BRAND' | 'GLASS'; topbarDensity: 'COMPACT' | 'COMFORTABLE';
  contentWidth: 'STANDARD' | 'WIDE' | 'FULL'; mobileNavigation: 'BOTTOM' | 'DRAWER';
};
export type RuntimeCms = {
  dashboardEyebrow: string; dashboardSubtitle: string; binarySectionTitle: string; programSectionTitle: string;
  walletSectionTitle: string; rewardsSectionTitle: string;
};
type Part<T> = { source: 'PUBLISHED' | 'DEFAULT'; versionId: string | null; version: number | null; content: T };
export type PresentationRuntime = { surface: string; theme: Part<RuntimeTheme>; template: Part<RuntimeTemplate>; cms: Part<RuntimeCms> };

const defaults: PresentationRuntime = {
  surface: 'MEMBER',
  theme: { source: 'DEFAULT', versionId: null, version: null, content: {
    primary: '#0B5EC7', secondary: '#C90067', accent: '#F4B51C', pageBackground: '#F6F7FB', cardBackground: '#FFFFFF',
    textColor: '#17152B', mutedTextColor: '#74788B', borderColor: '#E7E9F1', gradientFrom: '#0B5EC7',
    gradientVia: '#C90067', gradientTo: '#F4B51C', radius: 'MEDIUM', density: 'COMFORTABLE', shadow: 'SUBTLE',
  } },
  template: { source: 'DEFAULT', versionId: null, version: null, content: {
    sidebarVisible: true, sidebarPosition: 'LEFT', sidebarWidth: 'DEFAULT', sidebarStyle: 'LIGHT', navigationStyle: 'PILL',
    topbarVisible: true, topbarSticky: true, topbarStyle: 'GLASS', topbarDensity: 'COMFORTABLE', contentWidth: 'WIDE',
    mobileNavigation: 'BOTTOM',
  } },
  cms: { source: 'DEFAULT', versionId: null, version: null, content: {
    dashboardEyebrow: 'My MegaGoldenClub',
    dashboardSubtitle: 'See your program progress, wallet, referrals, binary rewards, withdrawals and lucky draw activity.',
    binarySectionTitle: 'Binary performance', programSectionTitle: 'Program progress', walletSectionTitle: 'Wallet activity',
    rewardsSectionTitle: 'Rewards & referrals',
  } },
};

const PresentationContext = createContext<PresentationRuntime>(defaults);

export function usePresentationRuntime() {
  return useContext(PresentationContext);
}

export function PresentationRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<PresentationRuntime>(defaults);

  useEffect(() => {
    let active = true;
    void apiJson<PresentationRuntime>('/api/backend/presentation/runtime?surface=MEMBER')
      .then((next) => { if (active) setRuntime(next); })
      .catch(() => { /* Safe compiled defaults remain active if presentation storage is unavailable. */ });
    return () => { active = false; };
  }, []);

  const theme = runtime.theme.content;
  const template = runtime.template.content;
  const cms = runtime.cms.content;
  const style = useMemo(() => ({
    '--portal-primary': theme.primary,
    '--portal-secondary': theme.secondary,
    '--portal-accent': theme.accent,
    '--portal-page': theme.pageBackground,
    '--portal-card': theme.cardBackground,
    '--portal-text': theme.textColor,
    '--portal-muted': theme.mutedTextColor,
    '--portal-border': theme.borderColor,
    '--portal-gradient-from': theme.gradientFrom,
    '--portal-gradient-via': theme.gradientVia,
    '--portal-gradient-to': theme.gradientTo,
  }) as CSSProperties, [theme]);

  return (
    <PresentationContext.Provider value={runtime}>
      <div
        className="mm-runtime-theme"
        style={style}
        data-sidebar-visible={template.sidebarVisible ? 'true' : 'false'}
        data-sidebar-position={template.sidebarPosition}
        data-sidebar-width={template.sidebarWidth}
        data-sidebar-style={template.sidebarStyle}
        data-navigation-style={template.navigationStyle}
        data-topbar-visible={template.topbarVisible ? 'true' : 'false'}
        data-topbar-sticky={template.topbarSticky ? 'true' : 'false'}
        data-topbar-style={template.topbarStyle}
        data-topbar-density={template.topbarDensity}
        data-content-width={template.contentWidth}
        data-mobile-navigation={template.mobileNavigation}
        data-radius={theme.radius}
        data-density={theme.density}
        data-shadow={theme.shadow}
      >
        <div className="mm-runtime-topbar" aria-label="Member portal topbar">
          <div><strong>{cms.dashboardEyebrow}</strong><span>{cms.dashboardSubtitle}</span></div>
          <span className="mm-runtime-status">Secure member workspace</span>
        </div>
        {children}
      </div>
    </PresentationContext.Provider>
  );
}
