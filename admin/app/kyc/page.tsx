import { redirect } from 'next/navigation';

export default function KycAdminPage() {
  redirect('/portal/members#kyc');
}
