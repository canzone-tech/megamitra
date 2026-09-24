import Link from 'next/link';

export default function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <Link className="mm-button mm-floating-action" href="/presentation">Appearance</Link>
    </>
  );
}
