import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const adminBaseUrl = (process.env.BROWSER_UAT_ADMIN_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');
const memberBaseUrl = (process.env.BROWSER_UAT_MEMBER_URL ?? 'http://127.0.0.1:3102').replace(/\/$/, '');
const adminToken = process.env.UAT_ADMIN_TOKEN ?? '';
const memberToken = process.env.UAT_MEMBER_TOKEN ?? '';
const artifactDir = path.resolve(
  process.env.BROWSER_UAT_ARTIFACT_DIR ?? path.join(rootDir, 'browser-uat-artifacts'),
);

if (!adminToken || !memberToken) {
  throw new Error('UAT_ADMIN_TOKEN and UAT_MEMBER_TOKEN are required for authenticated browser UAT');
}

const processes = [];
let chromeProfileDir = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isExecutable(candidate) {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const configured = process.env.BROWSER_BIN?.trim();
  if (configured) {
    if (!(await isExecutable(configured))) {
      throw new Error(`BROWSER_BIN is not executable: ${configured}`);
    }
    return configured;
  }

  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    const candidate = result.status === 0 ? result.stdout.trim() : '';
    if (candidate && (await isExecutable(candidate))) return candidate;
  }
  throw new Error('Chrome/Chromium executable was not found on the browser UAT runner');
}

function spawnLogged(label, command, args, logPath, extraEnv = {}) {
  const fd = openSync(logPath, 'w');
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  child.label = label;
  child.logPath = logPath;
  processes.push(child);
  return child;
}

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([once(child, 'exit').catch(() => undefined), sleep(2500)]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already exited
    }
    await Promise.race([once(child, 'exit').catch(() => undefined), sleep(1000)]);
  }
}

async function cleanup() {
  for (const child of [...processes].reverse()) await stopProcess(child);
  if (chromeProfileDir) await rm(chromeProfileDir, { recursive: true, force: true });
}

async function waitForUrl(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const log = await readFile(child.logPath, 'utf8').catch(() => '');
      throw new Error(`${child.label} exited while waiting for ${url}\n${log}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  const log = await readFile(child.logPath, 'utf8').catch(() => '');
  throw new Error(`Timed out waiting for ${url}: ${lastError}\n${log}`);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error('Unable to reserve Chrome debugging port');
  return port;
}

async function waitForJson(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const log = await readFile(child.logPath, 'utf8').catch(() => '');
      throw new Error(`Chrome exited during startup\n${log}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // retry while Chrome starts
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Chrome DevTools endpoint: ${url}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      const handlers = this.listeners.get(message.method) ?? [];
      for (const handler of handlers) handler(message.params ?? {});
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to CDP: ${url}`)), 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`Unable to connect to CDP: ${url}`));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function createPage(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about%3Ablank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Unable to create Chrome page target: HTTP ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl || !target.id) throw new Error('Chrome target did not return a debugger URL');
  return { target, client: await CdpClient.connect(target.webSocketDebuggerUrl) };
}

async function closePage(debugPort, target, client) {
  client.close();
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`).catch(() => undefined);
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Runtime evaluation failed');
  }
  return result.result?.value;
}

