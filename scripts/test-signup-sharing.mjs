// Runs on Node 24 in Frontend/Backend CI and as part of root npm run verify.
// No real accounts or messaging networks are touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  signupReferralLink,
  signupCredentialMessage,
  signupWhatsAppShareUrl,
} from '../frontend/lib/signup-share.ts';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dummy = { origin: 'https://www.megagoldenclub.com', username: 'MGC Test&+42', password: 'Dummy#Only 123' };
const url = signupReferralLink(dummy.origin, dummy.username);
assert.equal(new URL(url).pathname, '/signup');
assert.equal(new URL(url).searchParams.get('sponsor'), dummy.username);
const message = signupCredentialMessage(dummy);
assert.match(message, /Member Login ID \/ Referral Code: MGC Test&\+42/);
assert.ok(message.includes('Password: Dummy#Only 123'));
assert.ok(message.includes('Login: https://www.megagoldenclub.com/login'));
assert.ok(message.includes(url));
const whatsapp = new URL(signupWhatsAppShareUrl(dummy));
assert.equal(whatsapp.hostname, 'wa.me');
assert.equal(whatsapp.searchParams.get('text'), message);
assert.throws(() => signupCredentialMessage({ ...dummy, password: '' }), /unavailable/);
assert.throws(() => signupReferralLink(dummy.origin, ''), /required/);

const form = readFileSync(resolve(dir, 'frontend/components/signup-form.tsx'), 'utf8');
for (const required of [
  "setSignupPasswordForSharing(registered.initialPassword ?? formString(form, 'password'))",
  'Copy referral code',
  'Copy login details',
  'Share on WhatsApp',
  'window.confirm(',
  'window.open(signupWhatsAppShareUrl(details)',
  "type=\"button\"",
]) assert.ok(form.includes(required), 'Signup handoff is missing: ' + required);
assert.ok(!/localStorage|sessionStorage|sendBeacon/.test(form), 'One-time signup password must not be persisted');
assert.ok(!form.includes("href={signupWhatsAppShareUrl("), 'Secret-bearing share URLs must only be constructed on explicit click');
const dashboard = readFileSync(resolve(dir,'admin/components/owner-core-v14-portal.tsx'),'utf8');
assert.ok(dashboard.includes('E-PIN FACE VALUE'));
assert.ok(dashboard.includes('not verified money collected'));
console.log('Signup one-time credential/referral copy and WhatsApp security contract: PASS');
