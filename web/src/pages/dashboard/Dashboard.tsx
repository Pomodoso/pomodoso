import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from '@pomodoso/api';
import { supabase } from '../../lib/supabase.ts';
import { useAuth } from '../../lib/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import { Sidebar } from '../../components/Sidebar.tsx';
import { useCrisp } from '../../lib/useCrisp.ts';
import TodayPage from './TodayPage.tsx';

const ACTIVE_WS_KEY = 'pomodoso:active_ws';

interface WorkspaceInfo {
  id: string;
  name: string;
  color: string;
}

export default function Dashboard() {
  const { session, user, entitlements } = useAuth();
  useCrisp({ email: user?.email ?? session?.user.email, name: session?.user.user_metadata?.full_name as string | undefined });
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [wsLoaded, setWsLoaded] = useState(false);
  const [activeWsId, setActiveWsId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_WS_KEY),
  );
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const wsMenuRef = useRef<HTMLDivElement>(null);

  const handleSetActiveWs = (id: string | null) => {
    setActiveWsId(id);
    if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
    else localStorage.removeItem(ACTIVE_WS_KEY);
  };

  const refreshWorkspaces = () => {
    if (!session) return;
    api
      .get<WorkspaceInfo[]>('/workspaces')
      .then((ws) => {
        setWorkspaces(ws);
        setWsLoaded(true);
        // If the current active workspace was deleted, fall back to the first one
        setActiveWsId(prev => {
          let next: string | null;
          if (ws.length === 0) next = null;
          else if (prev === 'all' && ws.length > 1) next = prev;
          else if (prev && prev !== 'all' && ws.some(w => w.id === prev)) next = prev;
          else next = ws[0].id;
          if (next) localStorage.setItem(ACTIVE_WS_KEY, next);
          else localStorage.removeItem(ACTIVE_WS_KEY);
          return next;
        });
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (!session) return;
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

  const ALL_WS: WorkspaceInfo = { id: 'all', name: 'All workspaces', color: 'var(--accent)' };
  const switcherOptions = workspaces.length > 1 ? [ALL_WS, ...workspaces] : workspaces;
  const activeWs = activeWsId === 'all' ? ALL_WS : workspaces.find(w => w.id === activeWsId);
  const userEmail = user?.email ?? session?.user.email ?? '';
  const userName = user?.name ?? userEmail;
  const isPro = entitlements.features.dashboard;

  const switcher = activeWs && (
    <div ref={wsMenuRef} style={{ position: 'relative' }}>
      <div
        className="pomo-ws-switcher"
        onClick={() => setWsMenuOpen(o => !o)}
        style={{ cursor: switcherOptions.length > 1 ? 'pointer' : 'default' }}
      >
        <span
          className="pomo-ws-dot"
          style={{ background: activeWs.color ?? 'var(--accent)' }}
        >
          {activeWs.id === 'all' ? <i className="ti ti-stack-2" style={{ fontSize: 11 }} /> : activeWs.name[0]?.toUpperCase()}
        </span>
        <span style={{ flex: 1, fontWeight: 500 }}>{activeWs.name}</span>
        {switcherOptions.length > 1 && (
          <i
            className={`ti ti-chevron-${wsMenuOpen ? 'up' : 'down'}`}
            style={{ fontSize: 12, color: 'var(--text-tert)' }}
          />
        )}
      </div>

      {wsMenuOpen && switcherOptions.length > 1 && (
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
          {switcherOptions.map(ws => (
            <div
              key={ws.id}
              onClick={() => { handleSetActiveWs(ws.id); setWsMenuOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                cursor: 'pointer',
                background: ws.id === activeWsId ? 'var(--bg-darker)' : 'transparent',
                fontSize: 13,
                color: 'var(--text)',
                borderBottom: ws.id === 'all' ? '1px solid var(--border)' : 'none',
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
                {ws.id === 'all' ? <i className="ti ti-stack-2" style={{ fontSize: 11 }} /> : ws.name[0]?.toUpperCase()}
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
  );

  return (
    <div className="pomo-app">
      <Sidebar
        active="today"
        switcher={switcher}
        userName={userName}
        userEmail={userEmail}
        isPro={isPro}
        onSignOut={() => void handleSignOut()}
      />

      {/* ── Main content ────────────────────────────────────────────────────────── */}
      <main className="pomo-main">
        {activeWsId ? (
          <TodayPage workspaceId={activeWsId} />
        ) : wsLoaded ? (
          <div style={{ padding: '80px 36px', maxWidth: 460 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🍅</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              No data synced yet
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.6, marginBottom: 16 }}>
              Your dashboard fills up automatically as the extension syncs.
              Open the Pomodoso extension, sign in with this same account, and your
              tasks, pomodoros and habits will appear here.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-tert)', lineHeight: 1.6 }}>
              Already signed in? Open the extension menu and hit <b>Sync now</b>.
            </p>
          </div>
        ) : (
          <div style={{ padding: '60px 0', color: 'var(--text-tert)', fontSize: 13 }}>
            Loading workspace…
          </div>
        )}
      </main>
    </div>
  );
}
