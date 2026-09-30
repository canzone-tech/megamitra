export type OwnerManagementSection =
  | 'dashboard'
  | 'income'
  | 'members'
  | 'binary'
  | 'placement'
  | 'seasons'
  | 'draw'
  | 'winners'
  | 'prizes'
  | 'payments'
  | 'member-payments'
  | 'wallet'
  | 'epins'
  | 'auth-codes'
  | 'staff'
  | 'rbac'
  | 'reports'
  | 'notifications'
  | 'support'
  | 'settings';

export type OwnerManagementNavItem = {
  section: OwnerManagementSection;
  label: string;
  symbol: string;
  group: string;
};

export const OWNER_MANAGEMENT_NAV: OwnerManagementNavItem[] = [
  { section: 'dashboard', label: 'Dashboard', symbol: '▦', group: 'Main' },
  { section: 'income', label: '9 Income Types', symbol: '↗', group: 'Main' },
  { section: 'members', label: 'Members', symbol: '●', group: 'Main' },
  { section: 'binary', label: 'Binary 1:4', symbol: '◇', group: 'Main' },
  { section: 'placement', label: 'Placement / Pairing', symbol: '⌁', group: 'Main' },
  { section: 'seasons', label: 'Season Management', symbol: '□', group: 'Season & Draw' },
  { section: 'draw', label: 'Monthly Draw', symbol: '◆', group: 'Season & Draw' },
  { section: 'winners', label: 'Winners', symbol: '★', group: 'Season & Draw' },
  { section: 'prizes', label: 'Prize Catalogue', symbol: '▣', group: 'Season & Draw' },
  { section: 'payments', label: 'Payments / Bills', symbol: '¤', group: 'Finance & Security' },
  { section: 'member-payments', label: 'Member Verification', symbol: '✓', group: 'Finance & Security' },
  { section: 'wallet', label: 'Wallet / Ledger', symbol: '▤', group: 'Finance & Security' },
  { section: 'epins', label: 'E-PIN Management', symbol: '⌘', group: 'Finance & Security' },
  { section: 'auth-codes', label: 'Auth Codes', symbol: '◈', group: 'Finance & Security' },
  { section: 'staff', label: 'Admins & Agents', symbol: '♟', group: 'Access Control' },
  { section: 'rbac', label: 'Roles & Permissions', symbol: '⌾', group: 'Access Control' },
  { section: 'reports', label: 'Reports', symbol: '▥', group: 'Control' },
  { section: 'notifications', label: 'Notifications', symbol: '◉', group: 'Control' },
  { section: 'support', label: 'Support', symbol: '?', group: 'Control' },
  { section: 'settings', label: 'Settings', symbol: '⚙', group: 'Control' },
];

export const OWNER_MANAGEMENT_GROUPS = OWNER_MANAGEMENT_NAV.reduce<
  Array<[string, OwnerManagementNavItem[]]>
>((groups, item) => {
  const current = groups.find(([group]) => group === item.group);
  if (current) current[1].push(item);
  else groups.push([item.group, [item]]);
  return groups;
}, []);

export function ownerManagementHref(section: OwnerManagementSection) {
  return section === 'dashboard' ? '/operations' : `/portal/${section}`;
}
