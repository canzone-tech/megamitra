const fs = require('node:fs');
const path = require('node:path');

const uiRoots = ['admin/app', 'admin/components', 'frontend/app', 'frontend/components'];
const uiFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file.endsWith('.tsx')) uiFiles.push(file);
  }
}
uiRoots.forEach(walk);

for (const file of uiFiles) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before.replaceAll('Mitra', 'GoldenClub');
  after = after
    .split('\n')
    .map((line) => {
      if (line.includes('<form') && line.includes('onSubmit=') && !line.includes('method=')) {
        return line.replace('<form', '<form method="post"');
      }
      return line;
    })
    .join('\n');
  if (after !== before) fs.writeFileSync(file, after);
}

function replaceRequired(file, from, to) {
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    throw new Error(`Expected production-copy source not found in ${file}: ${from}`);
  }
  fs.writeFileSync(file, before.split(from).join(to));
}

const edits = {
  'admin/app/login/page.tsx': [
    ['Operations console', 'Administration'],
    ['Run the program from verified facts.', 'Manage MegaGoldenClub with confidence.'],
    ['Policies, money movement, qualifications, draw operations and prize fulfillment stay auditable and separated by design.', 'Review members, programs, rewards, payouts and daily operations from one secure workspace.'],
    ['Secure access', 'Admin access'],
    ['Admin sign in', 'Sign in to continue'],
    ['MegaGoldenClub administrator credentials are verified by the API. Tokens stay in HttpOnly cookies in this web app.', 'Use your MegaGoldenClub administrator account to access the management console.'],
  ],
  'admin/components/login-form.tsx': [
    ['CAPTCHA is required, but a challenge could not be loaded. Please try again.', 'A security check is required, but it could not be loaded. Please try again.'],
    ['CAPTCHA was incorrect or expired. Please solve the new challenge.', 'The security check was incorrect or expired. Please try the new challenge.'],
    ['CAPTCHA verification is enabled. Please solve the challenge and sign in again.', 'Please complete the security check and sign in again.'],
    ['Open admin console', 'Sign in'],
  ],
  'admin/components/auth-page-shell.tsx': [
    ['Secure access, auditable recovery.', 'Keep your account secure.'],
    ['Recovery and verification requests use one-time expiring tokens. The completion link opens the canonical MegaGoldenClub public security flow.', 'Reset your password or verify your email using the secure link sent to your registered email address.'],
  ],
  'admin/app/forgot-password/page.tsx': [
    ['Enter the account email. MegaGoldenClub intentionally returns the same response whether or not an eligible account matches.', "Enter the email linked to your administrator account. If it can be used for recovery, we'll send password reset instructions."],
  ],
  'admin/app/request-email-verification/page.tsx': [
    ['Enter the account email. The response does not disclose whether an eligible account exists.', "Enter the email linked to your administrator account. If verification is available, we'll send a new link."],
  ],
  'admin/app/change-password/page.tsx': [
    ['Change required password', 'Set a new password'],
    ['Set a new password before continuing to MegaGoldenClub administration.', 'Choose a new password before continuing to the MegaGoldenClub admin area.'],
  ],
  'admin/app/security/page.tsx': [
    ['Verified email change', 'Change your admin email'],
    ['Changing the admin account email requires the current password plus confirmation from the new address. A successful change revokes all existing sessions.', "Enter your current password and confirm the new email address. For your security, you'll be signed out after the change."],
  ],
  'admin/components/operations-dashboard.tsx': [
    ['Authoritative exception handling', 'Daily operations'],
    ['Operations control room', 'Operations overview'],
    ['Refund effects, payout exceptions, product and prize fulfillment, reconciliation and audit history are surfaced from existing MegaGoldenClub domain records. Actions call the same audited backend workflows used by the underlying modules.', 'Review refunds, payouts, product benefits, prize fulfillment and items that need attention in one place.'],
  ],
  'admin/components/business-plan-config.tsx': [
    ["orchestration: 'Orchestration'", "orchestration: 'Automation'"],
    ['Versioned business truth', 'Business plan setup'],
    ['Manage the existing program, binary, referral, orchestration and lucky-draw policy engines without changing code. New rules are drafts first; published history stays immutable.', 'Manage program, binary, referral, automation and lucky draw rules from one place. Review changes as drafts before publishing them.'],
  ],
  'admin/components/entitlements-admin.tsx': [
    ['Configurable consumer rewards', 'Product benefits'],
    ['Product entitlement control', 'Products & benefits'],
    ['Catalog items, published entitlement rules, eligibility generation, member claims and provider-neutral fulfillment are kept auditable and versioned.', 'Manage products, eligibility rules, member claims and fulfillment from one workspace.'],
    ['Idempotent evaluation', 'Safe to run again'],
  ],
  'admin/components/kyc-admin.tsx': [
    ['Identity controls', 'Member verification'],
    ['Review member submissions against immutable published requirement versions. Decisions and policy lifecycle actions are audited.', 'Review member KYC submissions, update requirements and manage approval decisions from one workspace.'],
    ['Versioned requirements', 'Current requirements'],
  ],
  'admin/components/presentation-config.tsx': [
    ['Program progress, binary settlement, wallet, referrals, payouts and rewards from your authenticated MegaGoldenClub records.', 'See your program progress, wallet, referrals, binary rewards, withdrawals and lucky draw activity.'],
    ["walletSectionTitle: 'Wallet ledger'", "walletSectionTitle: 'Wallet activity'"],
    ['Theme & template governance', 'Portal appearance'],
    ['Configure member-portal appearance without changing financial or business truth. Drafts are editable; published versions are immutable and audited.', "Manage the member portal's colors, layout and wording. Preview changes as drafts, then publish when they are ready."],
    ['Member runtime will use this immutable version.', 'The member portal will now use this published version.'],
    ['Compiled default', 'Default design'],
    ['Loading presentation definitions…', 'Loading design settings…'],
  ],
  'admin/components/withdrawals-admin.tsx': [
    ['Reserved balance → payout → ledger', 'Withdrawal operations'],
    ['Review member requests, execute provider-neutral payout attempts, and post the wallet debit only after a payout is confirmed.', 'Review withdrawal requests, approve payouts and track payment status from one place.'],
    ['Ledger transaction', 'Wallet transaction'],
  ],
  'frontend/app/login/page.tsx': [
    ['Your rewards journey, clearly recorded.', 'Welcome back to MegaGoldenClub.'],
    ['Sign in to see program progress, wallet ledger activity, referral rewards, binary outcomes and lucky-draw status tied to your own account.', 'Sign in to check your program progress, payments, rewards, referrals, wallet activity and lucky draw status.'],
    ['Credentials are verified by MegaGoldenClub API and session tokens remain in HttpOnly cookies.', 'Use your MegaGoldenClub account to continue.'],
  ],
  'frontend/components/login-form.tsx': [
    ['CAPTCHA is required, but a challenge could not be loaded. Please try again.', 'A security check is required, but it could not be loaded. Please try again.'],
    ['CAPTCHA was incorrect or expired. Please solve the new challenge.', 'The security check was incorrect or expired. Please try the new challenge.'],
    ['CAPTCHA verification is enabled. Please solve the challenge and sign in again.', 'Please complete the security check and sign in again.'],
    ['Open my dashboard', 'Sign in'],
  ],
  'frontend/components/auth-page-shell.tsx': [
    ['Secure account access, without shortcuts.', 'Keep your account secure.'],
    ['Recovery and verification actions use expiring one-time links. Password resets and verified email changes revoke older sessions automatically.', 'Reset your password, verify your email or confirm an email change using the secure link sent to you.'],
  ],
  'frontend/app/forgot-password/page.tsx': [
    ['Enter the email attached to your MegaGoldenClub account. The response is intentionally the same whether or not an account matches.', "Enter the email linked to your MegaGoldenClub account. If password recovery is available, we'll send reset instructions."],
  ],
  'frontend/app/request-email-verification/page.tsx': [
    ['Enter the account email. For privacy, MegaGoldenClub returns the same response whether or not an eligible account matches.', "Enter the email linked to your account. If verification is available, we'll send a new link."],
  ],
  'frontend/app/reset-password/page.tsx': [
    ['A successful reset revokes every existing session and invalidates other outstanding account-action links.', 'Choose a strong new password. After the reset, sign in again with your new password.'],
  ],
  'frontend/app/verify-email/page.tsx': [
    ['Confirm the address attached to your account using the one-time link that was sent to you.', 'Confirm your email address using the link we sent you.'],
  ],
  'frontend/app/confirm-email-change/page.tsx': [
    ['The new address becomes verified only after this one-time confirmation. Existing sessions are revoked after the change.', "Confirm your new email address. For your security, you'll need to sign in again after the change."],
  ],
  'frontend/components/auth-recovery-forms.tsx': [
    ['Password reset completed. All previous sessions were revoked.', 'Password updated. Please sign in again with your new password.'],
    ['This password reset link is missing its secure token.', 'This password reset link is incomplete. Please request a new reset link.'],
    ['This verification link is missing its secure token.', 'This verification link is incomplete. Please request a new link.'],
    ['This email-change link is missing its secure token.', 'This email-change link is incomplete. Please request a new email change.'],
    ['Email changed and verified. Existing sessions were revoked; please sign in again.', 'Email updated successfully. Please sign in again.'],
  ],
  'frontend/app/page.tsx': [
    ['Rewards • transparency • community', 'Rewards • progress • community'],
    ['Small steps. <span className="mm-gradient-word">Brighter rewards.</span>', 'Your progress. <span className="mm-gradient-word">Your rewards.</span> One place.'],
    ['MegaGoldenClub brings program participation, payments, qualification, referrals, lucky draws and prize fulfillment into one auditable member experience. Your dashboard shows facts recorded by the platform—not promotional estimates.', 'MegaGoldenClub helps you keep track of your participation, payments, referrals, rewards, lucky draws and prize claims in one simple member experience.'],
    ['One clear view of your participation.', 'One clear view of your journey.'],
    ['Commercial values and eligibility come from published policies; the website does not invent them.', 'See the information that applies to your account and program.'],
    ['Enrollment, dues and payment facts.', 'Enrollment and payment status.'],
    ['Referral and binary outcomes with immutable records.', 'Referral and binary reward activity.'],
    ['Eligibility, entries, wins and claim status.', 'Entries, results and claim status.'],
    ['Wallet truth', 'Wallet'],
    ['Balance derived from the financial ledger.', 'Current balance and transaction history.'],
    ['Designed around recorded facts.', 'Everything important, easy to follow.'],
    ['MegaGoldenClub keeps participation, reward calculation, draw selection and fulfillment as separate auditable stages. Your portal reads those authoritative records without creating hidden business rules.', 'From joining a program to receiving rewards, your portal keeps each step organized and visible.'],
    ['See your enrollment and payment status from the configured program version you joined.', 'Follow your enrollment and payments.'],
    ['Track referral, binary and draw eligibility only when published policies create those facts.', 'See your referral, binary and draw eligibility as it updates.'],
    ['View reward postings, draw outcomes, prize claims and fulfillment without rewriting history.', 'Track rewards, draw results and prize claims.'],
  ],
  'frontend/components/member-dashboard.tsx': [
    ['Program progress, binary settlement, wallet, referrals, payouts and rewards from your authenticated MegaGoldenClub records.', 'See your program progress, wallet, referrals, binary rewards, withdrawals and lucky draw activity.'],
    ['Authoritative account view', 'Your account overview'],
    ['Immutable ledger balance', 'Current account balance'],
    ['Published plan context', 'Your current plan'],
    ['Current qualifying queue', 'Current available units'],
    ['No settlement recorded yet', 'No binary payout recorded yet'],
  ],
  'frontend/components/member-security.tsx': [
    ['Email changes require your current password plus confirmation from the new address. Successful changes revoke existing sessions.', "To change your email, enter your current password and confirm the new address. For your security, you'll be signed out after the change."],
  ],
  'frontend/components/member-withdrawals.tsx': [
    ['Requests reserve your available wallet balance while they are reviewed. The settled ledger changes only after a payout is confirmed.', 'When you submit a withdrawal, the requested amount is held while it is reviewed. Your balance updates when the payout is completed.'],
    ['Ledger balance', 'Wallet balance'],
    ['Active policy', 'Withdrawal limits & fees'],
    ['Reserved until finalized', 'Held while processing'],
    ['A published policy is required before withdrawals can be requested.', 'Withdrawals are not available for this currency right now.'],
    ['Provider-neutral references', 'Saved destinations'],
    ['Destination reference', 'UPI ID / account reference'],
    ['UPI ID or provider beneficiary reference', 'Enter the payout reference for this destination'],
  ],
  'frontend/components/member-entitlements.tsx': [
    ['Consumer rewards', 'Member benefits'],
    ['Entitlements are generated from published MegaGoldenClub rules and your verified program state. Historical grants keep the product and eligibility snapshot used when they were created.', 'See the product benefits available to you, claim eligible benefits and follow fulfillment status here.'],
    ['Entitlement history', 'Benefit history'],
    ['No product entitlements have been generated for your account yet.', 'No product benefits are available for your account yet.'],
  ],
  'frontend/components/member-kyc.tsx': [
    ['Submit the fields and document references required by the currently published MegaGoldenClub KYC policy. Every submission and review decision remains auditable.', 'Complete the requested details and document references to submit your KYC for review.'],
    ['Versioned requirements', 'Current requirements'],
    ['No active published default KYC policy is available.', 'KYC submission is not available right now.'],
    ['Reference returned by configured document storage', 'Enter the reference for this document'],
  ],
  'frontend/components/presentation-runtime.tsx': [
    ['Program progress, binary settlement, wallet, referrals, payouts and rewards from your authenticated MegaGoldenClub records.', 'See your program progress, wallet, referrals, binary rewards, withdrawals and lucky draw activity.'],
    ["walletSectionTitle: 'Wallet ledger'", "walletSectionTitle: 'Wallet activity'"],
  ],
  'backend/src/presentation/presentation-schema.ts': [
    ['Program progress, binary settlement, wallet, referrals, payouts and rewards from your authenticated MegaGoldenClub records.', 'See your program progress, wallet, referrals, binary rewards, withdrawals and lucky draw activity.'],
    ["walletSectionTitle: 'Wallet ledger'", "walletSectionTitle: 'Wallet activity'"],
  ],
};

