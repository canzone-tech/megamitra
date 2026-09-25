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
      description="Confirm your new email address. For your security, you'll need to sign in again after the change."
    >
      <ConfirmEmailChangeForm token={token} />
    </AuthPageShell>
  );
}
