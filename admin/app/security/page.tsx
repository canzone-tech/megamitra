import { redirect } from 'next/navigation';

export default function AdminSecurityPage() {
  redirect('/portal/settings#security');
}
