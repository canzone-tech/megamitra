import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function text(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`Public receipt contract missing ${label}`);
  }
}

const [layout, component, styles] = await Promise.all([
  text('frontend/app/receipts/layout.tsx'),
  text('frontend/components/public-payment-receipt.tsx'),
  text('frontend/app/receipts/receipt.css'),
]);

requireText(layout, "import './receipt.css';", 'route-scoped stylesheet import');
requireText(component, "if (!/^[1-9][0-9]{4}$/.test(token)) return [];", 'five-digit non-zero token validation');
requireText(component, "receipt.status === 'CONFIRMED' && tokens.length > 0", 'confirmed-only token rendering');
requireText(component, 'never recycled', 'permanent token copy');
requireText(component, 'Rejected installment submissions do not receive a lucky draw token.', 'rejected-token state');
requireText(component, 'issued only after Super Admin verifies and confirms this installment payment.', 'pending-token state');
requireText(styles, '.mm-receipt-token-number', 'prominent token styling');
requireText(styles, '@media (max-width: 720px)', 'mobile receipt layout');
requireText(styles, '@media print', 'print receipt layout');

console.log('MegaGoldenClub public receipt surface contract: PASS');
