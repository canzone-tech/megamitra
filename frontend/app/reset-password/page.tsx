import { AuthPageShell } from '@/components/auth-page-shell';
import { ResetPasswordForm } from '@/components/auth-recovery-forms';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return (
    <AuthPageShell
      eyebrow="Account recovery"
      title="Set a new password"
      description="A successful reset revokes every existing session and invalidates other outstanding account-action links."
    >
      <ResetPasswordForm token={token} />
    </AuthPageShell>
  );
}
