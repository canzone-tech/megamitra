'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { apiJson } from '@/lib/client-api';
import styles from './member-search-select.module.css';

type MemberOption = {
  id: string;
  username: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  seasonName?: string | null;
  seasonCode?: string | null;
};

type MemberSearchSelectProps = {
  name: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

function fullName(member: MemberOption) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
}

function memberLabel(member: MemberOption) {
  const name = fullName(member);
  return name ? `${member.username} • ${name}` : member.username;
}

export function MemberSearchSelect({
  name,
  required = false,
  disabled = false,
  placeholder = 'Select existing member — search ID, name, mobile or email',
}: MemberSearchSelectProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MemberOption | null>(null);
  const [results, setResults] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (selected) {
      input.setCustomValidity('');
      return;
    }
    if (query.trim()) {
      input.setCustomValidity('Select an existing member from the search results.');
      return;
    }
    input.setCustomValidity('');
  }, [query, selected]);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const reset = () => {
      setQuery('');
      setSelected(null);
      setResults([]);
      setOpen(false);
      setActiveIndex(-1);
      setSearchError('');
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, []);

  useEffect(() => {
    if (selected || disabled) return;
    const value = query.trim();
    if (value.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSearchError('');
      void apiJson<MemberOption[]>(
        `/api/backend/admin/owner-portal/core/members?q=${encodeURIComponent(value)}`,
        { signal: controller.signal },
      )
        .then((rows) => {
          if (controller.signal.aborted) return;
          setResults(rows.slice(0, 12));
          setOpen(true);
          setActiveIndex(rows.length ? 0 : -1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setOpen(true);
          setActiveIndex(-1);
          setSearchError(error instanceof Error ? error.message : 'Member search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, query, selected]);

  function choose(member: MemberOption) {
    setSelected(member);
    setQuery(memberLabel(member));
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setSearchError('');
    inputRef.current?.setCustomValidity('');
  }

  function clear() {
    setSelected(null);
    setQuery('');
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setSearchError('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className={styles.root}>
      <input type="hidden" name={name} value={selected?.id ?? ''} />
      <div className={styles.control}>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          required={required}
          disabled={disabled}
          autoComplete="off"
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          onChange={(event) => {
            const value = event.target.value;
            setSelected(null);
            setQuery(value);
            setSearchError('');
            if (value.trim().length < 2) {
              setResults([]);
              setActiveIndex(-1);
              setOpen(false);
            } else {
              setOpen(true);
            }
          }}
          onFocus={() => {
            if (selected) return;
            if (query.trim().length >= 2) {
              setOpen(true);
              return;
            }
            if (!query.trim() && !results.length && !loading) {
              setLoading(true);
              setSearchError('');
              void apiJson<MemberOption[]>('/api/backend/admin/owner-portal/core/members')
                .then((rows) => {
                  setResults(rows.slice(0, 12));
                  setOpen(true);
                  setActiveIndex(rows.length ? 0 : -1);
                })
                .catch((error: unknown) => {
                  setResults([]);
                  setOpen(true);
                  setActiveIndex(-1);
                  setSearchError(error instanceof Error ? error.message : 'Member search failed');
                })
                .finally(() => setLoading(false));
              return;
            }
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (!open || !results.length) {
              if (event.key === 'Escape') setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(results.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              choose(results[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {selected ? (
          <button type="button" className={styles.clear} onClick={clear} disabled={disabled} aria-label="Clear selected member">
            ×
          </button>
        ) : null}
      </div>

      {selected ? (
        <div className={styles.selected}>
          Selected: <b>{selected.username}</b>
          {fullName(selected) ? ` • ${fullName(selected)}` : ''}
          {selected.phone ? ` • ${selected.phone}` : ''}
          {selected.email ? ` • ${selected.email}` : ''}
        </div>
      ) : null}

      {open ? (
        <div className={styles.menu} id={listId} role="listbox">
          {loading ? <div className={styles.message}>Searching members…</div> : null}
          {!loading && searchError ? <div className={styles.error}>{searchError}</div> : null}
          {!loading && !searchError && !results.length ? (
            <div className={styles.message}>No matching existing member found.</div>
          ) : null}
          {!loading && !searchError
            ? results.map((member, index) => (
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? `${styles.option} ${styles.active}` : styles.option}
                  key={member.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(member)}
                >
                  <span className={styles.primary}>
                    <b>{member.username}</b>
                    {fullName(member) ? <span> • {fullName(member)}</span> : null}
                  </span>
                  <span className={styles.secondary}>
                    {[member.phone, member.email, member.seasonCode || member.seasonName, member.status]
                      .filter(Boolean)
                      .join(' • ')}
                  </span>
                </button>
              ))
            : null}
        </div>
      ) : null}

      {!selected && query.trim().length === 1 ? (
        <div className={styles.hint}>Type at least 2 characters to search existing members.</div>
      ) : null}
    </div>
  );
}