async function waitForExpression(client, expression, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) return;
    } catch {
      // navigation may transiently invalidate the execution context
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for browser condition: ${description}`);
}

function escapeJs(value) {
  return JSON.stringify(value);
}

async function setAccessCookie(client, baseUrl, name, token) {
  const result = await client.send('Network.setCookie', {
    name,
    value: token,
    url: `${baseUrl}/`,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  });
  if (result.success === false) throw new Error(`Unable to seed browser UAT cookie: ${name}`);
}

async function runScenario(debugPort, scenario) {
  const { target, client } = await createPage(debugPort);
  const consoleErrors = [];
  const pageExceptions = [];
  const serverErrors = [];

  try {
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable'),
    ]);

    client.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error') return;
      const text = (params.args ?? [])
        .map((arg) => String(arg.value ?? arg.description ?? ''))
        .join(' ')
        .trim();
      if (text) consoleErrors.push(text);
    });
    client.on('Runtime.exceptionThrown', (params) => {
      const text = params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text;
      if (text) pageExceptions.push(String(text));
    });
    client.on('Network.responseReceived', (params) => {
      const status = Number(params.response?.status ?? 0);
      const url = String(params.response?.url ?? '');
      if (status >= 500 && (url.startsWith(adminBaseUrl) || url.startsWith(memberBaseUrl))) {
        serverErrors.push(`${status} ${url}`);
      }
    });

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
      mobile: scenario.mobile,
      screenWidth: scenario.width,
      screenHeight: scenario.height,
    });
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: scenario.mobile,
      maxTouchPoints: scenario.mobile ? 5 : 1,
    });

    if (scenario.token) {
      await setAccessCookie(client, scenario.baseUrl, scenario.cookieName, scenario.token);
    }

    const url = `${scenario.baseUrl}${scenario.path}`;
    const navigation = await client.send('Page.navigate', { url });
    if (navigation.errorText) throw new Error(`${scenario.name} navigation failed: ${navigation.errorText}`);
    await waitForExpression(
      client,
      `location.href.startsWith(${escapeJs(scenario.baseUrl)})`,
      `${scenario.name} navigation commit`,
    );
    await waitForExpression(client, 'document.readyState === "complete"', `${scenario.name} document ready`);

    for (const expected of scenario.expectedTexts) {
      await waitForExpression(
        client,
        `document.body && document.body.innerText.includes(${escapeJs(expected)})`,
        `${scenario.name} text: ${expected}`,
      );
    }

    if (scenario.verifyBlankSeasonSetup) {
      const contract = await evaluate(client, `(() => {
        const form = [...document.querySelectorAll('form')].find((node) =>
          node.textContent?.includes('CREATE SEASON')
        );
        if (!form) return { found: false };
        const names = [
          'name', 'code', 'monthlyEmi', 'registrationFee', 'totalMonths',
          'startDate', 'endDate', 'dailyCap', 'pairValue', 'directReferral',
          'eligibilityCutoff', 'carryForward', 'description',
        ];
        const values = Object.fromEntries(names.map((name) => {
          const field = form.querySelector(`[name="${name}"]`);
          return [name, field ? String(field.value ?? '') : '__MISSING__'];
        }));
        const labels = [...form.querySelectorAll('label')].map((node) => node.textContent?.trim());
        return {
          found: true,
          values,
          hasDrawDayControl: Boolean(form.querySelector('[name="drawDay"]')),
          hasDrawDayLabel: labels.includes('Draw Day'),
        };
      })()`);
      if (!contract.found) throw new Error('Season setup form was not found');
      const nonBlank = Object.entries(contract.values)
        .filter(([, value]) => value !== '')
        .map(([name, value]) => `${name}=${value}`);
      if (nonBlank.length) {
        throw new Error(`New season setup contains prefilled values: ${nonBlank.join(', ')}`);
      }
      if (contract.hasDrawDayControl || contract.hasDrawDayLabel) {
        throw new Error('Legacy fixed Draw Day returned to Season Setup');
      }
    }

    if (scenario.action === 'open-admin-mobile-more') {
      const clicked = await evaluate(client, `(() => {
        const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '☰More' || node.textContent?.trim() === 'More' || node.textContent?.includes('More'));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error('Admin mobile More navigation button was not found');
      await waitForExpression(
        client,
        'document.body.innerText.includes("All management tools")',
        'admin mobile navigation drawer',
      );
    }

    const metrics = await evaluate(client, `(() => {
      const root = document.documentElement;
      const body = document.body;
      const memberNav = document.querySelector('nav[aria-label="Member navigation"]');
      const memberNavLabels = memberNav
        ? [...memberNav.querySelectorAll('a,button')]
            .filter((node) => getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden')
            .map((node) => node.textContent?.trim())
            .filter(Boolean)
        : [];
      return {
        href: location.href,
        title: document.title,
        bodyText: body?.innerText ?? '',
        rootClientWidth: root.clientWidth,
        rootScrollWidth: root.scrollWidth,
        bodyScrollWidth: body?.scrollWidth ?? 0,
        primaryHeadings: [...document.querySelectorAll('h1')].map((node) => node.textContent?.trim()).filter(Boolean),
        navLabels: [...document.querySelectorAll('nav a, nav button')].map((node) => node.textContent?.trim()).filter(Boolean),
        memberNavLabels,
        memberNavScrollable: memberNav ? memberNav.scrollWidth > memberNav.clientWidth : false,
        tokenBlue900: getComputedStyle(root).getPropertyValue('--mm-blue-900').trim(),
        tokenMagenta600: getComputedStyle(root).getPropertyValue('--mm-magenta-600').trim(),
      };
    })()`);

    if (metrics.href.includes('/login') && scenario.token) {
      throw new Error(`${scenario.name} redirected an authenticated fixture to login: ${metrics.href}`);
    }
    if (metrics.rootScrollWidth > metrics.rootClientWidth + 2 || metrics.bodyScrollWidth > metrics.rootClientWidth + 2) {
      throw new Error(
        `${scenario.name} has page-level horizontal overflow: root ${metrics.rootScrollWidth}/${metrics.rootClientWidth}, body ${metrics.bodyScrollWidth}/${metrics.rootClientWidth}`,
      );
    }
    if (!metrics.tokenBlue900 || !metrics.tokenMagenta600) {
      throw new Error(`${scenario.name} did not load shared MegaGoldenClub design tokens`);
    }
    if (scenario.requireMemberMobileNav) {
      const required = ['Products', 'Withdrawals', 'KYC', 'Security', 'Public site', 'Sign out'];
      const missing = required.filter((label) => !metrics.memberNavLabels.includes(label));
      if (missing.length) {
        throw new Error(`${scenario.name} hides member mobile navigation actions: ${missing.join(', ')}`);
      }
    }
    if (consoleErrors.length || pageExceptions.length || serverErrors.length) {
      throw new Error(
        `${scenario.name} browser errors: ${JSON.stringify({ consoleErrors, pageExceptions, serverErrors })}`,
      );
    }

    const screenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(path.join(artifactDir, `${scenario.name}.png`), Buffer.from(screenshot.data, 'base64'));
    await writeFile(
      path.join(artifactDir, `${scenario.name}.json`),
      `${JSON.stringify({ ...metrics, bodyText: undefined, consoleErrors, pageExceptions, serverErrors }, null, 2)}\n`,
    );

    console.log(`Browser UAT ${scenario.name}: PASS`);
  } finally {
    await closePage(debugPort, target, client);
  }
}

