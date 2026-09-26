import { notFound } from 'next/navigation';
import { OwnerControlPortal, type OwnerControlSection } from '@/components/owner-control-portal';
import { OwnerCorePortal, type OwnerCoreSection } from '@/components/owner-core-portal';
import { OwnerFinancePortal, type OwnerFinanceSection } from '@/components/owner-finance-portal';

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
const CORE_SECTIONS = new Set<OwnerCoreSection>([
  'income',
  'members',
  'binary',
  'placement',
  'seasons',
  'draw',
  'winners',
  'prizes',
]);
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
  'settings',
]);

type PageProps = { params: Promise<{ section: string }> };

export default async function OwnerPortalSectionPage({ params }: PageProps) {
  const { section } = await params;
  if (!SECTIONS.has(section)) notFound();
  if (CORE_SECTIONS.has(section as OwnerCoreSection)) {
    return <OwnerCorePortal section={section as OwnerCoreSection} />;
  }
  if (FINANCE_SECTIONS.has(section as OwnerFinanceSection)) {
    return <OwnerFinancePortal section={section as OwnerFinanceSection} />;
  }
  if (CONTROL_SECTIONS.has(section as OwnerControlSection)) {
    return <OwnerControlPortal section={section as OwnerControlSection} />;
  }
  notFound();
}
