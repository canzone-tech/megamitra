import { AuthPageShell } from '@/components/auth-page-shell';
import { ConfirmEmailChangeForm } from '@/components/auth-recovery-forms';

export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return (
    <AuthPageShell
      eyebrow="Account security"
      title="Confirm your new email"
      description="The new address becomes verified only after this one-time confirmation. Existing sessions are revoked after the change."
    >
      <ConfirmEmailChangeForm token={token} />
    </AuthPageShell>
  );
}