async function main() {
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });

  const admin = spawnLogged(
    'MegaGoldenClub admin',
    'npm',
    ['--prefix', 'admin', 'run', 'start'],
    path.join(artifactDir, 'admin-next.log'),
    { NODE_ENV: 'production' },
  );
  const member = spawnLogged(
    'MegaGoldenClub member',
    'npm',
    ['--prefix', 'frontend', 'run', 'start'],
    path.join(artifactDir, 'member-next.log'),
    { NODE_ENV: 'production' },
  );

  await Promise.all([
    waitForUrl(`${adminBaseUrl}/login`, admin),
    waitForUrl(`${memberBaseUrl}/login`, member),
  ]);

  const chromeBin = await findChrome();
  const debugPort = await reservePort();
  chromeProfileDir = await mkdtemp(path.join(os.tmpdir(), 'megagoldenclub-browser-uat-'));
  const chrome = spawnLogged(
    'Chrome',
    chromeBin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--no-proxy-server',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${chromeProfileDir}`,
      'about:blank',
    ],
    path.join(artifactDir, 'chrome.log'),
  );

  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, chrome);

  const scenarios = [
    {
      name: 'admin-dashboard-desktop',
      baseUrl: adminBaseUrl,
      path: '/operations',
      cookieName: 'megagoldenclub_admin_access',
      token: adminToken,
      width: 1440,
      height: 1000,
      mobile: false,
      expectedTexts: ['MEGAGOLDENCLUB', 'MegaGoldenClub Management Dashboard', 'Binary 1:4 Rule'],
    },
    {
      name: 'admin-season-setup-desktop',
      baseUrl: adminBaseUrl,
      path: '/portal/seasons',
      cookieName: 'megagoldenclub_admin_access',
      token: adminToken,
      width: 1440,
      height: 1000,
      mobile: false,
      expectedTexts: ['Season Management', 'Create New Season'],
      verifyBlankSeasonSetup: true,
    },
    {
      name: 'admin-appearance-desktop',
      baseUrl: adminBaseUrl,
      path: '/portal/settings#appearance',
      cookieName: 'megagoldenclub_admin_access',
      token: adminToken,
      width: 1440,
      height: 1000,
      mobile: false,
      expectedTexts: ['Settings & Governance', 'Portal Appearance'],
    },
    {
      name: 'admin-dashboard-mobile-nav',
      baseUrl: adminBaseUrl,
      path: '/operations',
      cookieName: 'megagoldenclub_admin_access',
      token: adminToken,
      width: 390,
      height: 844,
      mobile: true,
      expectedTexts: ['MegaGoldenClub Management Dashboard'],
      action: 'open-admin-mobile-more',
    },
    {
      name: 'member-dashboard-desktop',
      baseUrl: memberBaseUrl,
      path: '/member',
      cookieName: 'megagoldenclub_member_access',
      token: memberToken,
      width: 1440,
      height: 1000,
      mobile: false,
      expectedTexts: ['MegaGoldenClub', 'Hello, UAT Member', 'Binary performance'],
    },
    {
      name: 'member-dashboard-mobile-nav',
      baseUrl: memberBaseUrl,
      path: '/member',
      cookieName: 'megagoldenclub_member_access',
      token: memberToken,
      width: 390,
      height: 844,
      mobile: true,
      expectedTexts: ['MegaGoldenClub', 'Hello, UAT Member'],
      requireMemberMobileNav: true,
    },
  ];

  for (const scenario of scenarios) await runScenario(debugPort, scenario);

  await writeFile(
    path.join(artifactDir, 'summary.json'),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      scenarios: scenarios.map(({ name, width, height, mobile, path: route }) => ({ name, width, height, mobile, route })),
    }, null, 2)}\n`,
  );
  console.log(`MegaGoldenClub authenticated browser UAT: PASS (${scenarios.length} scenarios)`);
}

try {
  await main();
} finally {
  await cleanup();
}
