import { useState, useEffect } from 'react';
import type React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DetectionRule, SoundSettings, SoundEvent, Entitlements } from '@pomodoso/types';
import { playSound } from '../sounds';
import type { TimerSettings } from './App';
import {
  disconnectCalendar,
  syncTodayMeetings,
  updateSelectedCalendars,
  type CalendarConnection,
  type CalendarInfo,
} from '../calendarSync';
import type { ExtensionResponse } from '@pomodoso/types';
import { db } from '../db';
import { exportDb, importDb } from '../backup';
import type { AuthState } from './useAuth';


const PRESET_CATALOG = [
  { id: 'linear',  name: 'Linear',  icon: '◆', urlPattern: 'linear\\.app\\/[^/]+\\/issue\\/',                description: 'Issues on linear.app' },
  { id: 'github',  name: 'GitHub',  icon: '⊙', urlPattern: 'github\\.com\\/[^/]+\\/[^/]+\\/(pull|issues)\\/', description: 'PRs and issues on GitHub' },
  { id: 'gmail',   name: 'Gmail',   icon: '✉', urlPattern: 'mail\\.google\\.com\\/mail',                      description: 'Email threads in Gmail' },
  { id: 'notion',  name: 'Notion',  icon: '◻', urlPattern: 'notion\\.so\\/',                                  description: 'Pages in Notion' },
  { id: 'jira',    name: 'Jira',    icon: '◈', urlPattern: '\\.atlassian\\.net\\/browse\\/',                  description: 'Issues in Jira' },
  { id: 'figma',   name: 'Figma',   icon: '⬡', urlPattern: 'figma\\.com\\/(file|design)\\/',                  description: 'Files in Figma' },
  { id: 'clickup', name: 'ClickUp', icon: '⬆', urlPattern: 'app\\.clickup\\.com\\/',                          description: 'Tasks in ClickUp' },
  { id: 'arxiv',   name: 'arXiv',  icon: '∂', urlPattern: 'arxiv\\.org\\/abs\\/',                             description: 'Papers on arxiv.org' },
];

type SettingsPage = 'main' | 'task-detection' | 'timer-defaults' | 'workspaces' | 'sounds' | 'general' | 'calendar' | 'data' | 'account';

interface Workspace {
  id: string;
  name: string;
  color: string;
}

interface SettingsStateProps {
  rules: DetectionRule[];
  timerSettings: TimerSettings;
  workspaces: Workspace[];
  soundSettings: SoundSettings;
  timezone: string;
  maxPriorities: number;
  activeWsId: string;
  initialPage?: SettingsPage;
  entitlements: Entitlements;
  auth: AuthState;
  onSyncNow?: () => void;
  onBack: () => void;
  onAddRule: (rule: DetectionRule) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onUpdateRule: (id: string, name: string, urlPattern: string) => void;
  onUpdateTimerSettings: (updates: Partial<TimerSettings>) => void;
  onAddWorkspace: (name: string, color: string) => void;
  onUpdateWorkspace: (id: string, name: string, color: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onUpdateSoundSettings: (updates: Partial<SoundSettings>) => void;
  onUpdateTimezone: (tz: string) => void;
  onUpdateMaxPriorities: (n: number) => void;
  weekStart: number;
  workDays: number[];
  onUpdateWeekStart: (day: number) => void;
  onUpdateWorkDays: (days: number[]) => void;
}

export function SettingsState({ rules, timerSettings, workspaces, soundSettings, timezone, maxPriorities, weekStart, workDays, activeWsId, initialPage, entitlements, auth, onSyncNow, onBack, onAddRule, onToggleRule, onDeleteRule, onUpdateRule, onUpdateTimerSettings, onAddWorkspace, onUpdateWorkspace, onDeleteWorkspace, onUpdateSoundSettings, onUpdateTimezone, onUpdateMaxPriorities, onUpdateWeekStart, onUpdateWorkDays }: SettingsStateProps) {
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'main');

  if (page === 'account') {
    return <AccountPage auth={auth} entitlements={entitlements} onSyncNow={onSyncNow} onBack={() => setPage('main')} />;
  }

  if (page === 'calendar') {
    return <CalendarPage workspaces={workspaces} activeWsId={activeWsId} timezone={timezone} onBack={() => setPage('main')} />;
  }

  if (page === 'task-detection') {
    return (
      <TaskDetectionPage
        rules={rules}
        onBack={() => setPage('main')}
        onAddRule={onAddRule}
        onToggleRule={onToggleRule}
        onDeleteRule={onDeleteRule}
        onUpdateRule={onUpdateRule}
      />
    );
  }

  if (page === 'timer-defaults') {
    return <TimerDefaultsPage timerSettings={timerSettings} onUpdateTimerSettings={onUpdateTimerSettings} onBack={() => setPage('main')} />;
  }

  if (page === 'workspaces') {
    return (
      <WorkspacesPage
        workspaces={workspaces}
        canAddWorkspace={entitlements.features.multi_workspace || workspaces.length < 1}
        onAdd={onAddWorkspace}
        onUpdate={onUpdateWorkspace}
        onDelete={onDeleteWorkspace}
        onBack={() => setPage('main')}
      />
    );
  }

  if (page === 'sounds') {
    return <SoundsPage settings={soundSettings} onUpdate={onUpdateSoundSettings} onBack={() => setPage('main')} />;
  }

