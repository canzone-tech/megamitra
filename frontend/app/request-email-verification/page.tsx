import { AuthPageShell } from '@/components/auth-page-shell';
import { RequestEmailVerificationForm } from '@/components/auth-recovery-forms';

export default function RequestEmailVerificationPage() {
  return (
    <AuthPageShell
      eyebrow="Email verification"
      title="Need a new verification link?"
      description="Enter the email linked to your account. If verification is available, we'll send a new link."
    >
      <RequestEmailVerificationForm />
    </AuthPageShell>
  );
}