for (const [file, pairs] of Object.entries(edits)) {
  for (const [from, to] of pairs) replaceRequired(file, from, to);
}

const safetyLines = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  '',
  "const roots = ['admin/app', 'admin/components', 'frontend/app', 'frontend/components'];",
  'const files = [];',
  'function walk(dir) {',
  '  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {',
  '    const file = path.join(dir, entry.name);',
  '    if (entry.isDirectory()) walk(file);',
  "    else if (entry.isFile() && file.endsWith('.tsx')) files.push(file);",
  '  }',
  '}',
  'roots.forEach(walk);',
  '',
  'const forbiddenCopy = [',
  '  /\\bMitra\\b/i,',
  '  /\\bHttpOnly\\b/i,',
  '  /\\bsession tokens?\\b/i,',
  '  /verified by (?:the )?(?:MegaGoldenClub )?API/i,',
  '  /canonical .*security flow/i,',
  '];',
  '',
  'const failures = [];',
  'for (const file of files) {',
  "  const source = fs.readFileSync(file, 'utf8');",
  '  for (const pattern of forbiddenCopy) {',
  '    if (pattern.test(source)) failures.push(`${file}: forbidden client-facing source pattern ${pattern}`);',
  '  }',
  "  source.split('\\n').forEach((line, index) => {",
  "    if (line.includes('<form') && line.includes('onSubmit=') && !line.includes('method=')) {",
  '      failures.push(`${file}:${index + 1}: interactive form must declare method="post" to prevent native GET fallback`);',
  '    }',
  '  });',
  '}',
  '',
  'if (failures.length) {',
  "  console.error(failures.join('\\n'));",
  '  process.exit(1);',
  '}',
  "console.log('MegaGoldenClub frontend safety verification: PASS');",
  '',
];
fs.writeFileSync('scripts/verify-frontend-safety.mjs', safetyLines.join('\n'));

