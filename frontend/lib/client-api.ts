'use client';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const rawMessage = record?.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : `Request failed (${response.status})`;
    throw new ApiClientError(message, response.status, typeof record?.code === 'string' ? record.code : undefined);
  }
  return body as T;
}
