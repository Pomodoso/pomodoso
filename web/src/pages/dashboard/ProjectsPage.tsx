import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  end_date: string | null;
}

// Same 6-swatch palette as the extension's workspace color picker
// (SettingsState.tsx's WS_COLORS) — no project-specific palette exists
// elsewhere, and workspace/project colors already share one visual system
// across the product.
const COLORS = ['#C8553D', '#4A6FA5', '#2D8A7A', '#7B5DB4', '#B07A1F', '#2A7A4A'];

// ─── Row ───────────────────────────────────────────────────────────────────────

function ProjectRow({ project, onUpdate, onArchive, onUnarchive, onDelete }: {
  project: Project;
  onUpdate: (id: string, patch: { name?: string; color?: string }) => Promise<void>;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = project.end_date !== null;

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) {
      setEditing(false);
      setName(project.name);
      return;
    }
    void onUpdate(project.id, { name: trimmed }).then(() => setEditing(false));
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0', borderBottom: '1px solid var(--border)',
      opacity: archived ? 0.6 : 1,
    }}>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setEditing(e => !e)}
          title="Change color"
          style={{
            width: 14, height: 14, borderRadius: 4, background: project.color,
            border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
          }}
        />
      </div>

      {editing ? (
        <input
          autoFocus
          className="pomo-input"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') { setName(project.name); setEditing(false); }
          }}
          style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{ flex: 1, fontSize: 13.5, color: 'var(--text)', cursor: 'pointer' }}
        >
          {project.name}
        </span>
      )}

      <div style={{ display: 'flex', gap: 4 }}>
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => void onUpdate(project.id, { color: c })}
            style={{
              width: 16, height: 16, borderRadius: 4, background: c,
              border: c === project.color ? '2px solid var(--text)' : '2px solid transparent',
              cursor: 'pointer', padding: 0,
            }}
          />
        ))}
      </div>

      {archived ? (
        <button className="pomo-btn" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => onUnarchive(project.id)}>
          Unarchive
        </button>
      ) : (
        <button className="pomo-btn" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => onArchive(project.id)}>
          Archive
        </button>
      )}

      {confirmDelete ? (
        <button
          className="pomo-btn"
          style={{ fontSize: 11, padding: '4px 8px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
          onClick={() => onDelete(project.id)}
          onBlur={() => setConfirmDelete(false)}
          autoFocus
        >
          Confirm delete
        </button>
      ) : (
        <button
          className="pomo-btn pomo-btn-icon"
          aria-label="Delete project"
          onClick={() => setConfirmDelete(true)}
        >
          <i className="ti ti-trash" />
        </button>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ProjectsPage({ workspaceId }: { workspaceId: string }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = () => {
    if (!workspaceId || workspaceId === 'all') return;
    setLoading(true);
    setError(null);
    api
      .get<Project[]>(`/projects?workspace_id=${workspaceId}`)
      .then(setProjects)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [workspaceId]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || workspaceId === 'all') return;
    setCreating(true);
    try {
      const project = await api.post<Project>('/projects', {
        workspace_id: workspaceId,
        name: trimmed,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
      setProjects(prev => [...(prev ?? []), project]);
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string, patch: { name?: string; color?: string }) => {
    const updated = await api.patch<Project>(`/projects/${id}`, patch);
    setProjects(prev => (prev ?? []).map(p => (p.id === id ? updated : p)));
  };

  const handleArchive = (id: string) => {
    api.post<Project>(`/projects/${id}/archive`).then(updated => {
      setProjects(prev => (prev ?? []).map(p => (p.id === id ? updated : p)));
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to archive'));
  };

  const handleUnarchive = (id: string) => {
    api.post<Project>(`/projects/${id}/unarchive`).then(updated => {
      setProjects(prev => (prev ?? []).map(p => (p.id === id ? updated : p)));
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to unarchive'));
  };

  const handleDelete = (id: string) => {
    api.del(`/projects/${id}`).then(() => {
      setProjects(prev => (prev ?? []).filter(p => p.id !== id));
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to delete'));
  };

  if (workspaceId === 'all') {
    return (
      <div style={{ padding: '60px 36px', color: 'var(--text-tert)', fontSize: 13 }}>
        Pick a specific workspace to manage its projects.
      </div>
    );
  }

  const active = (projects ?? []).filter(p => p.end_date === null);
  const archived = (projects ?? []).filter(p => p.end_date !== null);

  return (
    <>
      <div className="pomo-page-header">
        <div>
          <div className="pomo-eyebrow">Settings</div>
          <h1 className="pomo-page-title">Projects</h1>
        </div>
      </div>

      {error && <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="pomo-card" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="pomo-input"
            placeholder="New project name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleCreate()}
            style={{ flex: 1 }}
          />
          <button className="pomo-btn pomo-btn-primary" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
            <i className="ti ti-plus" /> Add
          </button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-tert)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
        ) : active.length === 0 ? (
          <div className="pomo-empty">
            <i className="ti ti-folders" />
            No projects yet.
          </div>
        ) : (
          active.map(p => (
            <ProjectRow key={p.id} project={p} onUpdate={handleUpdate} onArchive={handleArchive} onUnarchive={handleUnarchive} onDelete={handleDelete} />
          ))
        )}

        {archived.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="pomo-link-btn" onClick={() => setShowArchived(s => !s)}>
              {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
            </button>
            {showArchived && archived.map(p => (
              <ProjectRow key={p.id} project={p} onUpdate={handleUpdate} onArchive={handleArchive} onUnarchive={handleUnarchive} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
