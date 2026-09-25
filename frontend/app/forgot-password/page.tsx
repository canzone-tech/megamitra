import { AuthPageShell } from '@/components/auth-page-shell';
import { ForgotPasswordForm } from '@/components/auth-recovery-forms';

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      eyebrow="Account recovery"
      title="Forgot your password?"
      description="Enter the email linked to your MegaGoldenClub account. If password recovery is available, we'll send reset instructions."
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
