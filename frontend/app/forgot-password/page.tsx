import { AuthPageShell } from '@/components/auth-page-shell';
import { ForgotPasswordForm } from '@/components/auth-recovery-forms';

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      eyebrow="Account recovery"
      title="Forgot your password?"
      description="Enter the email attached to your MegaGoldenClub account. The response is intentionally the same whether or not an account matches."
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
