import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  name: string;
  color: string;
  archived_at: string | null;
}

// Same 6-swatch palette as the extension's workspace color picker
// (SettingsState.tsx's WS_COLORS), reused for Projects too.
const COLORS = ['#C8553D', '#4A6FA5', '#2D8A7A', '#7B5DB4', '#B07A1F', '#2A7A4A'];

// ─── Row ───────────────────────────────────────────────────────────────────────

function WorkspaceRow({ workspace, onUpdate, onArchive, onUnarchive, onDelete, deleteError }: {
  workspace: Workspace;
  onUpdate: (id: string, patch: { name?: string; color?: string }) => Promise<void>;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  deleteError: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = workspace.archived_at !== null;

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === workspace.name) {
      setEditing(false);
      setName(workspace.name);
      return;
    }
    void onUpdate(workspace.id, { name: trimmed }).then(() => setEditing(false));
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0', borderBottom: '1px solid var(--border)',
      opacity: archived ? 0.6 : 1,
    }}>
      <span
        style={{
          width: 20, height: 20, borderRadius: 5, background: workspace.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}
      >
        {workspace.name[0]?.toUpperCase()}
      </span>

      {editing ? (
        <input
          autoFocus
          className="pomo-input"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') { setName(workspace.name); setEditing(false); }
          }}
          style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{ flex: 1, fontSize: 13.5, color: 'var(--text)', cursor: 'pointer' }}
        >
          {workspace.name}
        </span>
      )}

      <div style={{ display: 'flex', gap: 4 }}>
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => void onUpdate(workspace.id, { color: c })}
            aria-label={`Set color ${c}`}
            style={{
              width: 16, height: 16, borderRadius: 4, background: c,
              border: c === workspace.color ? '2px solid var(--text)' : '2px solid transparent',
              cursor: 'pointer', padding: 0,
            }}
          />
        ))}
      </div>

      {archived ? (
        <button className="pomo-btn" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => onUnarchive(workspace.id)}>
          Unarchive
        </button>
      ) : (
        <button className="pomo-btn" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => onArchive(workspace.id)}>
          Archive
        </button>
      )}

      {confirmDelete ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {deleteError && <span style={{ fontSize: 11, color: 'var(--accent)' }}>{deleteError}</span>}
          <button
            className="pomo-btn"
            style={{ fontSize: 11, padding: '4px 8px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
            onClick={() => onDelete(workspace.id)}
            onBlur={() => setConfirmDelete(false)}
            autoFocus
          >
            Confirm delete
          </button>
        </div>
      ) : (
        <button
          className="pomo-btn pomo-btn-icon"
          aria-label="Delete workspace"
          onClick={() => setConfirmDelete(true)}
        >
          <i className="ti ti-trash" />
        </button>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspacesPage({ onChanged }: { onChanged: () => void }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<{ id: string; message: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = () => {
    setLoading(true);
    setError(null);
    api
      .get<Workspace[]>('/workspaces?include_archived=true')
      .then(setWorkspaces)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleUpdate = async (id: string, patch: { name?: string; color?: string }) => {
    const updated = await api.patch<Workspace>(`/workspaces/${id}`, patch);
    setWorkspaces(prev => (prev ?? []).map(w => (w.id === id ? updated : w)));
    onChanged();
  };

  const handleArchive = (id: string) => {
    api.post<Workspace>(`/workspaces/${id}/archive`).then(updated => {
      setWorkspaces(prev => (prev ?? []).map(w => (w.id === id ? updated : w)));
      onChanged();
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to archive'));
  };

  const handleUnarchive = (id: string) => {
    api.post<Workspace>(`/workspaces/${id}/unarchive`).then(updated => {
      setWorkspaces(prev => (prev ?? []).map(w => (w.id === id ? updated : w)));
      onChanged();
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to unarchive'));
  };

  const handleDelete = (id: string) => {
    setDeleteErrorId(null);
    api.del(`/workspaces/${id}`).then(() => {
      setWorkspaces(prev => (prev ?? []).filter(w => w.id !== id));
      onChanged();
    }).catch((e: unknown) => {
      setDeleteErrorId({ id, message: e instanceof Error ? e.message : 'Failed to delete' });
    });
  };

  const active = (workspaces ?? []).filter(w => w.archived_at === null);
  const archived = (workspaces ?? []).filter(w => w.archived_at !== null);

  return (
    <>
      <div className="pomo-page-header">
        <div>
          <div className="pomo-eyebrow">Settings</div>
          <h1 className="pomo-page-title">Workspaces</h1>
        </div>
      </div>

      {error && <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="pomo-card" style={{ maxWidth: 560 }}>
        {loading ? (
          <div style={{ color: 'var(--text-tert)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
        ) : active.length === 0 ? (
          <div className="pomo-empty">
            <i className="ti ti-stack-2" />
            No active workspaces.
          </div>
        ) : (
          active.map(w => (
            <WorkspaceRow
              key={w.id}
              workspace={w}
              onUpdate={handleUpdate}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onDelete={handleDelete}
              deleteError={deleteErrorId?.id === w.id ? deleteErrorId.message : null}
            />
          ))
        )}

        {archived.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="pomo-link-btn" onClick={() => setShowArchived(s => !s)}>
              {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
            </button>
            {showArchived && archived.map(w => (
              <WorkspaceRow
                key={w.id}
                workspace={w}
                onUpdate={handleUpdate}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
                onDelete={handleDelete}
                deleteError={deleteErrorId?.id === w.id ? deleteErrorId.message : null}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
