import Link from 'next/link';
import { OperationsDashboard } from '@/components/operations-dashboard';

export default function OperationsPage() {
  return (
    <>
      <Link className="mm-button mm-floating-action" href="/business-plan">Business plan</Link>
      <OperationsDashboard />
    </>
  );
}
