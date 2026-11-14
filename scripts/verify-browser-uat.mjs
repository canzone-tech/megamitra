import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectVerifyPort } from '../backend/scripts/select-verify-port.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
let adminBaseUrl = (process.env.BROWSER_UAT_ADMIN_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');
let memberBaseUrl = (process.env.BROWSER_UAT_MEMBER_URL ?? 'http://127.0.0.1:3102').replace(/\/$/, '');
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

function spawnLogged(label, command, args, logPath, extraEnv = {}, cwd = rootDir) {
  const fd = openSync(logPath, 'w');
  const child = spawn(command, args, {
    cwd,
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
  const memberApiErrors = [];
  const withdrawalApiErrors = [];

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
      if (status >= 400 && url.startsWith(`${memberBaseUrl}/api/backend/`)) {
        memberApiErrors.push(`${status} ${url}`);
      }
      if (status >= 400 && url.includes('/api/backend/admin/withdrawals/')) {
        withdrawalApiErrors.push(`${status} ${url}`);
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
      try {
        await waitForExpression(
          client,
          `document.body && document.body.innerText.includes(${escapeJs(expected)})`,
          `${scenario.name} text: ${expected}`,
        );
      } catch (error) {
        // Report the failed component's state without dumping member data or credentials.
        const state = await evaluate(client, `(() => ({
          route: location.pathname,
          headings: [...document.querySelectorAll("h1")].map((node) => node.textContent?.trim()),
          error: document.querySelector(".mm-error[role=alert]")?.textContent?.trim() ?? null,
          loading: Boolean([...document.querySelectorAll(".mm-empty")].some((node) => node.textContent?.includes("Loading"))),
        }))()`).catch(() => ({ unavailable: true }));
        throw new Error(`${error.message}; diagnostics: ${JSON.stringify({ state, memberApiErrors, serverErrors, pageExceptions })}`);
      }
    }



    if (scenario.verifyPasswordVisibility) {
      await waitForExpression(client,
        `document.querySelectorAll('.mm-password-field').length === ${scenario.verifyPasswordVisibility}`,
        `${scenario.name} password controls mounted`);
      // Exercise real client-side React handlers on both desktop and mobile.
      // No credentials are sent to any API or included in test output.
      await sleep(150);
      const checks = await evaluate(client, `(async () => {
        const fields = [...document.querySelectorAll('.mm-password-field')];
        const results = [];
        for (const field of fields) {
          const input = field.querySelector('input');
          const toggle = field.querySelector('button');
          if (!input || !toggle) { results.push({ missingControl: true }); continue; }
          const originalValue = input.value;
          const initiallyHidden = input.type === 'password' &&
            toggle.type === 'button' &&
            toggle.getAttribute('aria-pressed') === 'false' &&
            toggle.getAttribute('aria-label')?.startsWith('Show ');
          const bounds = toggle.getBoundingClientRect();
          const inputBounds = input.getBoundingClientRect();
          const isVisible = bounds.width >= 32 && bounds.height >= 32 &&
            bounds.right <= inputBounds.right + 2 && bounds.left >= inputBounds.left;
          let revealed = false;
          let restored = false;
          if (input.disabled) {
            revealed = toggle.disabled && input.type === 'password';
            restored = revealed;
          } else {
            toggle.click();
            await new Promise((resolve) => setTimeout(resolve, 60));
            revealed = input.type === 'text' &&
              toggle.getAttribute('aria-pressed') === 'true' &&
              toggle.getAttribute('aria-label')?.startsWith('Hide ') &&
              input.value === originalValue;
            toggle.click();
            await new Promise((resolve) => setTimeout(resolve, 60));
            restored = input.type === 'password' &&
              toggle.getAttribute('aria-pressed') === 'false' &&
              toggle.getAttribute('aria-label')?.startsWith('Show ') &&
              input.value === originalValue;
          }
          results.push({ initiallyHidden: Boolean(initiallyHidden),
            isVisible, revealed, restored, hasIcon: Boolean(toggle.querySelector('svg')) });
        }
        return results;
      })()`, true);
      if (checks.length !== scenario.verifyPasswordVisibility ||
          checks.some((check) => !check.initiallyHidden || !check.isVisible ||
            !check.revealed || !check.restored || !check.hasIcon)) {
        throw new Error(`${scenario.name} password visibility failed: ${JSON.stringify(checks)}`);
      }
    }

    if (scenario.verifyPrizeImageLayout) {
      // The CI database may have no public prize rows. Render the same media
      // classes with tall and wide synthetic images in the real compiled page,
      // asserting that neither image can invade the text area at this viewport.
      const results = await evaluate(client, `(async () => {
        const container = document.querySelector('.mm-prizes-section.mm-rewards-container');
        if (!container) return [{ error: 'Month detail section is missing' }];
        const grid = document.createElement('div');
        grid.className = 'mm-prizes-detail-grid';
        const card = document.createElement('article');
        card.className = 'mm-prizes-detail-card';
        const media = document.createElement('div');
        media.className = 'mm-prizes-detail-image';
        const frame = document.createElement('div');
        frame.className = 'mm-prizes-detail-image-frame';
        const photo = document.createElement('img');
        photo.alt = 'Synthetic prize image used only for visual regression';
        // Emulate the inline positioning generated by Next/Image fill.
        Object.assign(photo.style, {
          position: 'absolute', inset: '0', width: '100%', height: '100%',
        });
        frame.appendChild(photo);
        media.appendChild(frame);
        const copy = document.createElement('div');
        copy.className = 'mm-prizes-detail-copy';
        const title = document.createElement('h3');
        title.textContent = 'Fixture prize name';
        copy.appendChild(title);
        card.append(media, copy);
        grid.appendChild(card);
        container.appendChild(grid);
        const output = [];
        try {
          for (const [width, height] of [[800, 1600], [1600, 400]]) {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width +
              '" height="' + height + '"><rect width="100%" height="100%" fill="#178c97"/></svg>';
            photo.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
            await photo.decode();
            const mediaBounds = media.getBoundingClientRect();
            const frameBounds = frame.getBoundingClientRect();
            const imageBounds = photo.getBoundingClientRect();
            const copyBounds = copy.getBoundingClientRect();
            output.push({
              aspect: width + 'x' + height,
              imageWithinFrame:
                imageBounds.left >= frameBounds.left - 1 &&
                imageBounds.right <= frameBounds.right + 1 &&
                imageBounds.top >= frameBounds.top - 1 &&
                imageBounds.bottom <= frameBounds.bottom + 1,
              copyBelowImage: copyBounds.top >= mediaBounds.bottom - 1,
              objectFit: getComputedStyle(photo).objectFit,
              frameClipped: getComputedStyle(frame).overflow === 'hidden',
              mediaHeight: mediaBounds.height,
              expectedMediaHeight: innerWidth <= 680 ? 218 : 238,
            });
          }
        } finally {
          grid.remove();
        }
        return output;
      })()`, true);
      if (results.length !== 2 || results.some((result) =>
        result.error || !result.imageWithinFrame || !result.copyBelowImage ||
        !result.frameClipped || result.objectFit !== 'contain' ||
        Math.abs(result.mediaHeight - result.expectedMediaHeight) > 2)) {
        throw new Error(`${scenario.name} prize image/text collision: ${JSON.stringify(results)}`);
      }
    }

    if (scenario.verifyHomepageCursor) {
      await waitForExpression(client, 'Boolean(document.querySelector(".mm-home-cursor-trail"))',
        'homepage cursor layer mounted after hydration');
      const enabled = await evaluate(client,
        "matchMedia('(min-width: 681px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches");
      if (!enabled) throw new Error('Desktop cursor UAT requires a wide viewport and normal motion');

      // Real Chromium mouse movement verifies the production event path, without
      // spoofing pointer capabilities in the test runner.
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 380, y: 320 });
      await waitForExpression(client, 'document.querySelectorAll(".mm-home-cursor-spark").length === 3',
        'real mouse movement creates three golden particles');
      const trailSafety = await evaluate(client, `(() => {
        const layer = document.querySelector('.mm-home-cursor-trail');
        return { hiddenFromAT: layer?.getAttribute('aria-hidden') === 'true',
          pointerTransparent: getComputedStyle(layer).pointerEvents === 'none' };
      })()`);
      if (!trailSafety.hiddenFromAT || !trailSafety.pointerTransparent) {
        throw new Error('Homepage cursor trail must be decorative and click-through');
      }
      // Compare in the same browser task: animation expiry between CDP calls
      // must not create a flaky touch-bypass assertion.
      const touchResult = await evaluate(client, `(() => {
        const before = document.querySelectorAll('.mm-home-cursor-spark').length;
        document.querySelector('.mm-home-hero').dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, isPrimary: true, pointerType: 'touch', clientX: 520, clientY: 390,
        }));
        return { before, after: document.querySelectorAll('.mm-home-cursor-spark').length };
      })()`);
      if (touchResult.before !== touchResult.after) {
        throw new Error('Touch motion unexpectedly emitted desktop cursor sparkles');
      }

      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await waitForExpression(client,
        'matchMedia("(prefers-reduced-motion: reduce)").matches && document.querySelectorAll(".mm-home-cursor-spark").length === 0',
        'reduced-motion clears active golden particles');
      await evaluate(client, `(() => {
        document.querySelector('.mm-home-hero').dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, isPrimary: true, pointerType: 'mouse', clientX: 570, clientY: 410,
        }));
      })()`);
      const reducedCount = await evaluate(client, 'document.querySelectorAll(".mm-home-cursor-spark").length');
      if (reducedCount !== 0) throw new Error('Reduced motion still emitted cursor sparkles');
      await client.send('Emulation.setEmulatedMedia', { features: [] });
    }

    if (scenario.verifyHomepageCursorMobile) {
      await waitForExpression(client, 'Boolean(document.querySelector(".mm-home-cursor-trail"))',
        'mobile cursor layer mounted after hydration');
      const mobile = await evaluate(client, `(() => {
        const root = document.querySelector('.mm-home-hero');
        root.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, isPrimary: true, pointerType: 'mouse', clientX: 180, clientY: 260,
        }));
        return {
          sparkleCount: document.querySelectorAll('.mm-home-cursor-spark').length,
          layerHidden: getComputedStyle(document.querySelector('.mm-home-cursor-trail')).display === 'none',
        };
      })()`);
      if (!mobile.layerHidden || mobile.sparkleCount !== 0) {
        throw new Error('Mobile homepage must not emit or display mouse sparkles');
      }
    }

    if (scenario.verifyQrUpload) {
      await waitForExpression(client,
        'Boolean(document.querySelector("input[type=file][accept*=image]") && document.querySelector("input[name=upiId]"))',
        'payment QR settings inputs ready',
      );
      const upload = async (dimension, type, quality) => evaluate(client, `
        (async () => {
          const canvas = document.createElement('canvas');
          canvas.width = ${dimension};
          canvas.height = ${dimension};
          const ctx = canvas.getContext('2d');
          const image = ctx.createImageData(canvas.width, canvas.height);
          const random = new Uint8Array(image.data.length);
          for (let offset = 0; offset < random.length; offset += 65536) {
            crypto.getRandomValues(random.subarray(offset, Math.min(random.length, offset + 65536)));
          }
          for (let i = 0; i < image.data.length; i += 4) {
            image.data[i] = random[i];
            image.data[i+1] = random[i+1];
            image.data[i+2] = random[i+2];
            image.data[i+3] = 255;
          }
          ctx.putImageData(image, 0, 0);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, ${escapeJs(type)}, ${quality}));
          const file = new File([blob], 'qr-uat.' + (blob.type === 'image/png' ? 'png' : 'jpg'), {type:blob.type});
          const input = document.querySelector('input[type=file][accept*=image]');
          const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
          input.dispatchEvent(new Event('change', {bubbles:true}));
          return {sourceBytes:blob.size};
        })()
      `, true);
      const normal = await upload(520, 'image/jpeg', 0.82);
      if (normal.sourceBytes < 90_000 || normal.sourceBytes > 230_000) {
        throw new Error('QR UAT JPEG source size unexpectedly outside realistic upload range');
      }
      await waitForExpression(client,
        'Array.from(document.images).find((image) => image.alt === "Configured payment QR")?.src.length > 120000 && Array.from(document.images).find((image) => image.alt === "Configured payment QR")?.src.length <= 320000',
        '111KB-class JPEG QR accepted and previewed',
      );
      const large = await upload(1000, 'image/png', 1);
      if (large.sourceBytes < 320_000 || large.sourceBytes > 8 * 1024 * 1024) {
        throw new Error('QR UAT large PNG source size unexpected');
      }
      await waitForExpression(client,
        'document.body.innerText.includes("QR image optimized to fit safely") && Array.from(document.images).find((image) => image.alt === "Configured payment QR")?.src.length <= 320000',
        'large QR PNG optimized to supported bound',
        30_000,
      );
    }

    if (scenario.verifyAdminWithdrawals) {
      await waitForExpression(client, `(() => {
        const href = '/portal/withdrawals';
        const links = [...document.querySelectorAll('a[href]')];
        return Boolean(links.find((item) => item.getAttribute('href') === href));
      })()`, 'Admin withdrawals is present in the shared sidebar/drawer');
      await waitForExpression(client, `(() => {
        const refresh = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Refresh');
        return Boolean(refresh && !refresh.disabled);
      })()`, 'Admin withdrawal queue and policy fetch completed');
      const withdrawalStatus = await evaluate(client, `(() => ({
        queue: [...document.querySelectorAll('h2')].some((item) => item.textContent?.trim() === 'Request queue'),
        noError: !document.querySelector('.mm-withdrawals-panel .mm-error'),
        noDuplicateHeader: document.querySelectorAll('.mm-topbar').length === 0,
      }))()`);
      if (!withdrawalStatus.queue || !withdrawalStatus.noError || !withdrawalStatus.noDuplicateHeader || withdrawalApiErrors.length) {
        throw new Error(`${scenario.name} withdrawal workspace failed: ${JSON.stringify({ withdrawalStatus, withdrawalApiErrors })}`);
      }
    }
    if (scenario.checkMemberSecurity) {
      const prohibited = await evaluate(client, `(() => ({
        form: Boolean(document.querySelector('#email-change-password, #email-change-new-email')),
        heading: [...document.querySelectorAll('h2')].some((heading) => heading.textContent?.trim() === 'Change email'),
        instructions: document.body.innerText.includes('To change your email, enter your current password'),
      }))()`);
      if (prohibited.form || prohibited.heading || prohibited.instructions) {
        throw new Error('Member Security exposed Super Admin-only email change controls');
      }
    }
    if (scenario.checkKycBirthDate) {
      const invalid = await evaluate(client, `(() => [
        ...document.querySelectorAll('input[id^="kyc-field-"]')
      ].filter((input) => /(?:^|\\.)(?:dateOfBirth|birthDate|dob)$/i.test(input.id.slice('kyc-field-'.length)))
        .some((input) => input.type !== 'date'))()`);
      if (invalid) throw new Error('KYC date of birth is missing the native date picker');
    }
    if (scenario.verifyReferralCard) {
      await waitForExpression(
        client,
        'Boolean(document.querySelector("[data-referral-code]")?.textContent?.trim() && document.querySelector("[data-referral-link]")?.value)',
        'authenticated referral card ready',
      );
      const referral = await evaluate(client, `(() => {
        const code = document.querySelector('[data-referral-code]')?.textContent?.trim() ?? '';
        const link = document.querySelector('[data-referral-link]')?.value ?? '';
        const copy = document.querySelector('[data-referral-copy]');
        const whatsapp = document.querySelector('[data-referral-whatsapp]');
        if (!link || !code || !copy || !whatsapp) return { valid: false };
        const signup = new URL(link);
        const share = new URL(whatsapp.href);
        const message = share.searchParams.get('text') ?? '';
        return {
          valid: signup.origin === location.origin
            && signup.pathname === '/signup'
            && signup.searchParams.get('sponsor') === code
            && share.hostname === 'wa.me'
            && message.includes(link)
            && message.includes(code)
            && !copy.disabled,
        };
      })()`);
      if (!referral.valid) throw new Error(`${scenario.name} referral link / WhatsApp contract failed`);
    }
    if (scenario.verifyPrefilledSponsor) {
      await waitForExpression(
        client,
        `document.querySelector('#sponsorReference')?.value === ${escapeJs(scenario.verifyPrefilledSponsor)}`,
        'signup prefilled sponsor reference',
      );
    }

    if (scenario.waitForRefresh) {
      await waitForExpression(
        client,
        '[...document.querySelectorAll(".mm-member-hero button")].some((button) => button.textContent?.trim() === "Refresh")',
        `${scenario.name} member data fetch completed`,
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
          const field = form.querySelector('[name="' + name + '"]');
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

    if (scenario.requireMemberMobileNav) {
      // Real pointer input catches stacking/clipping and untappable mobile items.
      const point = await evaluate(client, `(() => {
        const button = document.querySelector('nav[aria-label="Member navigation"] button[data-member-label="More"]');
        if (!button) return null;
        const r = button.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (!point || point.x < 0 || point.y < 0 || point.y > scenario.height) {
        throw new Error('Member mobile More button is absent or outside the viewport');
      }
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
      });
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
      });
      await waitForExpression(
        client,
        'document.querySelector("#member-more-menu")?.textContent?.includes("Sign out")',
        'member mobile More menu',
      );
      const hit = await evaluate(client, `(() => {
        const menu = document.querySelector('#member-more-menu');
        const item = menu?.querySelector('a[data-member-label="Rewards & Lucky Draw"]');
        if (!menu || !item) return { visible: false, hittable: false };
        const menuRect = menu.getBoundingClientRect();
        const r = item.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return {
          visible: menuRect.width > 0 && menuRect.height > 0 && y >= 0 && y < innerHeight,
          hittable: Boolean(document.elementFromPoint(x, y)?.closest('#member-more-menu')),
        };
      })()`);
      if (!hit.visible || !hit.hittable) throw new Error('Mobile More menu opened in DOM but is visually blocked or untappable');
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
            .map((node) => node.getAttribute('data-member-label') ?? node.textContent?.trim())
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
        memberMoreLabels: [...document.querySelectorAll('#member-more-menu:not([hidden]) [data-member-label]')].map((node) => node.getAttribute('data-member-label')),
        memberNavScrollable: memberNav ? memberNav.scrollWidth > memberNav.clientWidth : false,
        adminNavIcons: Object.fromEntries(
          [...document.querySelectorAll('aside nav a')]
            .map((node) => {
              const spans = node.querySelectorAll('span');
              return [spans[1]?.textContent?.trim() ?? '', spans[0]?.textContent?.trim() ?? ''];
            })
            .filter(([label]) => Boolean(label)),
        ),
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
    if (scenario.requireAdminNavIcons) {
      const expected = {
        Dashboard: '🏠',
        '9 Income Types': '📈',
        Members: '👥',
        'Genealogy': '🌳',
        'Season Management': '📅',
        'Monthly Draw': '🎲',
        Winners: '🏆',
        'Prize Catalogue': '🎁',
        'Payments / Bills': '💳',
        'Member Verification': '✅',
        'Wallet / Ledger': '📒',
        'E-PIN Management': '🔑',
        'Auth Codes': '🔐',
        'Admins & Agents': '🧑‍💼',
        'Roles & Permissions': '🛡️',
        Reports: '📊',
        Notifications: '🔔',
        Support: '🎫',
        Settings: '⚙️',
      };
      const mismatches = Object.entries(expected)
        .filter(([label, icon]) => metrics.adminNavIcons?.[label] !== icon)
        .map(([label, icon]) => `${label}: expected ${icon}, got ${metrics.adminNavIcons?.[label] ?? 'missing'}`);
      if (mismatches.length) {
        throw new Error(`${scenario.name} admin navigation icon mismatch: ${mismatches.join('; ')}`);
      }
    }
    if (scenario.requireRewardNav) {
      const linksVisible = await evaluate(client, `(() => {
        const paths = ['/rewards', '/rewards/monthly-prizes'];
        const links = [...document.querySelectorAll('.mm-home-header a[href]')];
        return paths.every((path) => links.some((link) => {
          const bounds = link.getBoundingClientRect();
          return new URL(link.href).pathname === path &&
            bounds.width > 0 && bounds.height > 0 &&
            getComputedStyle(link).visibility !== 'hidden';
        }));
      })()`);
      if (!linksVisible) {
        throw new Error(`${scenario.name} is missing visible Awards & Rewards / Monthly prizes header links`);
      }
    }
    if (scenario.requireMemberMobileNav || scenario.requireMemberDesktopNav) {
      const primary = ['Dashboard', 'Payments & E-PINs', 'Benefits'];
      const missingPrimary = primary.filter((label) => !metrics.memberNavLabels.includes(label));
      const secondary = ['Rewards & Lucky Draw', 'My Genealogy', 'Installment history', 'Withdrawals', 'KYC', 'Security', 'Public site', 'Sign out'];
      const availableSecondary = scenario.requireMemberMobileNav ? metrics.memberMoreLabels : metrics.memberNavLabels;
      const missingSecondary = secondary.filter((label) => !availableSecondary.includes(label));
      if (missingPrimary.length || missingSecondary.length || (scenario.requireMemberMobileNav && !metrics.memberNavLabels.includes('More'))) {
        throw new Error(`${scenario.name} navigation missing primary=${missingPrimary.join(', ')} secondary=${missingSecondary.join(', ')}`);
      }
    }
    if (scenario.requireMemberApi) {
      const alert = await evaluate(client, 'document.querySelector(".mm-error[role=alert]")?.textContent?.trim() ?? ""');
      if (alert || memberApiErrors.length) {
        throw new Error(`${scenario.name} member data failed: ${JSON.stringify({ alert, memberApiErrors })}`);
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

  // Run Next.js UAT independently of already-running local admin/member apps.
  // The selected URLs drive BOTH the spawned processes and browser assertions.
  const adminUrl = new URL(adminBaseUrl);
  const memberUrl = new URL(memberBaseUrl);
  for (const [label, url] of [['admin', adminUrl], ['member', memberUrl]]) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`Browser UAT ${label} URL must be a localhost http://127.0.0.1:<port> base URL`);
    }
  }
  const adminPort = (await selectVerifyPort(Number(adminUrl.port))).port;
  const memberPort = (await selectVerifyPort(Number(memberUrl.port))).port;
  if (adminPort === memberPort) throw new Error('Browser UAT Admin and Member ports collide');
  adminBaseUrl = `http://127.0.0.1:${adminPort}`;
  memberBaseUrl = `http://127.0.0.1:${memberPort}`;

  const admin = spawnLogged(
    'MegaGoldenClub admin',
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(adminPort)],
    path.join(artifactDir, 'admin-next.log'),
    { NODE_ENV: 'production' },
    path.join(rootDir, 'admin'),
  );
  const member = spawnLogged(
    'MegaGoldenClub member',
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(memberPort)],
    path.join(artifactDir, 'member-next.log'),
    { NODE_ENV: 'production' },
    path.join(rootDir, 'frontend'),
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
      name: 'admin-login-password-desktop', baseUrl: adminBaseUrl, path: '/login',
      width: 1440, height: 1000, mobile: false,
      expectedTexts: ['Sign in to continue'], verifyPasswordVisibility: 1,
    },
    {
      name: 'admin-login-password-mobile', baseUrl: adminBaseUrl, path: '/login',
      width: 390, height: 844, mobile: true,
      expectedTexts: ['Sign in to continue'], verifyPasswordVisibility: 1,
    },
    {
      name: 'member-login-password-desktop', baseUrl: memberBaseUrl, path: '/login',
      width: 1440, height: 1000, mobile: false,
      expectedTexts: ['Welcome back'], verifyPasswordVisibility: 1,
    },
    {
      name: 'member-login-password-mobile', baseUrl: memberBaseUrl, path: '/login',
      width: 390, height: 844, mobile: true,
      expectedTexts: ['Welcome back'], verifyPasswordVisibility: 1,
    },
    {
      name: 'member-reset-password-mobile', baseUrl: memberBaseUrl,
      path: '/reset-password?token=browser-uat-token',
      width: 390, height: 844, mobile: true,
      expectedTexts: ['Set a new password'], verifyPasswordVisibility: 2,
    },
    {
      name: 'admin-change-password-desktop', baseUrl: adminBaseUrl, path: '/change-password',
      cookieName: 'megagoldenclub_admin_access', token: adminToken,
      width: 1440, height: 1000, mobile: false,
      expectedTexts: ['Change your password'], verifyPasswordVisibility: 2,
    },
    {
      name: 'member-change-password-mobile', baseUrl: memberBaseUrl, path: '/member/change-password',
      cookieName: 'megagoldenclub_member_access', token: memberToken,
      width: 390, height: 844, mobile: true,
      expectedTexts: ['Choose a new password'], verifyPasswordVisibility: 2,
    },
    {
      name: 'admin-staff-password-desktop', baseUrl: adminBaseUrl, path: '/portal/staff',
      cookieName: 'megagoldenclub_admin_access', token: adminToken,
      width: 1440, height: 1000, mobile: false,
      expectedTexts: ['Initial Password'], verifyPasswordVisibility: 1,
    },
    {
      name: 'public-awards-desktop',
      requireRewardNav: true,
      baseUrl: memberBaseUrl, path: '/rewards', width: 1440, height: 1000,
      mobile: false, expectedTexts: ['Awards & Rewards.', 'Explore monthly prizes', 'Admin Prize Catalogue', 'New qualified direct', 'Shimla family trip'],
    },
    {
      name: 'public-awards-mobile',
      requireRewardNav: true,
      baseUrl: memberBaseUrl, path: '/rewards', width: 390, height: 844,
      mobile: true, expectedTexts: ['Awards & Rewards.', 'Explore monthly prizes', 'New qualified team', '₹50,000'],
    },
    {
      name: 'public-monthly-prizes-desktop',
      requireRewardNav: true,
      baseUrl: memberBaseUrl, path: '/rewards/monthly-prizes', width: 1440, height: 1000,
      mobile: false, expectedTexts: ['Monthly Lucky Draw', 'A moment for', 'View Details'],
    },
    {
      name: 'public-monthly-prizes-mobile',
      requireRewardNav: true,
      baseUrl: memberBaseUrl, path: '/rewards/monthly-prizes', width: 390, height: 844,
      mobile: true, expectedTexts: ['Monthly Lucky Draw', 'A moment for', 'View Details'],
    },
    {
      name: 'public-month-detail-desktop',
      requireRewardNav: true,
      verifyPrizeImageLayout: true,
      baseUrl: memberBaseUrl, path: '/rewards/monthly-prizes/1',
      width: 1440, height: 1000, mobile: false,
      expectedTexts: ['Month 01', 'Lucky Draw Prizes', 'All Monthly Prizes'],
    },
    {
      name: 'public-month-detail-mobile',
      requireRewardNav: true,
      verifyPrizeImageLayout: true,
      baseUrl: memberBaseUrl, path: '/rewards/monthly-prizes/1',
      width: 390, height: 844, mobile: true,
      expectedTexts: ['Month 01', 'Lucky Draw Prizes', 'All Monthly Prizes'],
    },
    {
      name: 'public-home-cursor-mobile',
      requireRewardNav: true,
      baseUrl: memberBaseUrl,
      path: '/',
      width: 390,
      height: 844,
      mobile: true,
      expectedTexts: ['Your membership.', 'Brighter moments.'],
      verifyHomepageCursorMobile: true,
    },
    {
      name: 'public-home-cursor-desktop',
      requireRewardNav: true,
      baseUrl: memberBaseUrl,
      path: '/',
      width: 1440,
      height: 1000,
      mobile: false,
      expectedTexts: ['Your membership.', 'Brighter moments.', 'No reward is guaranteed'],
      verifyHomepageCursor: true,
    },
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
      requireAdminNavIcons: true,
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
      name: 'admin-withdrawals-desktop',
      baseUrl: adminBaseUrl,
      path: '/portal/withdrawals',
      cookieName: 'megagoldenclub_admin_access',
      token: adminToken,
      width: 1440, height: 1000, mobile: false,
      expectedTexts: ['Withdrawals', 'Request queue', 'Policies', 'Create policy version'],
      verifyAdminWithdrawals: true,
    },
    {
      name: 'admin-withdrawals-mobile',
      baseUrl: adminBaseUrl,
      path: '/portal/withdrawals',
      cookieName: 'megagoldenclub_admin_access',
      token: adminToken,
      width: 390, height: 844, mobile: true,
      expectedTexts: ['Withdrawals', 'Request queue', 'Policies'],
      verifyAdminWithdrawals: true,
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
      name: 'admin-member-payment-qr-desktop',
      baseUrl: adminBaseUrl,
      path: '/portal/member-payments',
      cookieName: 'megagoldenclub_admin_access',
      token: adminToken,
      width: 1440,
      height: 1000,
      mobile: false,
      expectedTexts: ['Member Payment Verification', 'QR / UPI Settings'],
      verifyQrUpload: true,
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
      expectedTexts: ['MegaGoldenClub', 'Hello, UAT Member', 'Binary performance', 'INSTALLMENT RESERVE'],
      requireMemberDesktopNav: true,
      verifyReferralCard: true,
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
      expectedTexts: ['MegaGoldenClub', 'Hello, UAT Member', 'INSTALLMENT RESERVE'],
      requireMemberMobileNav: true,
      verifyReferralCard: true,
    },
    {
      name: 'public-signup-referral-desktop',
      verifyPasswordVisibility: 1,
      baseUrl: memberBaseUrl,
      path: '/signup?sponsor=MGC123456',
      width: 1440,
      height: 1000,
      mobile: false,
      expectedTexts: ['Join with your valid E-PIN.', 'Create your account'],
      verifyPrefilledSponsor: 'MGC123456',
    },
    {
      name: 'public-signup-referral-mobile',
      verifyPasswordVisibility: 1,
      baseUrl: memberBaseUrl,
      path: '/signup?sponsor=MGC123456',
      width: 390,
      height: 844,
      mobile: true,
      expectedTexts: ['Join with your valid E-PIN.', 'Create your account'],
      verifyPrefilledSponsor: 'MGC123456',
    },
  ];

  // Authenticate each member read-side screen at desktop and mobile widths.
  // Tests use an isolated MEMBER account and do not mutate financial state.
  const memberPages = [
    { slug: 'payments', heading: 'Installments & E-PINs', readyText: 'Payment receipts', waitForRefresh: true },
    { slug: 'rewards', heading: 'Rewards & Lucky Draw', readyText: 'My Lucky Draw wins & claims' },
    { slug: 'genealogy', heading: 'My Genealogy', readyText: 'Four direct placement slots' },
    { slug: 'installments', heading: 'Monthwise installments', readyText: 'No session enrollment or installment schedule yet.' },
    { slug: 'withdrawals', heading: 'Withdrawals', readyText: 'INSTALLMENT RESERVE' },
    { slug: 'kyc', heading: 'KYC', readyText: 'Verification status', checkKycBirthDate: true },
    { slug: 'entitlements', heading: 'My product benefits', readyText: 'Benefit history' },
    { slug: 'security', heading: 'Identity & email', readyText: 'uat-verify-member-', checkMemberSecurity: true },
  ];
  for (const page of memberPages) {
    for (const viewport of [
      { label: 'desktop', width: 1440, height: 1000, mobile: false },
      { label: 'mobile', width: 390, height: 844, mobile: true },
    ]) {
      scenarios.push({
        name: `member-${page.slug}-${viewport.label}`,
        baseUrl: memberBaseUrl,
        path: `/member/${page.slug}`,
        cookieName: 'megagoldenclub_member_access',
        token: memberToken,
        width: viewport.width,
        height: viewport.height,
        mobile: viewport.mobile,
        expectedTexts: [page.heading, page.readyText],
        waitForRefresh: page.waitForRefresh,
        requireMemberApi: true,
        checkKycBirthDate: page.checkKycBirthDate,
        checkMemberSecurity: page.checkMemberSecurity,
        requireMemberMobileNav: viewport.mobile,
        requireMemberDesktopNav: !viewport.mobile,
      });
    }
  }

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
