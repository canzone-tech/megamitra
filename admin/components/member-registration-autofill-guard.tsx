'use client';

import { useLayoutEffect } from 'react';

/**
 * Prevents the browser/password manager from copying the signed-in SuperAdmin
 * credentials into the owner-side Create Member form and applies the required
 * single-use E-PIN presentation contract to the uncontrolled registration form.
 *
 * Browser credential autofill can ignore autocomplete="off" on account-creation
 * forms, so this guard applies the account-creation hints before the operator
 * interacts with the form and clears only the initial autofilled values.
 */
export function MemberRegistrationAutofillGuard() {
  useLayoutEffect(() => {
    const username = document.querySelector<HTMLInputElement>('input[name="username"]');
    const password = document.querySelector<HTMLInputElement>('input[name="password"]');
    const epin = document.querySelector<HTMLInputElement>('input[name="epin"]');
    const form = username?.closest('form');

    if (!username || !password || !epin || !form) return;

    form.setAttribute('autocomplete', 'off');
    username.setAttribute('autocomplete', 'off');
    username.setAttribute('autocapitalize', 'none');
    username.setAttribute('spellcheck', 'false');
    username.setAttribute('data-lpignore', 'true');
    username.setAttribute('data-1p-ignore', 'true');
    password.setAttribute('autocomplete', 'new-password');
    password.setAttribute('data-lpignore', 'true');
    password.setAttribute('data-1p-ignore', 'true');
    epin.required = true;
    epin.setAttribute('aria-required', 'true');
    epin.placeholder = 'Required E-PIN';

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
