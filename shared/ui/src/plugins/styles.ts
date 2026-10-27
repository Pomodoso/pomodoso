import type { CSSProperties } from 'react';

// Plugin blocks are styled with the same CSS variables as the rest of the app
// (globals.css in each client), so a plugin looks native in light and dark.

export const cardStyle: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
};

export const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
};

export const inputStyle: CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
  color: 'var(--color-text)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export function buttonStyle(kind: 'primary' | 'secondary' | 'ghost'): CSSProperties {
  const base: CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
  };
  if (kind === 'primary') return { ...base, background: 'var(--color-accent)', color: '#fff', border: '1px solid var(--color-accent)' };
  if (kind === 'secondary') return { ...base, background: 'var(--color-accent-soft)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' };
  return { ...base, background: 'none', color: 'var(--color-text-muted)', border: '1px solid transparent', fontWeight: 500 };
}

/** Bars, progress and grid cells without an option color. */
export const NEUTRAL_FILL = 'var(--color-accent)';
export const EMPTY_FILL = 'var(--color-border)';
