import Link from 'next/link';
import { MemberDashboard } from '@/components/member-dashboard';

export default function MemberPage() {
  return (
    <>
      <Link
        className="mm-button blue"
        href="/member/payments"
        style={{ position: 'fixed', right: '1rem', bottom: '5.5rem', zIndex: 50 }}
      >
        Payments & E-PINs
      </Link>
      <MemberDashboard />
    </>
  );
}
