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
const motion = read('frontend/components/homepage-motion.tsx');
const browserUat = read('scripts/verify-browser-uat.mjs');
const awardsPage = read('frontend/app/rewards/page.tsx');
const monthlyPage = read('frontend/app/rewards/monthly-prizes/page.tsx');
const rewardsLayout = read('frontend/app/rewards/layout.tsx');
const rewardsCss = read('frontend/app/rewards/rewards.css');
const prizeDetail = read('frontend/app/rewards/monthly-prizes/[month]/page.tsx');
const publicPrizeClient = read('frontend/lib/public-prizes.ts');
const publicMediaProxy = read('frontend/app/api/public-prize-media/[mediaId]/route.ts');
const publicPrizeService = read('backend/src/owner-portal/public-prize-catalogue.service.ts');
const publicPrizeController = read('backend/src/owner-portal/public-prize-catalogue.controller.ts');

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
for (const route of ['/login', '/signup', '/forgot-password', '/rewards', '/rewards/monthly-prizes']) {
  assert.ok(homepage.includes('href="' + route + '"'), 'Missing member navigation: ' + route);
}
for (const match of homepage.matchAll(/href="([^"]+)"/g)) {
  const path = match[1];
  if (path.startsWith('#')) {
    assert.ok(homepage.includes('id="' + path.slice(1) + '"'), 'Broken anchor: ' + path);
  } else {
    assert.ok(['/', '/login', '/signup', '/forgot-password', '/rewards', '/rewards/monthly-prizes'].includes(path), 'Unsupported landing route: ' + path);
  }
}
assert.ok(homepage.includes('className="mm-home-nav-reward" href="/rewards"') &&
  homepage.includes('className="mm-home-nav-reward" href="/rewards/monthly-prizes"') &&
  homepage.includes('aria-label="Rewards shortcuts"') &&
  rewardsLayout.includes('aria-label="Rewards shortcuts"') &&
  styles.includes('.mm-home-mobile-rewards-nav { display:flex;'),
  'The homepage and reward pages must expose rewards and monthly prizes from their top navigation');
assert.ok(rewardsLayout.includes("import './rewards.css'") &&
  rewardsLayout.includes('aria-label="Primary navigation"') &&
  rewardsLayout.includes('href="/rewards/monthly-prizes"') &&
  rewardsLayout.includes('href="/login"'),
  'Public rewards pages must share site styling and accessible, functional navigation');
