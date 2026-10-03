import { NextResponse } from 'next/server';
import { authenticatedBackendFetch } from '@/lib/server-session';

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const requestUrl = new URL(request.url);
  const upstreamPath = `/${path.map(encodeURIComponent).join('/')}${requestUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  const upstream = await authenticatedBackendFetch(upstreamPath, { method, headers, body });
  const responseBody = method === 'HEAD' ? null : await upstream.arrayBuffer();
  const responseHeaders = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(responseBody && responseBody.byteLength ? responseBody : null, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
