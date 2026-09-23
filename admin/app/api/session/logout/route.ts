import { NextResponse } from 'next/server';
import { authenticatedBackendFetch, clearSession } from '@/lib/server-session';

export async function POST() {
  try {
    await authenticatedBackendFetch('/auth/logout', { method: 'POST' });
  } finally {
    await clearSession();
  }
  return NextResponse.json({ ok: true });
}
