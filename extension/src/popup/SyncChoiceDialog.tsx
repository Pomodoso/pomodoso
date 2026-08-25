import { useEffect, useState } from 'react';

import { resolveSyncChoiceAndSync } from '../syncEngine';
import { getPendingSyncChoice, subscribeSyncChoice, type SyncChoice } from '../syncChoice';

// Asked once per (account, backend), the first time an account signs in on a
// profile that already has data of its own. See syncChoice.ts for why the
// silent merge that used to happen here is the wrong default.

export function SyncChoiceDialog() {
  // Seeded from the current value rather than null: the popup's open-sync can
  // publish a pending scope before this mounts.
  const [scope, setScope] = useState<string | null>(getPendingSyncChoice);
  const [busy, setBusy] = useState<SyncChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeSyncChoice(setScope), []);

  async function choose(choice: SyncChoice) {
    if (busy || !scope) return;
    setBusy(choice);
    setError(null);
    try {
      await resolveSyncChoiceAndSync(scope, choice);
    } catch (err) {
      // The choice is recorded before the sync runs, so a failure here is a
      // failed first sync, not an unanswered question — the automatic
      // triggers will retry.
      setError(err instanceof Error ? err.message : 'Sync failed — it will retry automatically.');
    } finally {
      setBusy(null);
    }
  }

  if (scope === null) return null;

  return (
    // No backdrop click and no close button: every path out is a decision.
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(26,26,23,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
    }}>
      <div style={{
        width: '100%', background: 'var(--color-surface)',
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
        padding: 14,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
          This browser already has data
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 12 }}>
          You signed in on a profile that already has tasks and habits in it. Choose what happens to them.
        </div>

        <Option
          title="Combine them"
          hint="Keep what's here and add it to your account. Right if this browser was already yours."
          busy={busy === 'merge'}
          disabled={busy !== null}
          onClick={() => void choose('merge')}
        />
        <Option
          title="Use my account only"
          hint="Deletes what's in this browser and downloads your account. Nothing here is uploaded."
          warn
          busy={busy === 'cloud'}
          disabled={busy !== null}
          onClick={() => void choose('cloud')}
        />

        {error && (
          <div style={{ fontSize: 10, color: 'var(--color-danger, #C8553D)', marginTop: 8 }}>{error}</div>
        )}
      </div>
    </div>
  );
}

function Option({ title, hint, warn, busy, disabled, onClick }: {
  title: string; hint: string; warn?: boolean; busy: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block', width: '100%', textAlign: 'left', marginTop: 8, padding: 10,
        background: busy ? 'var(--color-accent-soft)' : 'transparent',
        border: `1px solid ${busy ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !busy ? 0.5 : 1,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
        {title}{busy ? '…' : ''}
      </div>
      <div style={{
        fontSize: 10, lineHeight: 1.45, marginTop: 2,
        color: warn ? 'var(--color-accent)' : 'var(--color-text-muted)',
      }}>
        {hint}
      </div>
    </button>
  );
}
