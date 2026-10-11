#!/usr/bin/env node
// Regression fixture: keep normal local frontend ports busy while a complete
// production smoke/browser UAT runs on its own automatically selected ports.
// This runs only on disposable CI; it never terminates or reuses user processes.
import { spawn } from 'node:child_process';
import net from 'node:net';

const args = process.argv.slice(2);
if (!args.length) throw new Error('Usage: run-with-occupied-frontend-ports.mjs <command> [args...]');

async function occupy(port) {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return server;
}

const occupied = [];
let child;
try {
  for (const port of [3101, 3102]) occupied.push(await occupy(port));
  console.log('Frontend collision regression: ports 3101 and 3102 deliberately occupied');
  child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: process.env });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve(signal ? 1 : (exitCode ?? 1)));
  });
  if (code !== 0) process.exitCode = code;
  else console.log('Frontend collision regression: PASS without touching occupied listeners');
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(occupied.map((server) => new Promise((resolve) => server.close(resolve))));
}