  if (page === 'general') {
    return <GeneralPage timezone={timezone} maxPriorities={maxPriorities} weekStart={weekStart} workDays={workDays} onUpdateTimezone={onUpdateTimezone} onUpdateMaxPriorities={onUpdateMaxPriorities} onUpdateWeekStart={onUpdateWeekStart} onUpdateWorkDays={onUpdateWorkDays} onBack={() => setPage('main')} />;
  }

  if (page === 'data') {
    return <DataPage onBack={() => setPage('main')} />;
  }

  const isPro = entitlements.features.sync;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Settings" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '10px 14px' }}>
          {/* Account row — always visible */}
          <NavGroup>
            <NavRow
              icon="◍"
              title="Account & Sync"
              description={auth.session ? (isPro ? 'Pro · syncing' : 'Free · upgrade for sync') : 'Sign in to sync across devices'}
              onClick={() => setPage('account')}
            />
          </NavGroup>
          <NavGroup>
            <NavRow
              icon="◎"
              title="Task detection"
              description={`${rules.filter(r => r.active).length} active rule${rules.filter(r => r.active).length !== 1 ? 's' : ''}`}
              onClick={() => setPage('task-detection')}
            />
            <NavRow
              icon="⏱"
              title="Timer defaults"
              description="Pomodoro duration and modes"
              onClick={() => setPage('timer-defaults')}
            />
            <NavRow
              icon="◫"
              title="Calendar"
              description="Google Calendar connection"
              onClick={() => setPage('calendar')}
            />
            <NavRow
              icon="◉"
              title="Workspaces"
              description={`${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`}
              onClick={() => setPage('workspaces')}
            />
            <NavRow
              icon="♪"
              title="Sounds"
              description={soundSettings.enabled ? `On · ${Math.round(soundSettings.volume * 100)}% volume` : 'Off'}
              onClick={() => setPage('sounds')}
            />
            <NavRow
              icon="⚙"
              title="General"
              description={`${timezone} · max ${maxPriorities} priorities`}
              onClick={() => setPage('general')}
            />
            <NavRow
              icon="⇅"
              title="Data"
              description="Export or import all your data"
              onClick={() => setPage('data')}
            />
          </NavGroup>
        </div>
      </div>
    </div>
  );
}

