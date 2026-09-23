import { NextResponse } from 'next/server';
import { loginMember } from '@/lib/server-session';

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { statusCode: 400, code: 'BAD_REQUEST', message: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const result = await loginMember(payload);
  if (!result.response.ok) {
    const text = await result.response.text();
    return new NextResponse(text || null, {
      status: result.response.status,
      headers: { 'content-type': result.response.headers.get('content-type') ?? 'application/json' },
    });
  }
  return NextResponse.json({ user: result.user });
}