const brandingPath = 'scripts/verify-branding.sh';
let branding = fs.readFileSync(brandingPath, 'utf8');
if (!branding.includes('legacy MegaMitra branding found in client-facing UI')) {
  const anchor = [
    'if git grep -niE "${FOREIGN_BRAND_REGEX}" -- \':!backend/prisma/migrations/**\'; then',
    '  echo "ERROR: foreign project branding found"',
    '  exit 1',
    'fi',
    '',
  ].join('\n');
  if (!branding.includes(anchor)) throw new Error('Brand verifier anchor not found');
  const extra = [
    anchor,
    "if git grep -ni 'Mitra' -- admin/app admin/components frontend/app frontend/components; then",
    '  echo "ERROR: legacy MegaMitra branding found in client-facing UI"',
    '  exit 1',
    'fi',
    '',
    "UI_TECH_COPY_REGEX='HttpOnly|session tokens?|verified by (the )?(MegaGoldenClub )?API|canonical .*security flow'",
    'if git grep -niE "${UI_TECH_COPY_REGEX}" -- admin/app admin/components frontend/app frontend/components; then',
    '  echo "ERROR: engineering-only authentication copy found in client-facing UI"',
    '  exit 1',
    'fi',
    '',
  ].join('\n');
  branding = branding.replace(anchor, extra);
  fs.writeFileSync(brandingPath, branding);
}

