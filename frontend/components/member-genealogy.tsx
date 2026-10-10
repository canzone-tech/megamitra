'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import { MemberHeader } from '@/components/member-header';
import styles from './member-genealogy.module.css';

type Slot = 'A' | 'B' | 'C' | 'D';
type Member = {
  id: string; username: string; firstName: string | null; lastName: string | null;
  status: string; parentUserId: string; parentUsername: string;
  slot: Slot; side: 'LEFT' | 'RIGHT'; depth: number;
  firstLegSlot: Slot; firstLegSide: 'LEFT' | 'RIGHT';
};
type Root = {
  id: string; username: string; firstName: string | null; lastName: string | null;
  status: string; placementParentUserId: string | null;
  placementParentUsername: string | null; directChildCount: number;
};
type Tree = {
  homeRootUserId: string; root: Root; members: Member[];
  visibleMemberCount: number; canGoToParent: boolean;
};
const SLOTS: Slot[] = ['A', 'B', 'C', 'D'];
function memberName(member: Pick<Root, 'firstName' | 'lastName' | 'username'>) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.username;
}

export function MemberGenealogy() {
  const router = useRouter();
  const [tree, setTree] = useState<Tree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (rootUserId?: string) => {
    setLoading(true);
    setError('');
    try {
      const query = rootUserId ? '?rootUserId=' + encodeURIComponent(rootUserId) : '';
      setTree(await apiJson<Tree>('/api/backend/member/genealogy' + query));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        router.replace('/login'); return;
      }
      if (reason instanceof ApiClientError && reason.status === 403 && /password/i.test(reason.message)) {
        router.replace('/member/change-password'); return;
      }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load your genealogy');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const root = tree?.root;
  const direct = tree?.members.filter((member) => member.parentUserId === root?.id) ?? [];
  const directBySlot = new Map(direct.map((member) => [member.slot, member]));
  return <div className="mm-member-shell">
    <MemberHeader />
    <main className="mm-member-main">
      <div className="mm-member-hero">
        <div>
          <p className="mm-eyebrow">My placement team</p>
          <h1 className="mm-title">My Genealogy</h1>
          <p className="mm-subtitle">Explore your own A/B/C/D placement team. A and B are Left; C and D are Right.</p>
          <span className="mm-portal-pill">Binary 1:4 structure • A:C and B:D pairing</span>
        </div>
        <button className="mm-button blue" type="button" disabled={loading} onClick={() => void load(root?.id)}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error ? <div className="mm-error" role="alert">{error}</div> : null}
      {tree && root ? <section className="mm-card" aria-label="My placement genealogy">
        <div className="mm-card-head">
          <h2>Placement Genealogy</h2>
          <span className="mm-chip">{tree.visibleMemberCount} members below selection</span>
        </div>
        <div className="mm-card-body">
          <div className={styles.toolbar}>
            <p>Four direct placement slots • OPEN = empty • FILLED = occupied</p>
            <div className="mm-portal-actions">
              {root.id !== tree.homeRootUserId ? <button className="mm-button light" type="button"
                disabled={loading} onClick={() => void load()}>← My root</button> : null}
              {tree.canGoToParent && root.placementParentUserId ? <button className="mm-button light"
                type="button" disabled={loading} onClick={() => void load(root.placementParentUserId!)}>
                ↑ Placement parent
              </button> : null}
            </div>
          </div>
          <div className={styles.root}>
            <small>SELECTED MEMBER</small>
            <strong>{root.username}</strong>
            <span>{memberName(root)}</span>
            <span>{root.id === tree.homeRootUserId ? 'My placement root' : 'Downline placement member'}</span>
          </div>
          <div className={styles.slotGrid}>
            {SLOTS.map((slot) => {
              const member = directBySlot.get(slot);
              const side = slot === 'A' || slot === 'B' ? 'LEFT' : 'RIGHT';
              return member ? <button key={slot} className={styles.filled} type="button"
                disabled={loading} onClick={() => void load(member.id)}
                aria-label={`View ${member.username} A/B/C/D slots from ${slot}`}>
                <span className={styles.slotTop}><b>{slot}</b><small>{side} • FILLED</small></span>
                <strong>{member.username}</strong>
                <span>{memberName(member)}</span>
                <small>Placement: {member.parentUsername}</small>
                <small>{member.status} • View A/B/C/D slots →</small>
              </button> : <div key={slot} className={styles.empty}>
                <span className={styles.slotTop}><b>{slot}</b><small>{side} • OPEN</small></span>
                <strong>Available position</strong>
                <span>No member placed in this slot</span>
              </div>;
            })}
          </div>
          <h3 className={styles.listTitle}>Members below {root.username} ({tree.visibleMemberCount})</h3>
          {tree.members.length ? <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Level</th><th>Member</th><th>Name</th><th>Placement parent</th><th>Slot</th><th>Side</th><th>First leg</th><th>Status</th></tr></thead>
              <tbody>{tree.members.map((member) => <tr key={member.id}>
                <td>{member.depth}</td>
                <td><button className={styles.memberLink} type="button" disabled={loading} onClick={() => void load(member.id)}>{member.username} →</button></td>
                <td>{memberName(member)}</td>
                <td>{member.parentUsername}</td>
                <td>{member.slot}</td><td>{member.side}</td>
                <td>{member.firstLegSlot} / {member.firstLegSide}</td>
                <td>{member.status}</td>
              </tr>)}</tbody>
            </table>
          </div> : <div className="mm-empty">No members placed below your selected root.</div>}
          <div className="mm-portal-actions">
            <Link className="mm-button light" href="/member">Back to dashboard</Link>
          </div>
        </div>
      </section> : loading ? <div className="mm-card mm-empty">Loading your placement genealogy…</div> : null}
    </main>
  </div>;
}
