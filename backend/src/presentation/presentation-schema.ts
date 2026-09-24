import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type PresentationKind = 'THEME' | 'TEMPLATE' | 'CMS';
export type PresentationSurface = 'PUBLIC' | 'AUTH' | 'MEMBER' | 'ADMIN';

export type ThemeDocument = {
  primary: string;
  secondary: string;
  accent: string;
  pageBackground: string;
  cardBackground: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
  radius: 'SMALL' | 'MEDIUM' | 'LARGE';
  density: 'COMPACT' | 'COMFORTABLE' | 'SPACIOUS';
  shadow: 'SUBTLE' | 'MEDIUM' | 'STRONG';
};

export type TemplateDocument = {
  sidebarVisible: boolean;
  sidebarPosition: 'LEFT' | 'RIGHT';
  sidebarWidth: 'COMPACT' | 'DEFAULT' | 'WIDE';
  sidebarStyle: 'LIGHT' | 'DARK' | 'BRAND';
  navigationStyle: 'FLAT' | 'PILL';
  topbarVisible: boolean;
  topbarSticky: boolean;
  topbarStyle: 'LIGHT' | 'DARK' | 'BRAND' | 'GLASS';
  topbarDensity: 'COMPACT' | 'COMFORTABLE';
  contentWidth: 'STANDARD' | 'WIDE' | 'FULL';
  mobileNavigation: 'BOTTOM' | 'DRAWER';
};

export type CmsDocument = {
  dashboardEyebrow: string;
  dashboardSubtitle: string;
  binarySectionTitle: string;
  programSectionTitle: string;
  walletSectionTitle: string;
  rewardsSectionTitle: string;
};

export type PresentationContent = ThemeDocument | TemplateDocument | CmsDocument;

export const DEFAULT_THEME: ThemeDocument = {
  primary: '#0B5EC7',
  secondary: '#C90067',
  accent: '#F4B51C',
  pageBackground: '#F6F7FB',
  cardBackground: '#FFFFFF',
  textColor: '#17152B',
  mutedTextColor: '#74788B',
  borderColor: '#E7E9F1',
  gradientFrom: '#0B5EC7',
  gradientVia: '#C90067',
  gradientTo: '#F4B51C',
  radius: 'MEDIUM',
  density: 'COMFORTABLE',
  shadow: 'SUBTLE',
};

export const DEFAULT_TEMPLATE: TemplateDocument = {
  sidebarVisible: true,
  sidebarPosition: 'LEFT',
  sidebarWidth: 'DEFAULT',
  sidebarStyle: 'LIGHT',
  navigationStyle: 'PILL',
  topbarVisible: true,
  topbarSticky: true,
  topbarStyle: 'GLASS',
  topbarDensity: 'COMFORTABLE',
  contentWidth: 'WIDE',
  mobileNavigation: 'BOTTOM',
};

export const DEFAULT_CMS: CmsDocument = {
  dashboardEyebrow: 'My MegaMitra',
  dashboardSubtitle:
    'Program progress, binary settlement, wallet, referrals, payouts and rewards from your authenticated MegaMitra records.',
  binarySectionTitle: 'Binary performance',
  programSectionTitle: 'Program progress',
  walletSectionTitle: 'Wallet ledger',
  rewardsSectionTitle: 'Rewards & referrals',
};

const HEX = /^#[0-9a-f]{6}$/i;