const verifyPath = 'scripts/verify-frontends.sh';
let verify = fs.readFileSync(verifyPath, 'utf8');
if (!verify.includes('verify-frontend-safety.mjs')) {
  const anchor = [
    'echo "==> Verifying MegaGoldenClub branding contract"',
    'bash "${ROOT_DIR}/scripts/verify-branding.sh"',
    '',
  ].join('\n');
  if (!verify.includes(anchor)) throw new Error('Frontend verifier brand anchor not found');
  verify = verify.replace(anchor, anchor + [
    'echo "==> Verifying frontend privacy and native-form safety"',
    'node "${ROOT_DIR}/scripts/verify-frontend-safety.mjs"',
    '',
  ].join('\n'));
}

if (!verify.includes('expect_body_text()')) {
  const anchor = [
    "  if grep -qi '^x-powered-by:' <<<\"${headers}\"; then",
    '    echo "ERROR: framework powered-by header leaked on ${url}"',
    '    exit 1',
    '  fi',
    '}',
    '',
  ].join('\n');
  if (!verify.includes(anchor)) throw new Error('Frontend verifier security helper anchor not found');
  const helpers = [
    anchor,
    'expect_body_text() {',
    '  local url="$1"',
    '  local text="$2"',
    '  if ! curl -fsS "${url}" | grep -Fq -- "${text}"; then',
    '    echo "ERROR: expected rendered text not found on ${url}: ${text}"',
    '    exit 1',
    '  fi',
    '}',
    '',
    'expect_body_absent() {',
    '  local url="$1"',
    '  local text="$2"',
    '  if curl -fsS "${url}" | grep -Fiq -- "${text}"; then',
    '    echo "ERROR: forbidden rendered text found on ${url}: ${text}"',
    '    exit 1',
    '  fi',
    '}',
    '',
    'expect_post_form() {',
    '  local url="$1"',
    '  if ! curl -fsS "${url}" | grep -Eq \'<form[^>]*method="post"\'; then',
    '    echo "ERROR: rendered auth form does not declare method=post on ${url}"',
    '    exit 1',
    '  fi',
    '}',
    '',
  ].join('\n');
  verify = verify.replace(anchor, helpers);
}

