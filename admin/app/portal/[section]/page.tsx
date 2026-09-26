import { notFound } from 'next/navigation';
import { OwnerFinancePortal, type OwnerFinanceSection } from '@/components/owner-finance-portal';
import { OwnerPortal } from '@/components/owner-portal';

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
const FINANCE_SECTIONS = new Set<OwnerFinanceSection>([
  'payments',
  'wallet',
  'epins',
  'auth-codes',
]);

type PageProps = { params: Promise<{ section: string }> };

export default async function OwnerPortalSectionPage({ params }: PageProps) {
  const { section } = await params;
  if (!SECTIONS.has(section)) notFound();
  if (FINANCE_SECTIONS.has(section as OwnerFinanceSection)) {
    return <OwnerFinancePortal section={section as OwnerFinanceSection} />;
  }
  return <OwnerPortal section={section as Parameters<typeof OwnerPortal>[0]['section']} />;
}
