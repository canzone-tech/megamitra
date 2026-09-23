import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const MEMBER_ACCESS_COOKIE = 'megamitra_member_access';
const MEMBER_REFRESH_COOKIE = 'megamitra_member_refresh';

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasSession = Boolean(
    request.cookies.get(MEMBER_ACCESS_COOKIE)?.value ||
      request.cookies.get(MEMBER_REFRESH_COOKIE)?.value,
  );

  if (pathname.startsWith('/member') && !hasSession) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }
  if (pathname === '/login' && hasSession) {
    return NextResponse.redirect(new URL('/member', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/member/:path*'],
};