if (!verify.includes('expect_post_form "http://127.0.0.1:3101/login"')) {
  const anchor = [
    '  expect_security_headers "http://127.0.0.1:3101/login"',
    '  expect_security_headers "http://127.0.0.1:3102/"',
    '',
  ].join('\n');
  if (!verify.includes(anchor)) throw new Error('Frontend verifier smoke anchor not found');
  const assertions = [
    anchor,
    '  expect_body_text "http://127.0.0.1:3101/login" "MegaGoldenClub"',
    '  expect_body_absent "http://127.0.0.1:3101/login" "MegaMitra"',
    '  expect_body_absent "http://127.0.0.1:3101/login" "HttpOnly"',
    '  expect_body_absent "http://127.0.0.1:3101/login" "verified by the API"',
    '  expect_post_form "http://127.0.0.1:3101/login"',
    '  expect_body_text "http://127.0.0.1:3102/login" "MegaGoldenClub"',
    '  expect_body_absent "http://127.0.0.1:3102/login" "MegaMitra"',
    '  expect_body_absent "http://127.0.0.1:3102/login" "HttpOnly"',
    '  expect_post_form "http://127.0.0.1:3102/login"',
    '  expect_body_text "http://127.0.0.1:3102/" "MegaGoldenClub"',
    '  expect_body_absent "http://127.0.0.1:3102/" "MegaMitra"',
    '',
  ].join('\n');
  verify = verify.replace(anchor, assertions);
}
fs.writeFileSync(verifyPath, verify);

console.log(`Prepared production UI hardening across ${uiFiles.length} UI source files.`);
