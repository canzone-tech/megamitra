import { AdminEmailChangeForm } from '@/components/auth-account-forms';
import { OwnerManagementShell } from '@/components/owner-management-shell';
import { PlatformConfigAdmin } from '@/components/platform-config-admin';
import portalStyles from '@/components/owner-portal.module.css';
import styles from '@/components/security-portal.module.css';

export default function AdminSecurityPage() {
  return (
    <OwnerManagementShell title="Security & Registration" currentPath="/security">
      <section className={portalStyles.hero}>
        <h1>Authentication, Security & Registration</h1>
        <p>Configure platform access, session protection and member-onboarding rules before operational testing.</p>
        <span className={portalStyles.pill}>SUPERADMIN CONFIGURATION • DB BACKED • AUDITED</span>
      </section>

      <div className={styles.scope}>
        <PlatformConfigAdmin />

        <section className={`mm-card ${styles.accountCard}`}>
          <div className="mm-card-head"><h2>SuperAdmin account email</h2><span className="mm-chip warning">ACCOUNT ACTION</span></div>
          <div className="mm-card-body">
            <p className="mm-note" style={{ marginBottom: 16 }}>This changes only the signed-in SuperAdmin account email. It is separate from platform-wide authentication policy.</p>
            <AdminEmailChangeForm />
          </div>
        </section>
      </div>
    </OwnerManagementShell>
  );
}