assert.ok(awardsPage.includes("function MilestoneIcon") &&
  awardsPage.includes("<MilestoneIcon name={tier.icon} />") &&
  !/symbol:\\s*['"](?:◆|★|◇)['"]/.test(awardsPage),
  'Milestone awards must use real vector icons rather than typographic placeholders');
const rankRegister = read('docs/BUSINESS-RULES-REGISTER.md');
for (const [name, direct, team, deadline, cash] of [
  ['Lightning Start', 4, 0, '4 hours', '₹1,000'],
  ['Bronze', 10, 40, '20 days', '₹5,000'],
  ['Silver', 25, 100, '30 days', '₹10,000'],
  ['Gold', 50, 250, '60 days', '₹20,000'],
  ['Diamond', 100, 500, '90 days', '₹50,000'],
]) {
  const line = awardsPage.split('\n').find((text) => text.includes("name: '" + name + "'"));
  assert.ok(line && line.includes('direct: ' + direct + ', team: ' + team) &&
    line.includes("deadline: '" + deadline + "'") &&
    line.includes("cash: '" + cash + "'"),
    'Public rank reference drift: ' + name);
  assert.ok(rankRegister.includes(name) && rankRegister.includes(cash),
    'Approved rank rules missing: ' + name);
}
for (const detail of [
  'Goa family trip', 'Ooty family trip', 'Shimla family trip',
  '₹2,000/month up to 18 months, stopping on Diamond achievement',
  '₹5,000/month up to 18 months after Diamond achievement',
  'original paid joining timestamp',
  'Gold and Diamond monthly rewards are mutually exclusive',
  '<dl className="mm-rewards-tier-details">',
  'className="mm-rewards-policy-link" href="/login"',
]) assert.ok(awardsPage.includes(detail), 'Milestone reference missing: ' + detail);
assert.ok(rewardsCss.includes('.mm-rewards-tier-details') &&
  rewardsCss.includes('.mm-rewards-rules-note') &&
  rewardsCss.includes('.mm-rewards-tier-row { grid-template-columns:1fr; }'),
  'Milestone details must have a readable mobile layout');
assert.ok(awardsPage.includes("Awards &amp; <span>Rewards.") &&
  awardsPage.includes("Lightning Start") &&
  awardsPage.includes("Explore monthly prizes") &&
  awardsPage.includes('Actual prizes, qualified rewards and dates'),
  'Awards page content must remain visible and link to monthly prize preview');
assert.ok(monthlyPage.includes("readPublishedPrizes()") &&
  monthlyPage.includes('View Details') &&
  !monthlyPage.includes('Flyer concept • Not confirmed') &&
  !monthlyPage.includes('flyerPrizeConcepts') &&
  monthlyPage.includes('Array.from({ length: months }'),
  'Month selector must use consistent month navigation without hardcoded flyer prizes');
assert.ok(prizeDetail.includes('readPublishedPrizes()') &&
  prizeDetail.includes('prize.name') &&
  prizeDetail.includes('prize.description') &&
  prizeDetail.includes('prize.winnerCount') &&
  prizeDetail.includes('prize.imageMediaId') &&
  prizeDetail.includes('prizes.length === 0'),
  'Month detail must render all configured prizes, attachments and empty states');
assert.ok(publicPrizeClient.includes('/public/prizes/catalogue') &&
  publicPrizeClient.includes("cache: 'no-store'") &&
  publicMediaProxy.includes('/public/prizes/images/') &&
  publicMediaProxy.includes("'Cache-Control': 'no-store'"),
  'Public prize data and images must bypass caches and use the safe backend');
assert.ok(publicPrizeController.includes('@Public()') &&
  publicPrizeController.includes("Controller('public/prizes')") &&
  publicPrizeService.includes("s.status='ACTIVE'") &&
  publicPrizeService.includes("p.status='ACTIVE'") &&
  publicPrizeService.includes('image.info.seasonId !== seasonId') &&
  publicPrizeService.includes('IMAGE_TYPES.has'),
  'Public prize endpoints must exclude drafts, inactive rows and unlinked media');
assert.ok(!/admin\/owner-portal|sessionStorage|localStorage/.test(monthlyPage + prizeDetail + publicPrizeClient),
  'Public pages must not access private admin or member APIs');
assert.ok(rewardsCss.includes('@media (max-width: 680px)') &&
  rewardsCss.includes(':focus-visible') &&
  rewardsCss.includes('prefers-reduced-motion') &&
  rewardsLayout.includes('mm-rewards-site'),
  'Rewards subsite must have responsive, reduced-motion and shared focus contracts');
assert.ok(browserUat.includes("name: 'public-awards-mobile'") &&
  browserUat.includes("name: 'public-monthly-prizes-mobile'") &&
  browserUat.includes("name: 'public-month-detail-mobile'") &&
  browserUat.includes("name: 'public-month-detail-desktop'") &&
  browserUat.includes('scenario.requireRewardNav'),
  'Browser UAT must exercise rewards and prize pages on mobile');
assert.equal((homepage.match(/<details className="mm-home-faq-item"/g) || []).length, 1,
  'FAQs must use accessible native details/summary, not JS-only state');
assert.ok(!/localStorage|sessionStorage|fetch\(|useEffect|useState|window\./.test(homepage),
  'Public homepage must stay static without secret-bearing client-side business logic');
assert.ok(!/guaranteed (returns|income|winnings)|earn ₹|₹\s*\d+|\d+% returns/i.test(homepage),
  'Homepage must not make invented financial claims');
assert.ok(homepage.includes('aria-hidden="true">\n            {heroSparkles.map(') &&
  homepage.includes('const heroSparkles = Array.from({ length: 40 }'),
  'Sparkles must be deterministic, decorative, and absent from assistive technology');
assert.ok(homepage.includes('<HomepageMotion />') &&
  homepage.includes('data-home-reveal') &&
  motion.includes("'use client'") &&
  motion.includes('IntersectionObserver') &&
  motion.includes('observer.unobserve(entry.target)') &&
  motion.includes("getBoundingClientRect().top") &&
  motion.includes("observer.disconnect()"),
  'Homepage reveals must be progressive, bounded, and cleaned up');

assert.ok(motion.includes("home.addEventListener('pointermove', onPointerMove, { passive: true })") &&
  motion.includes("home.removeEventListener('pointermove', onPointerMove)") &&
  motion.includes("event.pointerType !== 'mouse'") &&
  motion.includes("event.isPrimary") &&
  motion.includes("document.hidden") &&
  motion.includes("CURSOR_MAX_PARTICLES = 42") &&
  motion.includes("CURSOR_EMIT_INTERVAL_MS = 42") &&
  motion.includes("CURSOR_MIN_DISTANCE_PX") &&
  motion.includes("activeParticles.size >= CURSOR_MAX_PARTICLES") &&
  motion.includes("sparkle.addEventListener('animationend'") &&
  motion.includes("clearParticles();") &&
  motion.includes("layer.remove()"),
  'Cursor particles must be mouse-only, throttled, bounded, and cleaned up');
for (const capability of [
  "'(min-width: 681px)'",
  "'(prefers-reduced-motion: reduce)'",
  "desktopWidth.addEventListener('change'",
  "reducedMotion.addEventListener('change'",
  "document.addEventListener('visibilitychange'",
  "desktopWidth.removeEventListener('change'",
  "reducedMotion.removeEventListener('change'",
]) {
  assert.ok(motion.includes(capability), 'Cursor effect missing responsive motion control: ' + capability);
}
assert.ok(styles.includes('.mm-home-cursor-trail') &&
  styles.includes('pointer-events: none;') &&
  styles.includes('@keyframes mm-home-cursor-scatter') &&
  styles.includes('@media (max-width: 680px)') &&
  styles.includes('.mm-home-cursor-trail { display: none !important; }'),
  'Cursor sparkles must never intercept clicks or appear on touch/reduced-motion devices');
assert.ok(browserUat.includes("name: 'public-home-cursor-desktop'") &&
  browserUat.includes("scenario.verifyHomepageCursor") &&
  !browserUat.includes("Page.addScriptToEvaluateOnNewDocument") &&
  browserUat.includes("Input.dispatchMouseEvent") &&
  browserUat.includes("name: 'public-home-cursor-mobile'") &&
  browserUat.includes("Emulation.setEmulatedMedia") &&
  browserUat.includes("pointerType: 'touch'"),
  'Browser UAT must exercise the real cursor effect, touch bypass, and reduced-motion switch');

assert.ok(!/setInterval|Math\.random|canvas|getUserMedia|requestAnimationFrame/.test(motion),
  'Homepage motion must not add perpetual JS animation loops or dynamic randomness');
for (const name of ['sparkle-twinkle', 'ambient-drift', 'preview-float', 'trust-ring', 'reveal-in']) {
  assert.ok(styles.includes('@keyframes mm-home-' + name), 'Missing motion keyframes: ' + name);
}
assert.ok(styles.includes('.mm-home [data-home-reveal].mm-home-reveal-pending { opacity: 1 !important; transform: none !important; }'),
  'Reduced-motion users must never have hidden reveal content');
assert.ok(styles.includes('@media (max-width: 680px)') && styles.includes('@media (max-width: 370px)'),
  'Responsive phone layouts must be defined');
assert.ok(styles.includes('prefers-reduced-motion') && styles.includes(':focus-visible'),
  'Reduced-motion and keyboard focus visibility must be preserved');
assert.ok(!/^\s*(?:html|body|:root|button|input|select|textarea)\s*\{/m.test(styles),
  'Homepage stylesheet must not override shared auth/member styles globally');
assert.ok(styles.includes('.mm-home-faq-item') && styles.includes('.mm-home-preview') && styles.includes('.mm-home-rewards-grid'),
  'FAQ and illustrative dashboard must have dedicated styles');

console.log('MegaGoldenClub premium single-page homepage contract: PASS');
