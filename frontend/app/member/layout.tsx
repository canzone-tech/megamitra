import { PresentationRuntimeProvider } from '@/components/presentation-runtime';
import './member-portal.css';
import './presentation-runtime.css';

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PresentationRuntimeProvider>{children}</PresentationRuntimeProvider>;
}