// ── General sub-page ──────────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function GeneralPage({ timezone, maxPriorities, weekStart, workDays, onUpdateTimezone, onUpdateMaxPriorities, onUpdateWeekStart, onUpdateWorkDays, onBack }: {
  timezone: string;
  maxPriorities: number;
  weekStart: number;
  workDays: number[];
  onUpdateTimezone: (tz: string) => void;
  onUpdateMaxPriorities: (n: number) => void;
  onUpdateWeekStart: (day: number) => void;
  onUpdateWorkDays: (days: number[]) => void;
  onBack: () => void;
}) {
  const [tzInput, setTzInput] = useState(timezone);
  const [tzError, setTzError] = useState(false);
  useEffect(() => { setTzInput(timezone); setTzError(false); }, [timezone]);

  const allTimezones: string[] = typeof Intl.supportedValuesOf !== 'undefined'
    ? Intl.supportedValuesOf('timeZone')
    : [];

  const handleTzBlur = () => {
    const trimmed = tzInput.trim();
    if (!trimmed) { setTzInput(timezone); setTzError(false); return; }
    const valid = allTimezones.length === 0 || allTimezones.includes(trimmed);
    if (!valid) { setTzError(true); return; }
    setTzError(false);
    if (trimmed !== timezone) onUpdateTimezone(trimmed);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="General" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>Timezone</div>
            <datalist id="tz-list">
              {allTimezones.map(tz => <option key={tz} value={tz} />)}
            </datalist>
            <input
              list="tz-list"
              value={tzInput}
              onChange={e => { setTzInput(e.target.value); setTzError(false); }}
              onBlur={handleTzBlur}
              placeholder="e.g. America/New_York"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '6px 10px',
                background: 'var(--color-surface)',
                border: `1px solid ${tzError ? 'var(--color-accent)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--color-text)',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
            {tzError && (
              <div style={{ fontSize: 11, color: 'var(--color-accent)', marginTop: 4 }}>
                Invalid timezone. Use an IANA name like "America/New_York".
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>
              Defaults to your system timezone.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>Max priority tasks</div>
            <div style={{ display: 'flex', gap: 5 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => onUpdateMaxPriorities(n)}
                  style={{
                    width: 36, height: 36, fontSize: 13, fontWeight: maxPriorities === n ? 700 : 400,
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: 'none',
                    background: maxPriorities === n ? 'var(--color-accent)' : 'var(--color-surface)',
                    color: maxPriorities === n ? '#fff' : 'var(--color-text-muted)',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 6 }}>
              Max tasks shown in Today's priorities. Default is 3.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>Week starts on</div>
            <div style={{ display: 'flex', gap: 5 }}>
              {([0, 6] as const).map(day => (
                <button
                  key={day}
                  onClick={() => onUpdateWeekStart(day)}
                  style={{
                    padding: '5px 14px', fontSize: 12, fontWeight: weekStart === day ? 600 : 400,
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    border: `1px solid ${weekStart === day ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: weekStart === day ? 'var(--color-accent)' : 'var(--color-surface)',
                    color: weekStart === day ? '#fff' : 'var(--color-text-muted)',
                  }}
                >
                  {day === 0 ? 'Monday' : 'Sunday'}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 6 }}>
              Used for "this week" in history.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>Work days</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {DAY_LABELS.map((label, i) => {
                const active = workDays.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      const next = active ? workDays.filter(d => d !== i) : [...workDays, i].sort();
                      onUpdateWorkDays(next);
                    }}
                    style={{
                      width: 34, height: 34, fontSize: 11, fontWeight: active ? 600 : 400,
                      borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                      color: active ? '#fff' : 'var(--color-text-muted)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 6 }}>
              Used to filter history to work days only.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Workspaces sub-page ───────────────────────────────────────────────────────

const WS_COLORS = ['#C8553D', '#4A6FA5', '#2D8A7A', '#7B5DB4', '#B07A1F', '#2A7A4A'];

function WorkspacesPage({ workspaces, canAddWorkspace, onAdd, onUpdate, onDelete, onBack }: {
  workspaces: Workspace[];
  canAddWorkspace: boolean;
  onAdd: (name: string, color: string) => void;
  onUpdate: (id: string, name: string, color: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(WS_COLORS[0]!);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), color);
    setName(''); setAdding(false); setColor(WS_COLORS[0]!);
  };

  const startEdit = (ws: Workspace) => {
    setEditingId(ws.id); setEditName(ws.name); setEditColor(ws.color);
    setConfirmDeleteId(null);
  };

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      onUpdate(editingId, editName.trim(), editColor);
    }
    setEditingId(null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Workspaces" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '10px 14px 0' }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Workspaces let you group tasks, habits, and meetings. Switch between them from the header.
          </p>
          {workspaces.map(ws => (
            <div key={ws.id} style={{
              marginBottom: 6,
              background: 'var(--color-surface)', border: `1px solid ${editingId === ws.id ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}>
              {editingId === ws.id ? (
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: 5 }}>
                    {WS_COLORS.map(c => (
                      <button key={c} onClick={() => setEditColor(c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: editColor === c ? '2px solid var(--color-text)' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={saveEdit} style={{ flex: 1, padding: '5px 0', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ padding: '5px 12px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: ws.color, color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {ws.name[0]?.toUpperCase()}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{ws.name}</span>
                  {confirmDeleteId === ws.id ? (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Delete?</span>
                      <button onClick={() => { onDelete(ws.id); setConfirmDeleteId(null); }} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Yes</button>
                      <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '3px 8px', fontSize: 11, background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text-muted)', cursor: 'pointer' }}>No</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(ws)} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-faint)', borderRadius: 4, flexShrink: 0 }} title="Edit">✎</button>
                      <button
                        onClick={() => setConfirmDeleteId(ws.id)}
                        disabled={workspaces.length <= 1}
                        title={workspaces.length <= 1 ? 'Cannot delete the last workspace' : 'Delete workspace'}
                        style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: workspaces.length <= 1 ? 'not-allowed' : 'pointer', fontSize: 16, color: workspaces.length <= 1 ? 'var(--color-border-strong)' : 'var(--color-text-faint)', borderRadius: 4, flexShrink: 0 }}
                      >×</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '6px 14px 14px' }}>
          {adding ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') { setAdding(false); setName(''); }
                }}
                placeholder="Workspace name"
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: 10, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                {WS_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: color === c ? '2px solid var(--color-text)' : '2px solid transparent', cursor: 'pointer', padding: 0 }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleAdd} style={{ flex: 1, padding: '6px 0', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Create</button>
                <button onClick={() => { setAdding(false); setName(''); }} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : canAddWorkspace ? (
            <button onClick={() => setAdding(true)} style={{
              width: '100%', padding: '8px 12px',
              background: 'none', border: '1px dashed var(--color-border-strong)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: 12, fontWeight: 500, color: 'var(--color-accent)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>+</span> New workspace
            </button>
          ) : (
            <div style={{
              width: '100%', padding: '10px 12px', boxSizing: 'border-box',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--color-text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>Multiple workspaces require Pro</span>
              <span style={{ fontSize: 11, color: 'var(--color-accent)', fontWeight: 600 }}>Pro</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Account & Sync sub-page ───────────────────────────────────────────────────

function AccountPage({ auth, entitlements, onSyncNow, onBack }: {
  auth: AuthState;
  entitlements: Entitlements;
  onSyncNow?: () => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | null>(null);

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      await auth.signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'microsoft') => {
    setError('');
    setOauthLoading(provider);
    try {
      if (provider === 'google') {
        await auth.signInWithGoogle();
      } else {
        await auth.signInWithMicrosoft();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setOauthLoading(null);
    }
  };

  const isPro = entitlements.features.sync;
  const btnBase: React.CSSProperties = {
    width: '100%', padding: '8px 0', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600,
    background: 'var(--color-bg)', color: 'var(--color-text)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Account & Sync" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '14px 14px' }}>
          {auth.session ? (
            <>
              <div style={{ padding: '12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Signed in as</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{auth.session.user.email}</div>
                <div style={{ fontSize: 11, color: isPro ? 'var(--color-accent)' : 'var(--color-text-faint)', marginTop: 4, fontWeight: 600 }}>
                  {isPro ? '✓ Pro' : 'Free plan'}
                </div>
              </div>

              {!isPro && (
                <div style={{ padding: '12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>Upgrade to Pro</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
                    Sync across devices · Unlimited workspaces · Web dashboard
                  </div>
                  <a
                    href="https://pomodoso.com/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', padding: '7px 0', background: 'var(--color-accent)', color: '#fff', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                  >
                    Upgrade to Pro →
                  </a>
                </div>
              )}

              {onSyncNow && (
                <button
                  onClick={onSyncNow}
                  style={{ width: '100%', padding: '8px 12px', marginBottom: 8, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 12, color: 'var(--color-text)', fontWeight: 600 }}
                >
                  ↺ Sync now
                </button>
              )}
              <button
                onClick={() => void auth.signOut()}
                style={{ width: '100%', padding: '8px 12px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted)' }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                Sign in to sync your data across devices with Pomodoso Pro.
              </p>

              {/* OAuth buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
                <button
                  onClick={() => void handleOAuth('google')}
                  disabled={oauthLoading !== null || loading}
                  style={{ ...btnBase, opacity: oauthLoading === 'google' ? 0.7 : 1 }}
                >
                  <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  {oauthLoading === 'google' ? 'Signing in…' : 'Continue with Google'}
                </button>
                <button
                  onClick={() => void handleOAuth('microsoft')}
                  disabled={oauthLoading !== null || loading}
                  style={{ ...btnBase, opacity: oauthLoading === 'microsoft' ? 0.7 : 1 }}
                >
                  <svg width="14" height="14" viewBox="0 0 21 21" fill="none">
                    <rect x="0" y="0" width="10" height="10" fill="#F25022"/>
                    <rect x="11" y="0" width="10" height="10" fill="#7FBA00"/>
                    <rect x="0" y="11" width="10" height="10" fill="#00A4EF"/>
                    <rect x="11" y="11" width="10" height="10" fill="#FFB900"/>
                  </svg>
                  {oauthLoading === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
                </button>
              </div>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
              </div>

              {/* Email/password form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleSignIn(); }}
                  style={{ padding: '7px 10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleSignIn(); }}
                  style={{ padding: '7px 10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
                />
                {error && <p style={{ margin: 0, fontSize: 11, color: '#e55' }}>{error}</p>}
                <button
                  onClick={() => void handleSignIn()}
                  disabled={loading || oauthLoading !== null || !email.trim() || !password}
                  style={{ padding: '8px 0', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
              <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'center', lineHeight: 1.5 }}>
                No account?{' '}
                <a href="https://pomodoso.com/login" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>Sign up at pomodoso.com</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Task detection sub-page ───────────────────────────────────────────────────

function TaskDetectionPage({ rules, onBack, onAddRule, onToggleRule, onDeleteRule, onUpdateRule }: {
  rules: DetectionRule[];
  onBack: () => void;
  onAddRule: (rule: DetectionRule) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onUpdateRule: (id: string, name: string, urlPattern: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [showCatalog, setShowCatalog] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPattern, setCustomPattern] = useState('');
  const [patternError, setPatternError] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPattern, setEditPattern] = useState('');
  const [editError, setEditError] = useState('');

  const installedPresetIds = new Set(rules.filter(r => r.kind === 'preset').map(r => r.presetId));
  const filteredCatalog = PRESET_CATALOG.filter(p =>
    !installedPresetIds.has(p.id) &&
    (search === '' || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAddPreset = (preset: typeof PRESET_CATALOG[0]) => {
    onAddRule({ id: crypto.randomUUID(), name: preset.name, urlPattern: preset.urlPattern, active: true, kind: 'preset', presetId: preset.id });
    setSearch(''); setShowCatalog(false);
  };

  const handleAddCustom = () => {
    if (!customName.trim()) { setPatternError('Name is required'); return; }
    if (!customPattern.trim()) { setPatternError('URL pattern is required'); return; }
    try { new RegExp(customPattern.trim()); } catch { setPatternError('Invalid regex pattern'); return; }
    onAddRule({ id: crypto.randomUUID(), name: customName.trim(), urlPattern: customPattern.trim(), active: true, kind: 'custom' });
    setCustomName(''); setCustomPattern(''); setPatternError(''); setShowCustomForm(false);
  };

  const startEditing = (rule: DetectionRule) => {
    setEditingRuleId(rule.id);
    setEditName(rule.name);
    setEditPattern(rule.urlPattern);
    setEditError('');
    setShowCatalog(false);
    setShowCustomForm(false);
  };

  const handleSaveEdit = () => {
    if (!editName.trim()) { setEditError('Name is required'); return; }
    if (!editPattern.trim()) { setEditError('URL pattern is required'); return; }
    try { new RegExp(editPattern.trim()); } catch { setEditError('Invalid regex pattern'); return; }
    onUpdateRule(editingRuleId!, editName.trim(), editPattern.trim());
    setEditingRuleId(null);
  };

  const iconForRule = (rule: DetectionRule) =>
    rule.kind === 'preset' ? (PRESET_CATALOG.find(p => p.id === rule.presetId)?.icon ?? '◎') : '◎';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Task detection" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '10px 14px 0' }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            When you open the popup on a matching URL, a banner offers to add the page as a task to your backlog.
          </p>

          {rules.length === 0 && (
            <div style={{ padding: '10px 0 6px', textAlign: 'center', fontSize: 12, color: 'var(--color-text-faint)' }}>
              No detection rules yet
            </div>
          )}
          {rules.map(rule => (
            editingRuleId === rule.id ? (
              <div key={rule.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px', marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>Edit rule</div>
                <input value={editName} onChange={e => { setEditName(e.target.value); setEditError(''); }} placeholder="Name" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: 6, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }} />
                <input value={editPattern} onChange={e => { setEditPattern(e.target.value); setEditError(''); }} placeholder="URL pattern (regex)" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: editError ? 4 : 8, background: 'var(--color-bg)', border: `1px solid ${editError ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text)', fontFamily: 'var(--font-mono)', outline: 'none' }} />
                {editError && <div style={{ fontSize: 11, color: 'var(--color-accent)', marginBottom: 8 }}>{editError}</div>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleSaveEdit} style={{ flex: 1, padding: '6px 0', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                  <button onClick={() => setEditingRuleId(null)} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div key={rule.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', marginBottom: 6,
              }}>
                <span style={{ fontSize: 13, width: 18, textAlign: 'center', flexShrink: 0, color: 'var(--color-text-muted)' }}>
                  {iconForRule(rule)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: rule.active ? 'var(--color-text)' : 'var(--color-text-faint)' }}>
                    {rule.name}
                  </div>
                  <div title={rule.urlPattern} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.urlPattern}
                  </div>
                </div>
                <Toggle active={rule.active} onChange={() => onToggleRule(rule.id)} />
                {rule.kind === 'custom' && (
                  <button onClick={() => startEditing(rule)} title="Edit" style={{
                    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                    color: 'var(--color-text-faint)', borderRadius: 4, flexShrink: 0,
                  }}>✎</button>
                )}
                <button onClick={() => onDeleteRule(rule.id)} title="Remove" style={{
                  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                  color: 'var(--color-text-faint)', borderRadius: 4, flexShrink: 0,
                }}>×</button>
              </div>
            )
          ))}
        </div>

        <div style={{ padding: '0 14px 14px' }}>
          {/* Add preset */}
          {!showCatalog ? (
            <button onClick={() => { setShowCatalog(true); setShowCustomForm(false); }} style={{
              width: '100%', padding: '8px 12px', marginBottom: 6,
              background: 'none', border: '1px dashed var(--color-border-strong)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: 12, fontWeight: 500, color: 'var(--color-accent)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>+</span> Add a provider
            </button>
          ) : (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 6, overflow: 'hidden' }}>
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search providers…" style={{ flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 12, color: 'var(--color-text)', fontFamily: 'inherit' }} />
                <button onClick={() => { setShowCatalog(false); setSearch(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-faint)', padding: 0, lineHeight: 1 }}>×</button>
              </div>
              {filteredCatalog.length === 0 ? (
                <div style={{ padding: '12px', fontSize: 12, color: 'var(--color-text-faint)', textAlign: 'center' }}>
                  {installedPresetIds.size === PRESET_CATALOG.length ? 'All providers added' : 'No matches'}
                </div>
              ) : filteredCatalog.map(preset => (
                <button key={preset.id} onClick={() => handleAddPreset(preset)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'none', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 13, width: 18, textAlign: 'center', color: 'var(--color-text-muted)', flexShrink: 0 }}>{preset.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{preset.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{preset.description}</div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--color-accent)', fontWeight: 600, flexShrink: 0 }}>Add</span>
                </button>
              ))}
            </div>
          )}

          {/* Custom rule */}
          {!showCustomForm ? (
            <button onClick={() => { setShowCustomForm(true); setShowCatalog(false); }} style={{
              width: '100%', padding: '8px 12px',
              background: 'none', border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: 12, color: 'var(--color-text-muted)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>+</span> Custom URL rule
            </button>
          ) : (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>Custom rule</div>
              <input value={customName} onChange={e => { setCustomName(e.target.value); setPatternError(''); }} placeholder="Name (e.g. My Jira)" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: 6, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }} />
              <input value={customPattern} onChange={e => { setCustomPattern(e.target.value); setPatternError(''); }} placeholder="URL pattern (regex, e.g. myco\.atlassian\.net)" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: patternError ? 4 : 8, background: 'var(--color-bg)', border: `1px solid ${patternError ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text)', fontFamily: 'var(--font-mono)', outline: 'none' }} />
              {patternError && <div style={{ fontSize: 11, color: 'var(--color-accent)', marginBottom: 8 }}>{patternError}</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleAddCustom} style={{ flex: 1, padding: '6px 0', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add rule</button>
                <button onClick={() => { setShowCustomForm(false); setCustomName(''); setCustomPattern(''); setPatternError(''); }} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Timer defaults sub-page ───────────────────────────────────────────────────

function PillGroup({ options, value, onChange, customValue, onCustomChange }: {
  options: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
  customValue: string;
  onCustomChange: (raw: string) => void;
}) {
  const isCustom = !options.some(o => o.value === value);
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            borderRadius: 99,
            border: `1px solid ${value === opt.value && !isCustom ? 'var(--color-accent)' : 'var(--color-border)'}`,
            background: value === opt.value && !isCustom ? 'rgba(200,85,61,0.08)' : 'var(--color-surface)',
            color: value === opt.value && !isCustom ? 'var(--color-accent)' : 'var(--color-text-muted)',
          }}
        >{opt.label}</button>
      ))}
      <input
        type="number"
        min={1}
        value={customValue}
        onChange={e => onCustomChange(e.target.value)}
        placeholder="custom"
        style={{
          width: 62, padding: '4px 8px', fontSize: 12, borderRadius: 99,
          border: `1px solid ${isCustom ? 'var(--color-accent)' : 'var(--color-border)'}`,
          background: isCustom ? 'rgba(200,85,61,0.08)' : 'var(--color-surface)',
          color: isCustom ? 'var(--color-accent)' : 'var(--color-text-muted)',
          outline: 'none', fontFamily: 'inherit',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>min</span>
    </div>
  );
}

function TimerDefaultsPage({ timerSettings, onUpdateTimerSettings, onBack }: {
  timerSettings: TimerSettings;
  onUpdateTimerSettings: (updates: Partial<TimerSettings>) => void;
  onBack: () => void;
}) {
  const toMin = (s: number) => String(Math.round(s / 60));
  const toSec = (m: string) => {
    const n = parseInt(m, 10);
    return isNaN(n) || n < 1 ? null : n * 60;
  };

  const [focusCustom, setFocusCustom] = useState(toMin(timerSettings.focusSeconds));
  const [shortCustom, setShortCustom] = useState(toMin(timerSettings.shortBreakSeconds));
  const [longCustom, setLongCustom] = useState(toMin(timerSettings.longBreakSeconds));
  const [longEveryStr, setLongEveryStr] = useState(String(timerSettings.longBreakEvery));
  const [goalStr, setGoalStr] = useState(String(timerSettings.dailyGoal));

  const handleFocusCustom = (raw: string) => {
    setFocusCustom(raw);
    const s = toSec(raw);
    if (s) onUpdateTimerSettings({ focusSeconds: s });
  };
  const handleShortCustom = (raw: string) => {
    setShortCustom(raw);
    const s = toSec(raw);
    if (s) onUpdateTimerSettings({ shortBreakSeconds: s });
  };
  const handleLongCustom = (raw: string) => {
    setLongCustom(raw);
    const s = toSec(raw);
    if (s) onUpdateTimerSettings({ longBreakSeconds: s });
  };

  const settingRow = (label: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Timer defaults" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '14px 14px 0' }}>
          {settingRow('Focus', (
            <PillGroup
              options={[{ label: '15m', value: 15*60 }, { label: '25m', value: 25*60 }, { label: '30m', value: 30*60 }]}
              value={timerSettings.focusSeconds}
              onChange={(v) => { onUpdateTimerSettings({ focusSeconds: v }); setFocusCustom(toMin(v)); }}
              customValue={focusCustom}
              onCustomChange={handleFocusCustom}
            />
          ))}
          {settingRow('Short break', (
            <PillGroup
              options={[{ label: '5m', value: 5*60 }, { label: '10m', value: 10*60 }]}
              value={timerSettings.shortBreakSeconds}
              onChange={(v) => { onUpdateTimerSettings({ shortBreakSeconds: v }); setShortCustom(toMin(v)); }}
              customValue={shortCustom}
              onCustomChange={handleShortCustom}
            />
          ))}
          {settingRow('Long break', (
            <>
              <PillGroup
                options={[{ label: '10m', value: 10*60 }, { label: '15m', value: 15*60 }, { label: '20m', value: 20*60 }]}
                value={timerSettings.longBreakSeconds}
                onChange={(v) => { onUpdateTimerSettings({ longBreakSeconds: v }); setLongCustom(toMin(v)); }}
                customValue={longCustom}
                onCustomChange={handleLongCustom}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>After every</span>
                <input
                  type="number"
                  min={1}
                  value={longEveryStr}
                  onChange={e => {
                    setLongEveryStr(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 1) onUpdateTimerSettings({ longBreakEvery: n });
                  }}
                  style={{
                    width: 48, padding: '4px 8px', fontSize: 12, textAlign: 'center',
                    border: '1px solid var(--color-border)', borderRadius: 6,
                    background: 'var(--color-surface)', color: 'var(--color-text)',
                    outline: 'none', fontFamily: 'inherit',
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>pomodoros</span>
              </div>
            </>
          ))}
          {settingRow('Daily goal', (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min={1}
                value={goalStr}
                onChange={e => {
                  setGoalStr(e.target.value);
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n) && n >= 1) onUpdateTimerSettings({ dailyGoal: n });
                }}
                style={{
                  width: 64, padding: '5px 8px', fontSize: 13, textAlign: 'center',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface)', color: 'var(--color-text)',
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>pomodoros per day</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sounds sub-page ──────────────────────────────────────────────────────────

const SOUND_EVENTS: { event: SoundEvent; key: keyof SoundSettings['events']; label: string; description: string }[] = [
  { event: 'pomo-done',   key: 'pomoDone',    label: 'Pomodoro done',  description: 'When a focus session ends' },
  { event: 'break-start', key: 'breakStart',  label: 'Break starts',   description: 'When break begins' },
  { event: 'break-done',  key: 'breakDone',   label: 'Break ends',     description: 'When break time is up' },
  { event: 'focus-start', key: 'focusStart',  label: 'Focus starts',   description: 'When a new pomodoro starts' },
  { event: 'task-done',   key: 'taskDone',    label: 'Task done',      description: 'When marking a task complete' },
];

function SoundsPage({ settings, onUpdate, onBack }: {
  settings: SoundSettings;
  onUpdate: (updates: Partial<SoundSettings>) => void;
  onBack: () => void;
}) {
  const setEventEnabled = (key: keyof SoundSettings['events'], val: boolean) => {
    onUpdate({ events: { ...settings.events, [key]: val } });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Sounds" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '14px 14px 0' }}>

          {/* Master toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', marginBottom: 14,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Sounds enabled</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 2 }}>Play audio cues for timer events</div>
            </div>
            <Toggle active={settings.enabled} onChange={() => onUpdate({ enabled: !settings.enabled })} />
          </div>

          {/* Volume slider */}
          <div style={{ marginBottom: 14, opacity: settings.enabled ? 1 : 0.45 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Volume · {Math.round(settings.volume * 100)}%
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.volume * 100)}
              disabled={!settings.enabled}
              onChange={e => onUpdate({ volume: parseInt(e.target.value, 10) / 100 })}
              style={{ width: '100%', accentColor: 'var(--color-accent)', cursor: settings.enabled ? 'pointer' : 'not-allowed' }}
            />
          </div>

          {/* Per-event toggles */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Events
          </div>
          <div style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', overflow: 'hidden',
            opacity: settings.enabled ? 1 : 0.45,
          }}>
            {SOUND_EVENTS.map(({ event, key, label, description }, idx) => (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 1 }}>{description}</div>
                </div>
                <button
                  title="Preview sound"
                  onClick={() => playSound(event, settings.enabled ? settings : { ...settings, enabled: true })}
                  style={{
                    width: 26, height: 26, flexShrink: 0,
                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    fontSize: 11, color: 'var(--color-text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >▶</button>
                <Toggle active={settings.events[key]} onChange={() => setEventEnabled(key, !settings.events[key])} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function SubPageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{
      padding: '10px 14px', borderBottom: '1px solid var(--color-border)',
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
    }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 18, lineHeight: 1, padding: '0 4px', display: 'flex', alignItems: 'center' }}>←</button>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>{title}</span>
    </div>
  );
}

function NavGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

function NavRow({ icon, title, description, onClick }: {
  icon: string;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 12px',
      background: 'none', border: 'none', borderTop: '1px solid var(--color-border)',
      cursor: 'pointer', textAlign: 'left',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <span style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: 'var(--color-bg)', border: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: 'var(--color-text-muted)',
      }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{title}</div>
        {description && <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 1 }}>{description}</div>}
      </div>
      <span style={{ fontSize: 16, color: 'var(--color-text-faint)', flexShrink: 0 }}>›</span>
    </button>
  );
}

// ── Calendar sub-page ─────────────────────────────────────────────────────────

function CalendarPage({ workspaces, activeWsId, timezone, onBack }: {
  workspaces: Workspace[];
  activeWsId: string;
  timezone: string;
  onBack: () => void;
}) {
  // Global error picked up from background SW (e.g. OAuth failed while popup was closed)
  const [globalError, setGlobalError] = useState<string | null>(null);
  useEffect(() => {
    chrome.storage.local.get('calendar_connect_error').then(result => {
      const err = result['calendar_connect_error'] as string | undefined;
      if (err) { setGlobalError(err); chrome.storage.local.remove('calendar_connect_error'); }
    });
  }, []);

  const displayWorkspaces = workspaces.length > 0 ? workspaces : [{ id: activeWsId, name: 'Personal', color: '#4A6FA5' }];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Calendar" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {globalError && (
            <div style={{ fontSize: 11, color: 'var(--color-accent)', padding: '8px 10px', background: 'var(--color-accent-soft)', borderRadius: 'var(--radius-sm)' }}>
              {globalError}
            </div>
          )}
          {displayWorkspaces.map(ws => (
            <WorkspaceCalendarSection
              key={ws.id}
              wsId={ws.id}
              wsName={ws.name}
              wsColor={ws.color}
              timezone={timezone}
              defaultExpanded={ws.id === activeWsId || displayWorkspaces.length === 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceCalendarSection({ wsId, wsName, wsColor, timezone, defaultExpanded }: {
  wsId: string;
  wsName: string;
  wsColor: string;
  timezone: string;
  defaultExpanded: boolean;
}) {
  const connectionsRow = useLiveQuery(() => db.settings.get('calendar_connections'));
  const listsRow = useLiveQuery(() => db.settings.get('calendar_lists'));
  const lastSyncedRow = useLiveQuery(() => db.settings.get('calendar_last_synced'));

  const connection = ((connectionsRow?.value as Record<string, CalendarConnection> | undefined) ?? {})[wsId];
  const calendarList = (((listsRow?.value as Record<string, CalendarInfo[]> | undefined) ?? {})[wsId]) ?? [];
  const lastSynced = ((lastSyncedRow?.value as Record<string, string> | undefined) ?? {})[wsId];

  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleConnect = () => {
    setConnecting(true);
    setError(null);
    chrome.storage.local.remove('calendar_connect_error');
    chrome.runtime.sendMessage({ type: 'calendar.connect', wsId })
      .then((response: ExtensionResponse) => {
        if (!response.ok) setError(response.error);
      })
      .catch(() => {})
      .finally(() => setConnecting(false));
  };

  const handleDisconnect = async () => {
    await disconnectCalendar(wsId);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncTodayMeetings(wsId, timezone);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleCalendar = async (calId: string) => {
    if (!connection) return;
    const next = connection.selectedCalendarIds.includes(calId)
      ? connection.selectedCalendarIds.filter(id => id !== calId)
      : [...connection.selectedCalendarIds, calId];
    await updateSelectedCalendars(wsId, next);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      {/* Workspace header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: 6, background: wsColor, color: '#fff',
          fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {wsName[0]?.toUpperCase()}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{wsName}</span>
        {connection
          ? <span style={{ fontSize: 10, color: 'var(--color-success)', fontWeight: 600 }}>Connected</span>
          : <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>Not connected</span>
        }
        <span style={{ fontSize: 13, color: 'var(--color-text-faint)', marginLeft: 2 }}>{expanded ? '∨' : '›'}</span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!connection ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  See today's meetings in Pomodoso
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  Connect Google Calendar for <strong>{wsName}</strong> to bring your schedule into the popup and track time spent in meetings.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  'Meetings appear in the Schedule tab',
                  'Choose which calendars to sync',
                  'Log time per meeting with one click',
                ].map(benefit => (
                  <div key={benefit} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-accent)', flexShrink: 0 }} />
                    {benefit}
                  </div>
                ))}
              </div>
              <button
                onClick={handleConnect}
                disabled={connecting}
                style={{
                  padding: '8px 0', fontSize: 12, fontWeight: 600, width: '100%',
                  background: 'var(--color-accent)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)', cursor: connecting ? 'not-allowed' : 'pointer',
                  opacity: connecting ? 0.7 : 1,
                }}
              >
                {connecting ? 'Connecting…' : '◫  Connect Google Calendar'}
              </button>
              {error && <div style={{ fontSize: 11, color: 'var(--color-accent)' }}>{error}</div>}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{connection.email}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
                  Connected {formatDate(connection.connectedAt)}
                  {lastSynced && <> · Synced {formatTime(lastSynced)}</>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => void handleSyncNow()}
                  disabled={syncing}
                  style={{
                    flex: 1, padding: '6px 10px', fontSize: 12, fontWeight: 500,
                    background: 'var(--color-bg)', color: 'var(--color-text)',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                    cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.7 : 1,
                  }}
                >
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={() => void handleDisconnect()}
                  style={{
                    flex: 1, padding: '6px 10px', fontSize: 12, fontWeight: 500,
                    background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  Disconnect
                </button>
              </div>
              {error && <div style={{ fontSize: 11, color: 'var(--color-accent)' }}>{error}</div>}

              {calendarList.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    Calendars to sync
                  </div>
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    {calendarList.map((cal, i) => (
                      <button
                        key={cal.id}
                        onClick={() => void handleToggleCalendar(cal.id)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px', background: 'none', border: 'none',
                          borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: cal.backgroundColor ?? 'var(--color-accent)' }} />
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text)' }}>
                          {cal.summary}
                          {cal.primary && <span style={{ fontSize: 10, color: 'var(--color-text-faint)', marginLeft: 6 }}>primary</span>}
                        </span>
                        <span style={{ fontSize: 13, color: connection.selectedCalendarIds.includes(cal.id) ? 'var(--color-success)' : 'var(--color-border-strong)' }}>
                          {connection.selectedCalendarIds.includes(cal.id) ? '✓' : '○'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 5 }}>
                    Selected calendars sync when you open the extension.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Data sub-page ─────────────────────────────────────────────────────────────

function DataPage({ onBack }: { onBack: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [importState, setImportState] = useState<'idle' | 'confirm' | 'loading' | 'error'>('idle');
  const [importError, setImportError] = useState('');
  const [pendingJson, setPendingJson] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const json = await exportDb();
      const date = new Date().toISOString().slice(0, 10);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pomodoso-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setPendingJson(text);
      setImportState('confirm');
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!pendingJson) return;
    setImportState('loading');
    try {
      await importDb(pendingJson);
      window.location.reload();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unknown error');
      setImportState('error');
    }
  };

  const sectionStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 14px',
    marginBottom: 10,
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SubPageHeader title="Data" onBack={onBack} />
      <div className="scroll-area">
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Export */}
          <div style={sectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Export</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
              Download all your tasks, habits, workspaces, and settings as a JSON file.
            </div>
            <button
              onClick={() => void handleExport()}
              disabled={exporting}
              style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, cursor: exporting ? 'default' : 'pointer', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', opacity: exporting ? 0.6 : 1 }}
            >
              {exporting ? 'Exporting…' : '↓ Export data'}
            </button>
          </div>

          {/* Import */}
          <div style={sectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Import</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
              Restore data from a previously exported file. This replaces all current data.
            </div>

            {importState === 'idle' && (
              <>
                <input id="import-file" type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />
                <label htmlFor="import-file" style={{ display: 'block', width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                  ↑ Choose file…
                </label>
              </>
            )}

            {importState === 'confirm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-accent)', background: 'rgba(200,85,61,0.07)', border: '1px solid rgba(200,85,61,0.2)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', lineHeight: 1.5 }}>
                  This will replace ALL your current data. This cannot be undone.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { setImportState('idle'); setPendingJson(null); }} style={{ flex: 1, padding: '6px 0', fontSize: 11, cursor: 'pointer', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                    Cancel
                  </button>
                  <button onClick={() => void handleConfirmImport()} style={{ flex: 2, padding: '6px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)' }}>
                    Replace all data
                  </button>
                </div>
              </div>
            )}

            {importState === 'loading' && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', padding: '6px 0' }}>Importing…</div>
            )}

            {importState === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-accent)', background: 'rgba(200,85,61,0.07)', border: '1px solid rgba(200,85,61,0.2)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', lineHeight: 1.5 }}>
                  {importError}
                </div>
                <button onClick={() => setImportState('idle')} style={{ padding: '6px 0', fontSize: 11, cursor: 'pointer', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                  Try again
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function Toggle({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={active} style={{
      width: 32, height: 18, flexShrink: 0,
      background: active ? 'var(--color-accent)' : 'var(--color-border-strong)',
      border: 'none', borderRadius: 99, cursor: 'pointer', padding: 0,
      position: 'relative', transition: 'background 0.15s',
    }}>
      <div style={{
        width: 12, height: 12, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 3,
        left: active ? 17 : 3,
        transition: 'left 0.15s',
      }} />
    </button>
  );
}
