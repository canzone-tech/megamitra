import { AdminForgotPasswordForm } from '@/components/auth-account-forms';
import { AdminAuthPageShell } from '@/components/auth-page-shell';

export default function AdminForgotPasswordPage() {
  return (
    <AdminAuthPageShell
      eyebrow="Account recovery"
      title="Forgot your password?"
      description="Enter the account email. MegaGoldenClub intentionally returns the same response whether or not an eligible account matches."
    >
      <AdminForgotPasswordForm />
    </AdminAuthPageShell>
  );
}
