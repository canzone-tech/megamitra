import { AdminForgotPasswordForm } from '@/components/auth-account-forms';
import { AdminAuthPageShell } from '@/components/auth-page-shell';

export default function AdminForgotPasswordPage() {
  return (
    <AdminAuthPageShell
      eyebrow="Account recovery"
      title="Forgot your password?"
      description="Enter the email linked to your administrator account. If it can be used for recovery, we'll send password reset instructions."
    >
      <AdminForgotPasswordForm />
    </AdminAuthPageShell>
  );
}
