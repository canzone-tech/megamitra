'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { OwnerManagementShell } from './owner-management-shell';
import styles from './owner-portal.module.css';

type AccessSection = 'staff' | 'rbac';
type Permission = { id: string; code: string; description?: string | null };
type RolePermission = { permission: Permission };
type Role = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  permissions: RolePermission[];
};
type UserRole = { role: { id: string; name: string; status: string } };
type ManagedUser = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: UserRole[];
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
function fullName(user: ManagedUser) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username;
}
function roleNames(user: ManagedUser) {
  return user.roles.map((item) => item.role.name);
}
function dateTime(value: string | null) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

export function AccessControlPortal({ section }: { section: AccessSection }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      if (section === 'staff') {
        const allUsers = await apiJson<ManagedUser[]>('/api/backend/admin/users');
        setUsers(allUsers.filter((user) => roleNames(user).some((role) => ['SUPER_ADMIN', 'ADMIN', 'AGENT'].includes(role))));
        return;
      }
      const [nextRoles, nextPermissions] = await Promise.all([
        apiJson<Role[]>('/api/backend/admin/rbac/roles'),
        apiJson<Permission[]>('/api/backend/admin/rbac/permissions'),
      ]);
      setRoles(nextRoles);
      setPermissions(nextPermissions);
      setDrafts(Object.fromEntries(nextRoles.map((role) => [
        role.name,
        role.permissions.map((item) => item.permission.code),
      ])));
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : reason instanceof Error ? reason.message : 'Unable to load access control');
    }
  }, [section]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(success);
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : reason instanceof Error ? reason.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      role: String(form.get('role') ?? ''),
      username: String(form.get('username') ?? '').trim() || undefined,
      firstName: String(form.get('firstName') ?? '').trim() || undefined,
      lastName: String(form.get('lastName') ?? '').trim() || undefined,
      email: String(form.get('email') ?? '').trim() || undefined,
      phone: String(form.get('phone') ?? '').trim() || undefined,
      password: String(form.get('password') ?? ''),
    };
    await run(
      () => apiJson('/api/backend/admin/users/staff', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      `${payload.role} account created. First login requires a password change.`,
    );
    event.currentTarget.reset();
  }

  async function setStaffRole(user: ManagedUser, role: 'ADMIN' | 'AGENT') {
    await run(
      () => apiJson(`/api/backend/admin/users/${encodeURIComponent(user.id)}/roles`, {
        method: 'PUT',
        body: JSON.stringify({ roles: [role] }),
      }),
      `${user.username} is now ${role}.`,
    );
  }

  async function setStatus(user: ManagedUser, status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED') {
    await run(
      () => apiJson(`/api/backend/admin/users/${encodeURIComponent(user.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
      `${user.username} status changed to ${status}.`,
    );
  }

  function togglePermission(roleName: string, code: string) {
    setDrafts((current) => {
      const selected = new Set(current[roleName] ?? []);
      if (selected.has(code)) selected.delete(code);
      else selected.add(code);
      return { ...current, [roleName]: [...selected].sort() };
    });
  }

  async function saveRole(roleName: 'ADMIN' | 'AGENT') {
    await run(
      () => apiJson(`/api/backend/admin/rbac/roles/${roleName}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: drafts[roleName] ?? [] }),
      }),
      `${roleName} permissions saved.`,
    );
  }

  return (
    <OwnerManagementShell
      title={section === 'staff' ? 'Admins & Agents' : 'Roles & Permissions'}
      currentSection={section}
    >
      <section className={styles.hero}>
        <h1>{section === 'staff' ? 'Admins & Agents' : 'Roles & Permissions'}</h1>
        <p>
          {section === 'staff'
            ? 'Create and control delegated management accounts without mixing them with member accounts.'
            : 'Assign exactly what ADMIN and AGENT accounts can access. SUPER_ADMIN remains the platform invariant.'}
        </p>
        <span className={styles.pill}>SUPER_ADMIN • ADMIN • AGENT • MEMBER</span>
      </section>

      {error ? <div className={classNames(styles.notice, styles.error)} role="alert">{error}</div> : null}
      {notice ? <div className={classNames(styles.notice, styles.success)} role="status">{notice}</div> : null}

      {section === 'staff' ? <StaffWorkspace /> : <RbacWorkspace />}
    </OwnerManagementShell>
  );

  function StaffWorkspace() {
    return <div className={styles.grid2}>
      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}><span className={styles.sectionIcon}>+</span><h2>Create Admin / Agent</h2></div>
          <small>Role is assigned atomically</small>
        </div>
        <form method="post" onSubmit={createStaff}>
          <div className={styles.fields}>
            <div className={styles.field}><label>Account Role</label><select name="role" className={styles.select} required><option value="ADMIN">Admin</option><option value="AGENT">Agent</option></select></div>
            <div className={styles.field}><label>Username</label><input name="username" className={styles.input} minLength={3} placeholder="Username" /></div>
            <div className={styles.field}><label>First Name</label><input name="firstName" className={styles.input} /></div>
            <div className={styles.field}><label>Last Name</label><input name="lastName" className={styles.input} /></div>
            <div className={styles.field}><label>Email</label><input name="email" type="email" className={styles.input} /></div>
            <div className={styles.field}><label>Mobile</label><input name="phone" className={styles.input} /></div>
            <div className={classNames(styles.field, styles.full)}><label>Initial Password</label><input name="password" type="password" autoComplete="new-password" className={styles.input} required /></div>
          </div>
          <div className={styles.notice}>New staff accounts are ACTIVE but must change their initial password before using management tools.</div>
          <div className={styles.buttonLine}><button className={styles.button} disabled={busy}>CREATE ACCOUNT</button></div>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}><span className={styles.sectionIcon}>♟</span><h2>Management Accounts</h2></div>
          <small>{users.length} account(s)</small>
        </div>
        {users.length ? <div className={styles.tableBox}><table className={styles.table}>
          <thead><tr><th>ACCOUNT</th><th>ROLE</th><th>STATUS</th><th>LAST LOGIN</th><th>ACTIONS</th></tr></thead>
          <tbody>{users.map((user) => {
            const names = roleNames(user);
            const isSuperAdmin = names.includes('SUPER_ADMIN');
            const role = isSuperAdmin ? 'SUPER_ADMIN' : names.includes('ADMIN') ? 'ADMIN' : 'AGENT';
            return <tr key={user.id}>
              <td><b>{user.username}</b><br />{fullName(user)}<br /><small>{user.email ?? user.phone ?? 'No contact'}</small></td>
              <td><span className={styles.tag}>{role}</span>{user.mustChangePassword ? <><br /><small>Password change required</small></> : null}</td>
              <td className={user.status === 'ACTIVE' ? styles.status : styles.statusOff}>{user.status}</td>
              <td>{dateTime(user.lastLoginAt)}</td>
              <td>{isSuperAdmin ? <span className={styles.tag}>Protected</span> : <div className={styles.buttonLine}>
                <select className={styles.select} value={role} disabled={busy} onChange={(event) => void setStaffRole(user, event.target.value as 'ADMIN' | 'AGENT')}><option value="ADMIN">Admin</option><option value="AGENT">Agent</option></select>
                <select className={styles.select} value={user.status} disabled={busy} onChange={(event) => void setStatus(user, event.target.value as 'ACTIVE' | 'SUSPENDED' | 'BLOCKED')}><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="BLOCKED">Blocked</option></select>
              </div>}</td>
            </tr>;
          })}</tbody>
        </table></div> : <div className={styles.empty}>No admin or agent accounts found.</div>}
      </section>
    </div>;
  }

  function RbacWorkspace() {
    const roleMap = useMemo(() => new Map(roles.map((role) => [role.name, role])), [roles]);
    return <>
      <div className={styles.kpis}>
        {['SUPER_ADMIN', 'ADMIN', 'AGENT', 'MEMBER'].map((name) => <div className={styles.kpi} key={name}>
          <small>Account Role</small><strong>{name.replace('_', ' ')}</strong>
          <span>{name === 'SUPER_ADMIN' ? 'All permissions • protected invariant' : name === 'MEMBER' ? 'Member portal only' : `${roleMap.get(name)?.permissions.length ?? 0} permission(s)`}</span>
        </div>)}
      </div>
      <div className={styles.grid2}>
        {(['ADMIN', 'AGENT'] as const).map((roleName) => {
          const role = roleMap.get(roleName);
          const selected = new Set(drafts[roleName] ?? []);
          return <section className={styles.card} key={roleName}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}><span className={styles.sectionIcon}>⌾</span><h2>{roleName} Permissions</h2></div>
              <small>{role?.description ?? 'Delegated management role'}</small>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {permissions.map((permission) => <label key={permission.code} className={styles.notice} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(permission.code)} onChange={() => togglePermission(roleName, permission.code)} disabled={busy} />
                <span><b>{permission.code}</b>{permission.description ? <><br /><small>{permission.description}</small></> : null}</span>
              </label>)}
            </div>
            <div className={styles.buttonLine}><button type="button" className={styles.button} disabled={busy} onClick={() => void saveRole(roleName)}>SAVE {roleName} PERMISSIONS</button></div>
          </section>;
        })}
      </div>
      <div className={styles.notice}><b>SUPER_ADMIN</b> permissions cannot be edited. <b>MEMBER</b> is the member-portal role. The account model remains limited to SUPER_ADMIN, ADMIN, AGENT and MEMBER.</div>
    </>;
  }
}
