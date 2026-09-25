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
      description="Choose a strong new password. After the reset, sign in again with your new password."
    >
      <ResetPasswordForm token={token} />
    </AuthPageShell>
  );
}
