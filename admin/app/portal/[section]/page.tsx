import { notFound } from 'next/navigation';
import { MemberRegistrationAutofillGuard } from '@/components/member-registration-autofill-guard';
import { OwnerControlPortal, type OwnerControlSection } from '@/components/owner-control-portal';
import { OwnerCoreLegacyContent } from '@/components/owner-core-legacy-content';
import type { OwnerCoreSection } from '@/components/owner-core-portal';
import { OwnerCoreV14Portal, type OwnerCoreV14Section } from '@/components/owner-core-v14-portal';
import { OwnerFinancePortal, type OwnerFinanceSection } from '@/components/owner-finance-portal';
import { OwnerKycPanel } from '@/components/owner-kyc-panel';
import { OwnerManagementShell } from '@/components/owner-management-shell';
import { OwnerSeasonAdvancedPanel } from '@/components/owner-season-advanced-panel';
import { SettingsGovernancePortal } from '@/components/settings-governance-portal';

const SECTIONS = new Set([
  'income',
  'members',
  'binary',
  'placement',
  'seasons',
  'draw',
  'winners',
  'prizes',
  'payments',
  'wallet',
  'epins',
  'auth-codes',
  'reports',
  'notifications',
  'support',
  'settings',
]);
const V14_CORE_SECTIONS = new Set<OwnerCoreV14Section>([
  'income',
  'members',
  'binary',
  'placement',
]);
const LEGACY_CORE_SECTIONS = new Set<OwnerCoreSection>([
  'seasons',
  'draw',
  'winners',
  'prizes',
]);
const LEGACY_CORE_TITLES: Record<'seasons' | 'draw' | 'winners' | 'prizes', string> = {
  seasons: 'Season Management',
  draw: 'Monthly Draw',
  winners: 'Winners',
  prizes: 'Prize Catalogue',
};
const FINANCE_SECTIONS = new Set<OwnerFinanceSection>([
  'payments',
  'wallet',
  'epins',
  'auth-codes',
]);
const CONTROL_SECTIONS = new Set<OwnerControlSection>([
  'reports',
  'notifications',
  'support',
]);

type PageProps = { params: Promise<{ section: string }> };

export default async function OwnerPortalSectionPage({ params }: PageProps) {
  const { section } = await params;
  if (!SECTIONS.has(section)) notFound();
  if (section === 'settings') return <SettingsGovernancePortal />;
  if (V14_CORE_SECTIONS.has(section as OwnerCoreV14Section)) {
    const coreSection = section as OwnerCoreV14Section;
    const extension = coreSection === 'members' ? <OwnerKycPanel /> : undefined;
    return (
      <>
        {coreSection === 'members' ? <MemberRegistrationAutofillGuard /> : null}
        <OwnerCoreV14Portal section={coreSection} extension={extension} />
      </>
    );
  }
  if (LEGACY_CORE_SECTIONS.has(section as OwnerCoreSection)) {
    const coreSection = section as 'seasons' | 'draw' | 'winners' | 'prizes';
    const extension = coreSection === 'seasons' ? <OwnerSeasonAdvancedPanel embedded /> : undefined;
    return (
      <OwnerManagementShell title={LEGACY_CORE_TITLES[coreSection]} currentSection={coreSection}>
        <OwnerCoreLegacyContent section={coreSection} extension={extension} />
      </OwnerManagementShell>
    );
  }
  if (FINANCE_SECTIONS.has(section as OwnerFinanceSection)) {
    return <OwnerFinancePortal section={section as OwnerFinanceSection} />;
  }
  if (CONTROL_SECTIONS.has(section as OwnerControlSection)) {
    return <OwnerControlPortal section={section as OwnerControlSection} />;
  }
  notFound();
}
