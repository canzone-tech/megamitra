import assert from 'node:assert/strict';
import net from 'node:net';
import { canBind, selectVerifyPort } from './select-verify-port.mjs';

const occupied = net.createServer();
await new Promise((resolve, reject) => {
  occupied.once('error', reject);
  occupied.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
});
const address = occupied.address();
assert(address && typeof address !== 'string');
const occupiedPort = address.port;

try {
  const selected = await selectVerifyPort(occupiedPort);
  assert.equal(selected.preferredAvailable, false);
  assert.notEqual(selected.port, occupiedPort);
  assert.equal(await canBind(selected.port), true);
} finally {
  await new Promise((resolve) => occupied.close(resolve));
}

const reusable = await selectVerifyPort(occupiedPort);
assert.equal(reusable.port, occupiedPort);
assert.equal(reusable.preferredAvailable, true);

process.stdout.write('MegaGoldenClub verify port fallback: PASS\n');
