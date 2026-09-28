'use client';

import type { ReactNode } from 'react';
import { OwnerCorePortal, type OwnerCoreSection } from './owner-core-portal';
import styles from './owner-core-legacy-content.module.css';

/**
 * Transitional content adapter for the season/draw workflows that still live in
 * OwnerCorePortal. The legacy component's own navigation chrome is suppressed
 * so every active owner-management route uses the shared Binary 1:4 shell.
 */
export function OwnerCoreLegacyContent({
  section,
  extension,
}: {
  section: OwnerCoreSection;
  extension?: ReactNode;
}) {
  return (
    <div className={styles.contentOnly}>
      <OwnerCorePortal section={section} extension={extension} />
    </div>
  );
}
