import net from 'node:net';

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid preferred port: ${value}`);
  }
  return port;
}

export function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => resolve(!error));
    });
  });
}

export function allocateEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve temporary verification port')));
        return;
      }
      const selected = address.port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

export async function selectVerifyPort(preferredPort) {
  const preferred = parsePort(preferredPort);
  if (await canBind(preferred)) return { port: preferred, preferredAvailable: true };
  const port = await allocateEphemeralPort();
  return { port, preferredAvailable: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const preferred = process.argv[2] ?? '3100';
  const selected = await selectVerifyPort(preferred);
  if (!selected.preferredAvailable) {
    process.stderr.write(
      `NOTICE: configured port ${preferred} is already in use; compiled API verification will use temporary port ${selected.port}.\n`,
    );
  }
  process.stdout.write(String(selected.port));
}
