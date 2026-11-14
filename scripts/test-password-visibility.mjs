import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

// Every actual password input in the public, member and Admin UIs must use
// the same accessible show/hide control. Preserve names, validation and autofill.
const expectedPasswordInputs = new Map([
  ['frontend/components/login-form.tsx', 1],
  ['frontend/components/signup-form.tsx', 1],
  ['frontend/components/auth-recovery-forms.tsx', 3],
  ['frontend/app/member/change-password/page.tsx', 2],
  ['admin/components/login-form.tsx', 1],
  ['admin/components/auth-account-forms.tsx', 1],
  ['admin/app/change-password/page.tsx', 2],
  ['admin/components/access-control-portal.tsx', 1],
  ['admin/components/owner-members-portal.tsx', 1],
  ['admin/components/owner-core-v14-portal.tsx', 1],
  ['admin/components/owner-core-portal.tsx', 1],
  ['admin/components/owner-portal.tsx', 1],
]);

let auditedInputs = 0;
for (const [file, expected] of expectedPasswordInputs) {
  const source = read(file);
  const inputs = [...source.matchAll(/<PasswordInput\b/g)].length;
  assert.equal(inputs, expected, `Every password field must be covered: ${file}`);
  assert.ok(source.includes("from '@/components/password-input'"),
    `Password visibility must reuse shared UI component: ${file}`);
  auditedInputs += inputs;
}

// Regression gate: reject future bare password fields anywhere in either app,
// including new routes and embedded management screens.
function scan(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (entry.isFile() && file.endsWith('.tsx')) {
      const text = read(file);
      assert.ok(!/<input\b[^>]*\btype\s*=\s*["']password["'][^>]*>/gs.test(text),
        `Raw password input without visibility control: ${file}`);
    }
  }
}
scan('frontend/app');
scan('frontend/components');
scan('admin/app');
scan('admin/components');

const adminControl = read('admin/components/password-input.tsx');
const memberControl = read('frontend/components/password-input.tsx');
assert.equal(adminControl, memberControl, 'Admin and Member must use the same visibility component contract');
for (const fragment of [
  "type={visible ? 'text' : 'password'}",
  'type="button"',
  'aria-label={',
  'aria-pressed={visible}',
  'disabled={disabled}',
  'onClick={() => setVisible((shown) => !shown)}',
  "visible ? value : '••••••••'",
]) assert.ok(memberControl.includes(fragment), `Missing password visibility invariant: ${fragment}`);

for (const app of ['admin', 'frontend']) {
  const css = read(`${app}/app/globals.css`);
  for (const selector of ['.mm-password-field {', '.mm-password-field-input {',
    '.mm-password-toggle {', '.mm-password-toggle:focus-visible',
    '.mm-password-value-toggle {']) {
    assert.ok(css.includes(selector), `Missing password layout / focus style: ${app} ${selector}`);
  }
}

for (const [file, secret] of [
  ['frontend/components/signup-form.tsx', 'result.initialPassword'],
  ['admin/components/owner-members-portal.tsx', 'generatedPassword'],
  ['admin/components/owner-core-v14-portal.tsx', 'generatedPassword'],
  ['admin/components/owner-core-portal.tsx', 'generatedMemberPassword'],
]) {
  const source = read(file);
  assert.ok(source.includes(`<PasswordValue key={${secret}} value={${secret}} />`),
    `One-time password must be masked until intentionally revealed: ${file}`);
  assert.ok(!source.includes(`<b>{${secret}}</b>`),
    `One-time password must not render automatically in plain text: ${file}`);
}

const browser = read('scripts/verify-browser-uat.mjs');
for (const scenario of ['admin-login-password-desktop','admin-login-password-mobile',
  'member-login-password-desktop','member-login-password-mobile',
  'member-reset-password-mobile','member-change-password-mobile',
  'admin-change-password-desktop','admin-staff-password-desktop',
  'public-signup-referral-desktop','public-signup-referral-mobile']) {
  assert.ok(browser.includes(scenario), `Chromium must test password visibility: ${scenario}`);
}
assert.ok(browser.includes('scenario.verifyPasswordVisibility') &&
  browser.includes('initiallyHidden') && browser.includes('revealed') &&
  browser.includes('restored'),
  'Browser UAT must click and assert Show/Hide controls in the real compiled UI');

console.log(`MegaGoldenClub password visibility: PASS (${auditedInputs} password inputs, masked one-time values, desktop/mobile Chromium gate)`);
