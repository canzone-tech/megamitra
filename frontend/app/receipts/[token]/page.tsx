import { PublicPaymentReceipt } from '@/components/public-payment-receipt';

type PageProps = { params: Promise<{ token: string }> };

export default async function PublicReceiptPage({ params }: PageProps) {
  const { token } = await params;
  return <PublicPaymentReceipt token={token} />;
}
