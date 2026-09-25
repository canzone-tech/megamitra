import { AuthPageShell } from '@/components/auth-page-shell';
import { RequestEmailVerificationForm } from '@/components/auth-recovery-forms';

export default function RequestEmailVerificationPage() {
  return (
    <AuthPageShell
      eyebrow="Email verification"
      title="Need a new verification link?"
      description="Enter the account email. For privacy, MegaGoldenClub returns the same response whether or not an eligible account matches."
    >
      <RequestEmailVerificationForm />
    </AuthPageShell>
  );
}
