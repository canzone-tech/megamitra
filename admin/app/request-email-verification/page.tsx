import { AdminVerificationRequestForm } from '@/components/auth-account-forms';
import { AdminAuthPageShell } from '@/components/auth-page-shell';

export default function AdminVerificationRequestPage() {
  return (
    <AdminAuthPageShell
      eyebrow="Email verification"
      title="Need a verification link?"
      description="Enter the email linked to your administrator account. If verification is available, we'll send a new link."
    >
      <AdminVerificationRequestForm />
    </AdminAuthPageShell>
  );
}
