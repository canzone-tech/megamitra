import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

describe('MegaGoldenClub production hardening integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl = '';

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes dependency-free liveness with hardened response headers', async () => {
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { 'x-request-id': 'hardening-live-check' },
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('megagoldenclub-api');
    expect(response.headers.get('x-request-id')).toBe('hardening-live-check');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('requires MySQL, Redis and MongoDB for readiness', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as {
      status: string;
      services: Record<string, string>;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.services).toEqual({
      mysql: 'up',
      redis: 'up',
      mongodb: 'up',
    });
  });

  it('correlates validation failures without echoing query strings', async () => {
    const response = await fetch(`${baseUrl}/auth/login?token=must-not-echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'hardening-error-check',
      },
      body: JSON.stringify({}),
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.requestId).toBe('hardening-error-check');
    expect(body.path).toBe('/auth/login');
    expect(JSON.stringify(body)).not.toContain('must-not-echo');
  });

  it('rejects malformed request identifiers instead of reflecting them', async () => {
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { 'x-request-id': '<script>bad</script>' },
    });
    const requestId = response.headers.get('x-request-id') ?? '';

    expect(response.status).toBe(200);
    expect(requestId).not.toContain('<script>');
    expect(requestId.length).toBeGreaterThan(10);
  });
});
