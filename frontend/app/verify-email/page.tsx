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
      description="Confirm the address attached to your account using the one-time link that was sent to you."
    >
      <VerifyEmailForm token={token} />
    </AuthPageShell>
  );
}
