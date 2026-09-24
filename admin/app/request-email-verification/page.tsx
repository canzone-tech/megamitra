import { AdminVerificationRequestForm } from '@/components/auth-account-forms';
import { AdminAuthPageShell } from '@/components/auth-page-shell';

export default function AdminVerificationRequestPage() {
  return (
    <AdminAuthPageShell
      eyebrow="Email verification"
      title="Need a verification link?"
      description="Enter the account email. The response does not disclose whether an eligible account exists."
    >
      <AdminVerificationRequestForm />
    </AdminAuthPageShell>
  );
}
