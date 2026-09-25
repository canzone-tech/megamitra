import { AuthPageShell } from '@/components/auth-page-shell';
import { VerifyEmailForm } from '@/components/auth-recovery-forms';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return (
    <AuthPageShell
      eyebrow="Email verification"
      title="Verify your email"
      description="Confirm your email address using the link we sent you."
    >
      <VerifyEmailForm token={token} />
    </AuthPageShell>
  );
}
