'use client';

import { useLayoutEffect } from 'react';

/**
 * Prevents the browser/password manager from copying the signed-in SuperAdmin
 * credentials into the owner-side Create Member form.
 *
 * The member form is intentionally uncontrolled because its required fields are
 * driven by the live registration policy. Browser credential autofill can still
 * ignore autocomplete="off" on account-creation forms, so this guard applies
 * the account-creation hints before the operator interacts with the form and
 * clears only the initial autofilled values.
 */
export function MemberRegistrationAutofillGuard() {
  useLayoutEffect(() => {
    const username = document.querySelector<HTMLInputElement>('input[name="username"]');
    const password = document.querySelector<HTMLInputElement>('input[name="password"]');
    const form = username?.closest('form');

    if (!username || !password || !form) return;

    form.setAttribute('autocomplete', 'off');
    username.setAttribute('autocomplete', 'off');
    username.setAttribute('autocapitalize', 'none');
    username.setAttribute('spellcheck', 'false');
    username.setAttribute('data-lpignore', 'true');
    username.setAttribute('data-1p-ignore', 'true');
    password.setAttribute('autocomplete', 'new-password');
    password.setAttribute('data-lpignore', 'true');
    password.setAttribute('data-1p-ignore', 'true');

    const clearInitialCredentialFill = () => {
      if (document.activeElement !== username) username.value = '';
      if (document.activeElement !== password) password.value = '';
    };

    clearInitialCredentialFill();
    const timer = window.setTimeout(clearInitialCredentialFill, 150);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
