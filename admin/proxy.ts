import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const ADMIN_ACCESS_COOKIE = 'megamitra_admin_access';
const ADMIN_REFRESH_COOKIE = 'megamitra_admin_refresh';

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasSession = Boolean(
    request.cookies.get(ADMIN_ACCESS_COOKIE)?.value ||
      request.cookies.get(ADMIN_REFRESH_COOKIE)?.value,
  );
  const isProtected =
    pathname.startsWith('/operations') ||
    pathname.startsWith('/kyc') ||
    pathname.startsWith('/change-password') ||
    pathname.startsWith('/security');

  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (pathname === '/login' && hasSession) {
    return NextResponse.redirect(new URL('/operations', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/login',
    '/operations/:path*',
    '/kyc/:path*',
    '/change-password',
    '/security/:path*',
  ],
};