function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Presentation content must be an object');
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unknown.length || missing.length) {
    throw new BadRequestException(
      `Invalid presentation content keys${unknown.length ? `; unknown: ${unknown.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`,
    );
  }
}

function stringValue(value: unknown, name: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new BadRequestException(`${name} must be a non-empty string up to ${maxLength} characters`);
  }
  return value.trim();
}

function enumValue<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BadRequestException(`${name} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function boolValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${name} must be boolean`);
  return value;
}

function colorValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !HEX.test(value)) {
    throw new BadRequestException(`${name} must be a six-digit hex color`);
  }
  return value.toUpperCase();
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (bright + 0.05) / (dark + 0.05);
}

export function validateTheme(value: unknown): ThemeDocument {
  const input = assertObject(value);
  const keys = [
    'primary',
    'secondary',
    'accent',
    'pageBackground',
    'cardBackground',
    'textColor',
    'mutedTextColor',
    'borderColor',
    'gradientFrom',
    'gradientVia',
    'gradientTo',
    'radius',
    'density',
    'shadow',
  ] as const;
  assertExactKeys(input, keys);
  const result: ThemeDocument = {
    primary: colorValue(input.primary, 'primary'),
    secondary: colorValue(input.secondary, 'secondary'),
    accent: colorValue(input.accent, 'accent'),
    pageBackground: colorValue(input.pageBackground, 'pageBackground'),
    cardBackground: colorValue(input.cardBackground, 'cardBackground'),
    textColor: colorValue(input.textColor, 'textColor'),
    mutedTextColor: colorValue(input.mutedTextColor, 'mutedTextColor'),
    borderColor: colorValue(input.borderColor, 'borderColor'),
    gradientFrom: colorValue(input.gradientFrom, 'gradientFrom'),
    gradientVia: colorValue(input.gradientVia, 'gradientVia'),
    gradientTo: colorValue(input.gradientTo, 'gradientTo'),
    radius: enumValue(input.radius, 'radius', ['SMALL', 'MEDIUM', 'LARGE']),
    density: enumValue(input.density, 'density', ['COMPACT', 'COMFORTABLE', 'SPACIOUS']),
    shadow: enumValue(input.shadow, 'shadow', ['SUBTLE', 'MEDIUM', 'STRONG']),
  };
  if (contrast(result.pageBackground, result.textColor) < 4.5) {
    throw new BadRequestException('Page background and text color must meet WCAG AA contrast');
  }
  if (contrast(result.cardBackground, result.textColor) < 4.5) {
    throw new BadRequestException('Card background and text color must meet WCAG AA contrast');
  }
  if (contrast(result.pageBackground, result.mutedTextColor) < 3) {
    throw new BadRequestException('Muted text must retain readable contrast on the page background');
  }
  return result;
}

export function validateTemplate(value: unknown): TemplateDocument {
  const input = assertObject(value);
  const keys = [
    'sidebarVisible',
    'sidebarPosition',
    'sidebarWidth',
    'sidebarStyle',
    'navigationStyle',
    'topbarVisible',
    'topbarSticky',
    'topbarStyle',
    'topbarDensity',
    'contentWidth',
    'mobileNavigation',
  ] as const;
  assertExactKeys(input, keys);
  return {
    sidebarVisible: boolValue(input.sidebarVisible, 'sidebarVisible'),
    sidebarPosition: enumValue(input.sidebarPosition, 'sidebarPosition', ['LEFT', 'RIGHT']),
    sidebarWidth: enumValue(input.sidebarWidth, 'sidebarWidth', ['COMPACT', 'DEFAULT', 'WIDE']),
    sidebarStyle: enumValue(input.sidebarStyle, 'sidebarStyle', ['LIGHT', 'DARK', 'BRAND']),
    navigationStyle: enumValue(input.navigationStyle, 'navigationStyle', ['FLAT', 'PILL']),
    topbarVisible: boolValue(input.topbarVisible, 'topbarVisible'),
    topbarSticky: boolValue(input.topbarSticky, 'topbarSticky'),
    topbarStyle: enumValue(input.topbarStyle, 'topbarStyle', ['LIGHT', 'DARK', 'BRAND', 'GLASS']),
    topbarDensity: enumValue(input.topbarDensity, 'topbarDensity', ['COMPACT', 'COMFORTABLE']),
    contentWidth: enumValue(input.contentWidth, 'contentWidth', ['STANDARD', 'WIDE', 'FULL']),
    mobileNavigation: enumValue(input.mobileNavigation, 'mobileNavigation', ['BOTTOM', 'DRAWER']),
  };
}

export function validateCms(value: unknown): CmsDocument {
  const input = assertObject(value);
  const keys = [
    'dashboardEyebrow',
    'dashboardSubtitle',
    'binarySectionTitle',
    'programSectionTitle',
    'walletSectionTitle',
    'rewardsSectionTitle',
  ] as const;
  assertExactKeys(input, keys);
  return {
    dashboardEyebrow: stringValue(input.dashboardEyebrow, 'dashboardEyebrow', 80),
    dashboardSubtitle: stringValue(input.dashboardSubtitle, 'dashboardSubtitle', 320),
    binarySectionTitle: stringValue(input.binarySectionTitle, 'binarySectionTitle', 80),
    programSectionTitle: stringValue(input.programSectionTitle, 'programSectionTitle', 80),
    walletSectionTitle: stringValue(input.walletSectionTitle, 'walletSectionTitle', 80),
    rewardsSectionTitle: stringValue(input.rewardsSectionTitle, 'rewardsSectionTitle', 80),
  };
}

export function defaultContent(kind: PresentationKind): PresentationContent {
  if (kind === 'THEME') return { ...DEFAULT_THEME };
  if (kind === 'TEMPLATE') return { ...DEFAULT_TEMPLATE };
  return { ...DEFAULT_CMS };
}

export function validatePresentationContent(kind: PresentationKind, value: unknown): PresentationContent {
  if (kind === 'THEME') return validateTheme(value);
  if (kind === 'TEMPLATE') return validateTemplate(value);
  return validateCms(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function checksum(content: PresentationContent): string {
  return createHash('sha256').update(JSON.stringify(stableValue(content))).digest('hex');
}
