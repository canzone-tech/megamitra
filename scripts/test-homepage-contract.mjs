// Homepage-only regression gate: validates real routes, accessible navigation,
// truthful member messaging, and isolation from registration/business logic.
// Run in frontend CI and canonical root npm run verify before production builds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const homepage = read('frontend/app/page.tsx');
const styles = read('frontend/app/landing.css');
const layout = read('frontend/app/layout.tsx');

assert.ok(layout.includes("import './landing.css'"), 'Homepage styles must be included in production build');
assert.ok(homepage.includes("export const metadata: Metadata"), 'Homepage must provide its own SEO title/description');

for (const section of ['main-content', 'rewards', 'how-it-works', 'features', 'questions']) {
  assert.ok(homepage.includes('id="' + section + '"'), 'Missing accessible landing section: ' + section);
}
for (const fragment of [
  'Skip to main content', 'aria-label="Primary navigation"',
  'Your membership.', 'Your journey.', 'All in one place.',
  'Illustrative preview', 'No member data shown',
  'Brighter moments.', 'Clearer participation.', 'Monthly draw updates',
  'Product benefit records', 'Clear reward eligibility', 'No prize or reward is guaranteed',
  'Start with your sponsor', 'Complete your registration',
  'Explore your member space', 'Membership progress',
  'Referral activity', 'Reward records', 'Lucky draw entries',
  'Wallet overview', 'Account security', 'Questions before',
  'Program benefits are subject to eligibility',
  'No reward is guaranteed', 'valid single-use E-PIN',
]) {
  assert.ok(homepage.includes(fragment), 'Homepage contract missing: ' + fragment);
}
for (const route of ['/login', '/signup', '/forgot-password']) {
  assert.ok(homepage.includes('href="' + route + '"'), 'Missing member navigation: ' + route);
}
for (const match of homepage.matchAll(/href="([^"]+)"/g)) {
  const path = match[1];
  if (path.startsWith('#')) {
    assert.ok(homepage.includes('id="' + path.slice(1) + '"'), 'Broken anchor: ' + path);
  } else {
    assert.ok(['/', '/login', '/signup', '/forgot-password'].includes(path), 'Unsupported landing route: ' + path);
  }
}
assert.equal((homepage.match(/<details className="mm-home-faq-item"/g) || []).length, 1,
  'FAQs must use accessible native details/summary, not JS-only state');
assert.ok(!/localStorage|sessionStorage|fetch\(|useEffect|useState|window\./.test(homepage),
  'Public homepage must stay static without secret-bearing client-side business logic');
assert.ok(!/guaranteed (returns|income|winnings)|earn ₹|₹\s*\d+|\d+% returns/i.test(homepage),
  'Homepage must not make invented financial claims');
assert.ok(styles.includes('@media (max-width: 680px)') && styles.includes('@media (max-width: 370px)'),
  'Responsive phone layouts must be defined');
assert.ok(styles.includes('prefers-reduced-motion') && styles.includes(':focus-visible'),
  'Reduced-motion and keyboard focus visibility must be preserved');
assert.ok(!/^\s*(?:html|body|:root|button|input|select|textarea)\s*\{/m.test(styles),
  'Homepage stylesheet must not override shared auth/member styles globally');
assert.ok(styles.includes('.mm-home-faq-item') && styles.includes('.mm-home-preview') && styles.includes('.mm-home-rewards-grid'),
  'FAQ and illustrative dashboard must have dedicated styles');

console.log('MegaGoldenClub premium single-page homepage contract: PASS');
