import { apiBaseUrl } from '@/lib/server-session';

export const dynamic = 'force-dynamic';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  const { mediaId } = await params;
  if (!/^[a-fA-F0-9]{24}$/.test(mediaId)) return new Response('Not found', { status: 404 });
  try {
    const response = await fetch(`${apiBaseUrl()}/public/prizes/images/${mediaId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body) return new Response('Not found', { status: 404 });
    const type = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!IMAGE_TYPES.has(type)) {
      await response.body.cancel();
      return new Response('Not found', { status: 404 });
    }
    return new Response(response.body, {
      status: 200,
      headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response('Image unavailable', { status: 503 });
  }
}
