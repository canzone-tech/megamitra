'use client';

import styles from './action-feedback.module.css';

type ActionFeedbackProps = {
  error?: string;
  notice?: string;
  onDismissError?: () => void;
  onDismissNotice?: () => void;
};

/** Keep action results visible at any scroll position, without changing API outcomes. */
export function ActionFeedback({ error = '', notice = '', onDismissError, onDismissNotice }: ActionFeedbackProps) {
  if (!error && !notice) return null;

  const failed = Boolean(error);
  return (
    <div
      className={`${styles.toast} ${failed ? styles.failure : styles.success}`}
      role={failed ? 'alert' : 'status'}
      aria-atomic="true"
      data-testid="action-feedback"
    >
      <span className={styles.symbol} aria-hidden="true">{failed ? '!' : '✓'}</span>
      <div className={styles.content}>
        <strong>{failed ? 'Error' : 'Success'}</strong>
        <p>{failed ? error : notice}</p>
      </div>
      <button
        className={styles.dismiss}
        type="button"
        aria-label="Dismiss notification"
        onClick={failed ? onDismissError : onDismissNotice}
      >×</button>
    </div>
  );
}
