'use client';

import { useState, type ComponentProps } from 'react';

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: string;
};

function VisibilityIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3 21 21" />
      <path d="M10.6 5.6A10.3 10.3 0 0 1 12 5.5c6.2 0 10 6.5 10 6.5a15.9 15.9 0 0 1-4 4.5" />
      <path d="M6.3 6.3C3.6 8.2 2 12 2 12s3.8 6.5 10 6.5c1.4 0 2.7-.3 3.9-.8" />
      <path d="M10 10a2.8 2.8 0 0 0 4 4" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PasswordInput({ label, className = 'mm-input', disabled, ...inputProps }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="mm-password-field">
      <input
        {...inputProps}
        className={`${className} mm-password-field-input`}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        aria-label={inputProps['aria-label'] ?? (inputProps.id ? undefined : label)}
      />
      <button
        type="button"
        className="mm-password-toggle"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
        title={`${visible ? 'Hide' : 'Show'} ${label}`}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((shown) => !shown)}
      >
        <VisibilityIcon visible={visible} />
      </button>
    </span>
  );
}

/** One-time credentials must also be masked until the user intentionally reveals them. */
export function PasswordValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="mm-password-value">
      <b>{visible ? value : '••••••••'}</b>
      <button
        type="button"
        className="mm-password-value-toggle"
        aria-label={visible ? 'Hide generated password' : 'Show generated password'}
        title={visible ? 'Hide generated password' : 'Show generated password'}
        aria-pressed={visible}
        onClick={() => setVisible((shown) => !shown)}
      >
        <VisibilityIcon visible={visible} />
      </button>
    </span>
  );
}
