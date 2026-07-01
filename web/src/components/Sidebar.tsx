import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

function initials(str: string): string {
  return str
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('');
}

export interface SidebarProps {
  active: 'today' | 'tasks' | 'billing';
  switcher?: ReactNode;
  userName: string;
  userEmail: string;
  isPro: boolean;
  onSignOut: () => void;
}

export function Sidebar({ active, switcher, userName, userEmail, isPro, onSignOut }: SidebarProps) {
  const userInitials = initials(userName || userEmail);

  return (
    <aside className="pomo-sidebar">
      {/* Brand */}
      <Link to="/dashboard" className="pomo-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="pomo-brand-logo">
          <i className="ti ti-tomato" />
        </div>
        Pomodoso
      </Link>

      {switcher}

      {/* Workspace section */}
      <div className="pomo-nav-section">Workspace</div>
      <Link className={`pomo-nav-item ${active === 'today' ? 'active' : ''}`} to="/dashboard">
        <i className="ti ti-layout-dashboard" /> Today
      </Link>
      <Link className={`pomo-nav-item ${active === 'tasks' ? 'active' : ''}`} to="/dashboard/tasks">
        <i className="ti ti-list-check" /> Tasks
      </Link>
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
      <Link className={`pomo-nav-item ${active === 'billing' ? 'active' : ''}`} to="/settings/billing">
        <i className="ti ti-credit-card" /> Plan &amp; devices
      </Link>

      {/* User footer */}
      <div className="pomo-sidebar-footer">
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
            onClick={onSignOut}
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
  );
}
