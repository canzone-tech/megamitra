import type { Metadata } from 'next';
import './tokens.css';
import './globals.css';
import './auth-actions.css';

export const metadata: Metadata = {
  title: 'MegaMitra Rewards',
  description: 'MegaMitra member rewards and participation portal',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
