import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut } from '@pomodoso/api';
import { supabase } from '../../lib/supabase.ts';
import { useAuth } from '../../lib/AuthContext.tsx';
import type { MeResponse } from '@pomodoso/api';
import { api } from '../../lib/api.ts';
import TodayPage from './TodayPage.tsx';

interface WorkspaceInfo {
  id: string;
  name: string;
  color: string;
}

function initials(str: string): string {
  return str
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('');
}

export default function Dashboard() {
  const { session, entitlements } = useAuth();
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const wsMenuRef = useRef<HTMLDivElement>(null);

  const refreshWorkspaces = () => {
    if (!session) return;
    api
      .get<WorkspaceInfo[]>('/workspaces')
      .then((ws) => {
        setWorkspaces(ws);
        // If the current active workspace was deleted, fall back to the first one
        setActiveWsId(prev => {
          if (ws.length === 0) return null;
          if (prev && ws.some(w => w.id === prev)) return prev;
          return ws[0].id;
        });
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (!session) return;
    api.get<MeResponse>('/me').then(setMe).catch(console.error);
    refreshWorkspaces();

    // Refresh workspace list when the user switches back to this tab
    // (e.g. after deleting workspaces in the extension)
    window.addEventListener('focus', refreshWorkspaces);
    return () => window.removeEventListener('focus', refreshWorkspaces);
  }, [session?.access_token]);

  useEffect(() => {
    if (!wsMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) {
        setWsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [wsMenuOpen]);

  const handleSignOut = async () => {
    await signOut(supabase);
    navigate('/login');
  };

  const activeWs = workspaces.find(w => w.id === activeWsId);
  const userEmail = me?.user.email ?? session?.user.email ?? '';
  const userName = me?.user.name ?? userEmail;
  const userInitials = initials(userName || userEmail);
  const isPro = entitlements.features.dashboard;

  return (
    <div className="pomo-app">
      {/* ── Sidebar ────────────────────────────────────────────────────────────── */}
      <aside className="pomo-sidebar">
        {/* Brand */}
        <div className="pomo-brand">
          <div className="pomo-brand-logo">
            <i className="ti ti-tomato" />
          </div>
          Pomodoso
        </div>

        {/* Workspace switcher */}
        {activeWs && (
          <div ref={wsMenuRef} style={{ position: 'relative' }}>
            <div
              className="pomo-ws-switcher"
              onClick={() => setWsMenuOpen(o => !o)}
              style={{ cursor: workspaces.length > 1 ? 'pointer' : 'default' }}
            >
              <span
                className="pomo-ws-dot"
                style={{ background: activeWs.color ?? 'var(--accent)' }}
              >
                {activeWs.name[0]?.toUpperCase()}
              </span>
              <span style={{ flex: 1, fontWeight: 500 }}>{activeWs.name}</span>
              {workspaces.length > 1 && (
                <i
                  className={`ti ti-chevron-${wsMenuOpen ? 'up' : 'down'}`}
                  style={{ fontSize: 12, color: 'var(--text-tert)' }}
                />
              )}
            </div>

            {wsMenuOpen && workspaces.length > 1 && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                zIndex: 100,
                overflow: 'hidden',
              }}>
                {workspaces.map(ws => (
                  <div
                    key={ws.id}
                    onClick={() => { setActiveWsId(ws.id); setWsMenuOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      background: ws.id === activeWsId ? 'var(--bg-darker)' : 'transparent',
                      fontSize: 13,
                      color: 'var(--text)',
                    }}
                    onMouseEnter={e => { if (ws.id !== activeWsId) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-darker)'; }}
                    onMouseLeave={e => { if (ws.id !== activeWsId) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: ws.color ?? 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
                    }}>
                      {ws.name[0]?.toUpperCase()}
                    </span>
                    <span style={{ flex: 1 }}>{ws.name}</span>
                    {ws.id === activeWsId && (
                      <i className="ti ti-check" style={{ fontSize: 12, color: 'var(--accent)' }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Workspace section */}
        <div className="pomo-nav-section">Workspace</div>
        <a className="pomo-nav-item active" href="/dashboard">
          <i className="ti ti-layout-dashboard" /> Today
        </a>
        <a className="pomo-nav-item disabled" href="/dashboard/reports">
          <i className="ti ti-file-text" /> Reports
          <span className="pomo-soon">Soon</span>
        </a>
        <a className="pomo-nav-item disabled" href="/dashboard/history">
          <i className="ti ti-calendar-stats" /> History
          <span className="pomo-soon">Soon</span>
        </a>

        {/* Settings section */}
        <div className="pomo-nav-section">Settings</div>
        <a className="pomo-nav-item disabled" href="/dashboard/projects">
          <i className="ti ti-folders" /> Projects
          <span className="pomo-soon">Soon</span>
        </a>
        <a className="pomo-nav-item disabled" href="/dashboard/habits">
          <i className="ti ti-checkup-list" /> Habits
          <span className="pomo-soon">Soon</span>
        </a>
        <a className="pomo-nav-item disabled" href="/dashboard/calendar">
          <i className="ti ti-calendar" /> Calendar
          <span className="pomo-soon">Soon</span>
        </a>
        <a className="pomo-nav-item disabled" href="/dashboard/integrations">
          <i className="ti ti-plug" /> Integrations
          <span className="pomo-soon">Soon</span>
        </a>

        {/* User footer */}
        <div className="pomo-sidebar-footer">
          {/* Billing */}
          {!isPro && (
            <Link
              to="/settings/billing"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 10px',
                borderRadius: 6,
                background: 'var(--accent-soft)',
                border: '1px solid rgba(200,85,61,0.2)',
                marginBottom: 6,
                textDecoration: 'none',
                fontSize: 12,
                color: 'var(--accent)',
                fontWeight: 500,
              }}
            >
              <i className="ti ti-sparkles" style={{ fontSize: 14 }} />
              Upgrade to Pro
            </Link>
          )}

          {/* User row */}
          <div className="pomo-user-row">
            <div className="pomo-avatar">{userInitials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 500,
                color: 'var(--text)',
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {userName !== userEmail ? userName : userEmail}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tert)' }}>
                {isPro ? 'Pro' : 'Free plan'}
              </div>
            </div>
            <button
              onClick={() => void handleSignOut()}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-tert)',
                padding: 4,
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
              }}
              title="Sign out"
            >
              <i className="ti ti-logout" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────────────── */}
      <main className="pomo-main">
        {activeWsId ? (
          <TodayPage workspaceId={activeWsId} />
        ) : (
          <div style={{ padding: '60px 0', color: 'var(--text-tert)', fontSize: 13 }}>
            Loading workspace…
          </div>
        )}
      </main>
    </div>
  );
}
