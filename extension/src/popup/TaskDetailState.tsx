import { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { marked } from 'marked';
import type { TimerStartPayload } from '@pomodoso/types';
import type { SelectedTask, TaskStatus, Project, TaskLink, TimeLogEntry, NoteEntry, Workspace } from './App';
import { db, localDate, type RecurrenceRule } from '../db';
import { formatRecurrenceLabel } from '../recurrence';
import type { RecurrenceFreq } from '@pomodoso/types';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_ACTIVE_COLORS: Record<TaskStatus, { bg: string; color: string; border: string }> = {
  todo:        { bg: 'rgba(74,111,165,0.1)',  color: 'var(--color-info)',    border: 'var(--color-info)' },
  in_progress: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: 'var(--color-warning)' },
  done:        { bg: 'var(--color-success-bg)', color: 'var(--color-success)', border: 'var(--color-success)' },
  delayed:     { bg: 'rgba(123,93,180,0.1)',  color: '#7B5DB4',              border: '#7B5DB4' },
  cancelled:   { bg: 'var(--color-accent-soft)', color: 'var(--color-accent)', border: 'var(--color-accent)' },
};

interface TaskDetailStateProps {
  task: SelectedTask;
  projects: Project[];
  workspaces?: Workspace[];
  activeWsId?: string;
  timezone?: string;
  isInToday?: boolean;
  isInPriorities?: boolean;
  prioritiesFull?: boolean;
  onBack: () => void;
  onDelete: () => void;
  onMoveToBacklog?: () => void;
  onAddToPriorities?: () => void;
  onAddToTasks?: () => void;
  onUpdateTask?: (updates: Partial<SelectedTask>) => void;
  onAddProject: (project: Project) => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
  onStart: (payload: TimerStartPayload) => Promise<void>;
  onSelectTask?: (task: SelectedTask) => void;
  onCreateFollowup?: (parentId: string) => void;
}


const PALETTE = [
  '#4A6FA5', '#7B5DB4', '#2D8A7A', '#C8553D',
  '#B07A1F', '#2A7A4A', '#A0522D', '#5B7A9D',
];

marked.use({ breaks: true });

function formatNoteDate(isoDate: string, timezone: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: timezone });
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: timezone });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone });
  return sameYear ? `${month} ${day} · ${time}` : `${month} ${day}, ${d.getFullYear()} · ${time}`;
}

function applyFormat(
  ta: HTMLTextAreaElement,
  prefix: string,
  suffix: string,
  lineMode: boolean,
): { value: string; start: number; end: number } {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const v = ta.value;

  if (lineMode) {
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const blockEnd = s === e
      ? (v.indexOf('\n', s) >= 0 ? v.indexOf('\n', s) : v.length)
      : e;
    const block = v.slice(lineStart, blockEnd);
    const lines = block.split('\n');
    const toggling = lines.every(l => l.startsWith(prefix));
    const newBlock = toggling
      ? lines.map(l => l.slice(prefix.length)).join('\n')
      : lines.map(l => prefix + l).join('\n');
    const delta = newBlock.length - block.length;
    return {
      value: v.slice(0, lineStart) + newBlock + v.slice(blockEnd),
      start: s + (toggling ? -Math.min(prefix.length, s - lineStart) : prefix.length),
      end: blockEnd + delta,
    };
  }

  const sel = v.slice(s, e);
  if (sel) {
    if (sel.startsWith(prefix) && sel.endsWith(suffix) && sel.length > prefix.length + suffix.length) {
      const inner = sel.slice(prefix.length, sel.length - suffix.length);
      return { value: v.slice(0, s) + inner + v.slice(e), start: s, end: s + inner.length };
    }
    const wrapped = prefix + sel + suffix;
    return { value: v.slice(0, s) + wrapped + v.slice(e), start: s, end: s + wrapped.length };
  }

  return {
    value: v.slice(0, s) + prefix + suffix + v.slice(e),
    start: s + prefix.length,
    end: s + prefix.length,
  };
}

export function TaskDetailState({ task, projects, workspaces, activeWsId, timezone, isInToday, isInPriorities, prioritiesFull, onBack, onDelete, onMoveToBacklog, onAddToPriorities, onAddToTasks, onUpdateTask, onAddProject, onUpdateProject, onDeleteProject, onStart, onSelectTask, onCreateFollowup }: TaskDetailStateProps) {
  const parentTask = useLiveQuery(
    () => task.parentId ? db.tasks.get(task.parentId) : Promise.resolve(undefined),
    [task.parentId]
  );
  const childTasks = useLiveQuery(
    () => db.tasks.where('parentId').equals(task.id).filter(t => !t.deletedAt).toArray(),
    [task.id]
  ) ?? [];

  const [showParentPicker, setShowParentPicker] = useState(false);
  const [parentSearch, setParentSearch] = useState('');

  const childTaskIds = new Set(childTasks.map(c => c.id));
  const allTasksForPicker = useLiveQuery(
    () => db.tasks.filter(t => !t.deletedAt && t.id !== task.id && !childTaskIds.has(t.id)).toArray(),
    [task.id, childTasks.length]
  ) ?? [];
  const filteredPickerTasks = parentSearch.trim()
    ? allTasksForPicker.filter(t => t.title.toLowerCase().includes(parentSearch.toLowerCase()))
    : allTasksForPicker.slice(0, 12);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [ticketId, setTicketId] = useState(task.ticketId ?? '');
  const [status, setStatus] = useState<TaskStatus>(task.status);
  // Keep the local status in sync with the task — e.g. completing a recurring task
  // resets it to todo, and the detail must reflect that instead of staying "Done".
  useEffect(() => { setStatus(task.status); }, [task.status]);
  const [projectId, setProjectId] = useState<string | null>(task.projectId);
  const [noteEntries, setNoteEntries] = useState<NoteEntry[]>(() => {
    if (task.noteEntries && task.noteEntries.length > 0) return task.noteEntries;
    // Migrate legacy notes string into a single entry
    if (task.notes) return [{ id: crypto.randomUUID(), createdAt: task.updatedAt, content: task.notes }];
    return [];
  });
  const [showAddTime, setShowAddTime] = useState(false);
  const [addH, setAddH] = useState('');
  const [addM, setAddM] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [links, setLinks] = useState<TaskLink[]>(task.links ?? []);
  const [showAddLink, setShowAddLink] = useState(false);
  const [addLinkUrl, setAddLinkUrl] = useState('');
  const [addLinkLabel, setAddLinkLabel] = useState('');
  const [linkUrlError, setLinkUrlError] = useState('');
  const [editingLinkOrigUrl, setEditingLinkOrigUrl] = useState<string | null>(null);
  const [editLinkUrl, setEditLinkUrl] = useState('');
  const [editLinkLabel, setEditLinkLabel] = useState('');
  const [editLinkUrlError, setEditLinkUrlError] = useState('');
  const [showTicketId, setShowTicketId] = useState((task.ticketId ?? '').length > 0);
  const [showDescription, setShowDescription] = useState((task.description ?? '').length > 0);
  const [showRecurrenceEditor, setShowRecurrenceEditor] = useState(false);
  const today = localDate(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | undefined>(task.recurrence);
  const [ruleFreq, setRuleFreq] = useState<RecurrenceFreq>(task.recurrence?.freq ?? 'weekly');
  const [ruleWeekdays, setRuleWeekdays] = useState<number[]>(task.recurrence?.weekdays ?? [new Date().getDay()]);
  const [ruleMonthDay, setRuleMonthDay] = useState(task.recurrence?.monthDay ?? new Date().getDate());
  const [ruleYearMonth, setRuleYearMonth] = useState(task.recurrence?.yearMonth ?? new Date().getMonth() + 1);
  const [ruleYearDay, setRuleYearDay] = useState(task.recurrence?.yearDay ?? new Date().getDate());
  const [ruleTime, setRuleTime] = useState(task.recurrence?.time ?? '');
  const [ruleAllDay, setRuleAllDay] = useState(task.recurrence ? !task.recurrence.time : true);
  const [ruleStartDate, setRuleStartDate] = useState(task.recurrence?.startDate ?? today);
  const [ruleEndDate, setRuleEndDate] = useState(task.recurrence?.endDate ?? '');
  const [ruleHasEnd, setRuleHasEnd] = useState(!!task.recurrence?.endDate);
  const [descTab, setDescTab] = useState<'write' | 'preview'>('write');
  const [showProject, setShowProject] = useState(task.projectId !== null);
  const [showTimeLogged, setShowTimeLogged] = useState(false);
  const effectiveDefaultWsId = task.workspaceId
    ?? (activeWsId && activeWsId !== 'all' ? activeWsId : null)
    ?? workspaces?.[0]?.id
    ?? null;
  const [wsId, setWsId] = useState<string | null>(effectiveDefaultWsId);

  // Auto-assign workspaceId if task had none
  useEffect(() => {
    if (!task.workspaceId && effectiveDefaultWsId) {
      onUpdateTask?.({ workspaceId: effectiveDefaultWsId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noteRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const descRef = useRef<HTMLTextAreaElement>(null);

  const handleStart = () => {
    void onStart({
      mode: 'pomodoro',
      taskId: task.id,
      taskTitle: title,
      ticketId: null,
      ticketExternalId: ticketId || null,
    });
  };

  const handleAddNote = () => {
    const newNote: NoteEntry = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), content: '' };
    const updated = [...noteEntries, newNote];
    setNoteEntries(updated);
    setExpandedNotes(prev => new Set([...prev, newNote.id]));
    onUpdateTask?.({ noteEntries: updated, notes: '' });
    requestAnimationFrame(() => noteRefs.current[newNote.id]?.focus());
  };

  const handleDeleteNote = (id: string) => {
    const updated = noteEntries.filter(n => n.id !== id);
    setNoteEntries(updated);
    setExpandedNotes(prev => { const s = new Set(prev); s.delete(id); return s; });
    onUpdateTask?.({ noteEntries: updated });
  };

  const handleUpdateNote = (id: string, content: string) => {
    const updated = noteEntries.map(n => n.id === id ? { ...n, content } : n);
    setNoteEntries(updated);
    onUpdateTask?.({ noteEntries: updated });
  };

  const handleDescFormat = (prefix: string, suffix = prefix, lineMode = false) => {
    const ta = descRef.current;
    if (!ta) return;
    const result = applyFormat(ta, prefix, suffix, lineMode);
    setDescription(result.value);
    onUpdateTask?.({ description: result.value });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.start, result.end);
    });
  };

  const handleSaveRecurrence = () => {
    const rule: RecurrenceRule = {
      freq: ruleFreq,
      ...(ruleFreq === 'weekly' && { weekdays: ruleWeekdays }),
      ...(ruleFreq === 'monthly' && { monthDay: ruleMonthDay }),
      ...(ruleFreq === 'yearly' && { yearMonth: ruleYearMonth, yearDay: ruleYearDay }),
      time: ruleAllDay ? null : (ruleTime || null),
      startDate: ruleStartDate || today,
      endDate: ruleHasEnd && ruleEndDate ? ruleEndDate : null,
    };
    setRecurrenceRule(rule);
    setShowRecurrenceEditor(false);
    onUpdateTask?.({ recurrence: rule });
  };

  const handleClearRecurrence = () => {
    setRecurrenceRule(undefined);
    setShowRecurrenceEditor(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onUpdateTask?.({ recurrence: undefined as any });
  };

  const handleAddTime = () => {
    const h = parseInt(addH || '0', 10);
    const m = parseInt(addM || '0', 10);
    const secs = h * 3600 + m * 60;
    if (secs > 0) {
      const entry: TimeLogEntry = {
        id: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        durationSeconds: secs,
        mode: 'manual',
      };
      onUpdateTask?.({ timeLogs: [...(task.timeLogs ?? []), entry] });
    }
    setAddH(''); setAddM('');
    setShowAddTime(false);
  };

  const descPreviewHtml = marked.parse(description || '_No description yet._') as string;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--color-border-strong) transparent' }}>

      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={iconBtn} title="Back">←</button>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', flex: 1 }}>Task detail</span>
        {confirmDelete ? (
          <>
            <GhostBtn onClick={() => setConfirmDelete(false)}>Cancel</GhostBtn>
            <GhostBtn onClick={onDelete} danger>Delete</GhostBtn>
          </>
        ) : (
          <>
            {isInToday && onMoveToBacklog && (
              <GhostBtn onClick={onMoveToBacklog}>↓ Backlog</GhostBtn>
            )}
            {!isInPriorities && onAddToPriorities && (
              <GhostBtn onClick={onAddToPriorities} {...(prioritiesFull ? { disabled: true, title: 'Priorities full (max 3)' } : {})}>
                ↑ Priority
              </GhostBtn>
            )}
            {!isInToday && onAddToTasks && (
              <GhostBtn onClick={onAddToTasks}>+ Today</GhostBtn>
            )}
            <GhostBtn onClick={() => setConfirmDelete(true)} danger>Delete</GhostBtn>
          </>
        )}
      </div>

      {/* Editable title */}
      <div style={{ padding: '12px 14px 0' }}>
        <FieldLabel>Title</FieldLabel>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title.trim()) onUpdateTask?.({ title: title.trim() }); }}
          style={{
            ...inputBase,
            fontSize: 14, fontWeight: 600,
          }}
        />
      </div>

      {/* Task ID */}
      <div style={{ padding: '12px 14px 0' }}>
        {!showTicketId ? (
          <AddFieldButton label="Add task ID" onClick={() => setShowTicketId(true)} />
        ) : (
          <>
            <FieldLabel>Task ID</FieldLabel>
            <input
              value={ticketId}
              onChange={e => setTicketId(e.target.value)}
              onBlur={() => onUpdateTask?.({ ticketId: ticketId.trim() || null })}
              placeholder="e.g. INT-455"
              style={{ ...inputBase, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-info)' }}
            />
          </>
        )}
      </div>

      {/* Description */}
      <div style={{ padding: '12px 14px 0' }}>
        {!showDescription ? (
          <AddFieldButton label="Add description" onClick={() => setShowDescription(true)} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <FieldLabel style={{ marginBottom: 0, flex: 1 }}>Description</FieldLabel>
              <TabToggle active={descTab} onChange={setDescTab} options={['write', 'preview'] as const} />
            </div>
            {descTab === 'write' && (
              <>
                <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
                  <FormatBtn label="B" bold title="Bold" onClick={() => handleDescFormat('**')} />
                  <FormatBtn label="I" italic title="Italic" onClick={() => handleDescFormat('_')} />
                  <FormatBtn label="•" title="Bullet list" onClick={() => handleDescFormat('- ', '', true)} />
                  <FormatBtn label="`" mono title="Inline code" onClick={() => handleDescFormat('`')} />
                </div>
                <textarea
                  ref={descRef}
                  value={description}
                  onChange={e => { setDescription(e.target.value); onUpdateTask?.({ description: e.target.value }); }}
                  placeholder="Describe this task…"
                  rows={4}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '8px 10px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text)', lineHeight: 1.6,
                    resize: 'vertical', outline: 'none',
                  }}
                />
              </>
            )}
            {descTab === 'preview' && (
              <div
                className="notes-preview"
                dangerouslySetInnerHTML={{ __html: descPreviewHtml }}
                style={{
                  padding: '8px 10px', minHeight: 80,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12, lineHeight: 1.7,
                  color: 'var(--color-text)',
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Recurrence */}
      <div style={{ padding: '12px 14px 0' }}>
          {!recurrenceRule && !showRecurrenceEditor ? (
            <AddFieldButton label="Add recurrence" onClick={() => setShowRecurrenceEditor(true)} />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: showRecurrenceEditor ? 8 : 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1 }}>
                  Repeat
                </span>
                {!showRecurrenceEditor && recurrenceRule && (
                  <>
                    <GhostBtn onClick={() => setShowRecurrenceEditor(true)}>Edit</GhostBtn>
                    <GhostBtn onClick={handleClearRecurrence} danger style={{ marginLeft: 4 }}>Remove</GhostBtn>
                  </>
                )}
              </div>
              {!showRecurrenceEditor && recurrenceRule && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 0' }}>
                  <span style={{ marginRight: 6 }}>↺</span>
                  {formatRecurrenceLabel(recurrenceRule)}
                  {(recurrenceRule.startDate || recurrenceRule.endDate) && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-faint)', marginLeft: 8 }}>
                      {'Starts ' + recurrenceRule.startDate}
                      {recurrenceRule.endDate ? ' · Ends ' + recurrenceRule.endDate : ' · No end'}
                    </span>
                  )}
                </div>
              )}
              {showRecurrenceEditor && (
                <div style={{ padding: '10px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  {/* Frequency tabs */}
                  <div style={{ display: 'flex', gap: 3, marginBottom: 10 }}>
                    {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(f => (
                      <button key={f} onClick={() => setRuleFreq(f)} style={{
                        flex: 1, padding: '4px 0', fontSize: 11, fontWeight: ruleFreq === f ? 700 : 400,
                        border: `1px solid ${ruleFreq === f ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: ruleFreq === f ? 'rgba(var(--color-accent-rgb, 207,70,59),0.1)' : 'transparent',
                        color: ruleFreq === f ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        textTransform: 'capitalize',
                      }}>{f}</button>
                    ))}
                  </div>
                  {/* Day selector */}
                  {ruleFreq === 'weekly' && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 4 }}>Days</div>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => {
                          const on = ruleWeekdays.includes(i);
                          return (
                            <button key={i} onClick={() => setRuleWeekdays(prev => on ? prev.filter(x => x !== i) : [...prev, i].sort())} style={{
                              flex: 1, padding: '4px 0', fontSize: 10, fontWeight: on ? 700 : 400,
                              border: `1px solid ${on ? 'var(--color-info)' : 'var(--color-border)'}`,
                              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                              background: on ? 'rgba(74,111,165,0.15)' : 'transparent',
                              color: on ? 'var(--color-info)' : 'var(--color-text-muted)',
                            }}>{d}</button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {ruleFreq === 'monthly' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>Day of month</span>
                      <input type="number" min={1} max={31} value={ruleMonthDay}
                        onChange={e => setRuleMonthDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                        style={{ width: 48, ...numInputStyle }} />
                    </div>
                  )}
                  {ruleFreq === 'yearly' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>Month</span>
                      <input type="number" min={1} max={12} value={ruleYearMonth}
                        onChange={e => setRuleYearMonth(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))}
                        style={{ width: 40, ...numInputStyle }} />
                      <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>Day</span>
                      <input type="number" min={1} max={31} value={ruleYearDay}
                        onChange={e => setRuleYearDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                        style={{ width: 48, ...numInputStyle }} />
                    </div>
                  )}
                  {/* Time */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0 }}>Time</span>
                    <input type="time" value={ruleTime} disabled={ruleAllDay}
                      onChange={e => setRuleTime(e.target.value)}
                      style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: ruleAllDay ? 'var(--color-text-faint)' : 'var(--color-text)', outline: 'none' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={ruleAllDay} onChange={e => setRuleAllDay(e.target.checked)} />
                      All day
                    </label>
                  </div>
                  {/* Start/end dates */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>Starts</span>
                      <input type="date" value={ruleStartDate} onChange={e => setRuleStartDate(e.target.value)}
                        style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-text-faint)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={ruleHasEnd} onChange={e => setRuleHasEnd(e.target.checked)} />
                        Ends
                      </label>
                      {ruleHasEnd && (
                        <input type="date" value={ruleEndDate} onChange={e => setRuleEndDate(e.target.value)}
                          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none' }} />
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <GhostBtn onClick={() => { setShowRecurrenceEditor(false); if (!recurrenceRule) { /* nothing to reset */ } }}>Cancel</GhostBtn>
                    <GhostBtn onClick={handleSaveRecurrence} accent>Save</GhostBtn>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      {/* Links */}
      <div style={{ padding: '12px 14px 0' }}>
        {links.length === 0 && !showAddLink ? (
          <AddFieldButton label="Add reference link" onClick={() => { setShowAddLink(true); setLinkUrlError(''); }} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <FieldLabel style={{ marginBottom: 0, flex: 1 }}>Reference links</FieldLabel>
              {!showAddLink && <GhostBtn onClick={() => { setShowAddLink(true); setLinkUrlError(''); }}>+ Add</GhostBtn>}
            </div>
        {links.map(link => editingLinkOrigUrl === link.url ? (
          <div key={link.url} style={{
            padding: '8px 10px', marginBottom: 4,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            <input
              value={editLinkUrl}
              onChange={e => { setEditLinkUrl(e.target.value); setEditLinkUrlError(''); }}
              placeholder="https://…"
              autoFocus
              style={{ ...inputBase, fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 4, borderColor: editLinkUrlError ? 'var(--color-accent)' : undefined }}
            />
            {editLinkUrlError && <div style={{ fontSize: 11, color: 'var(--color-accent)', marginBottom: 4 }}>{editLinkUrlError}</div>}
            <input
              value={editLinkLabel}
              onChange={e => setEditLinkLabel(e.target.value)}
              placeholder="Label (optional)"
              style={{ ...inputBase, fontSize: 12, marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <GhostBtn accent onClick={() => {
                const url = editLinkUrl.trim();
                if (!url) { setEditLinkUrlError('URL is required'); return; }
                const label = editLinkLabel.trim() || url;
                const newLinks = links.map(l => l.url === editingLinkOrigUrl ? { url, label } : l);
                setLinks(newLinks);
                onUpdateTask?.({ links: newLinks });
                setEditingLinkOrigUrl(null);
              }}>Save</GhostBtn>
              <GhostBtn onClick={() => setEditingLinkOrigUrl(null)}>Cancel</GhostBtn>
            </div>
          </div>
        ) : (
          <div key={link.url} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', marginBottom: 4,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-faint)', flexShrink: 0 }}>🔗</span>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, fontSize: 12, color: 'var(--color-info)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
            >
              {link.label || link.url}
            </a>
            <button
              onClick={() => { setEditingLinkOrigUrl(link.url); setEditLinkUrl(link.url); setEditLinkLabel(link.label); setEditLinkUrlError(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-faint)', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
              title="Edit link"
            >✎</button>
            <button
              onClick={() => {
                const newLinks = links.filter(l => l.url !== link.url);
                setLinks(newLinks);
                onUpdateTask?.({ links: newLinks });
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-faint)', padding: 0, lineHeight: 1, flexShrink: 0 }}
              title="Remove link"
            >×</button>
          </div>
        ))}

        {showAddLink && (
          <div style={{
            padding: '8px 10px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 4,
          }}>
            <input
              value={addLinkUrl}
              onChange={e => { setAddLinkUrl(e.target.value); setLinkUrlError(''); }}
              placeholder="https://…"
              style={{ ...inputBase, fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 4, borderColor: linkUrlError ? 'var(--color-accent)' : undefined }}
            />
            {linkUrlError && <div style={{ fontSize: 11, color: 'var(--color-accent)', marginBottom: 4 }}>{linkUrlError}</div>}
            <input
              value={addLinkLabel}
              onChange={e => setAddLinkLabel(e.target.value)}
              placeholder="Label (optional)"
              style={{ ...inputBase, fontSize: 12, marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <GhostBtn accent onClick={() => {
                const url = addLinkUrl.trim();
                if (!url) { setLinkUrlError('URL is required'); return; }
                const label = addLinkLabel.trim() || url;
                const newLinks = [...links.filter(l => l.url !== url), { url, label }];
                setLinks(newLinks);
                onUpdateTask?.({ links: newLinks });
                setAddLinkUrl(''); setAddLinkLabel(''); setShowAddLink(false); setLinkUrlError('');
              }}>Add</GhostBtn>
              <GhostBtn onClick={() => { setShowAddLink(false); setAddLinkUrl(''); setAddLinkLabel(''); setLinkUrlError(''); }}>Cancel</GhostBtn>
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* Related tasks */}
      {(parentTask || childTasks.length > 0 || onCreateFollowup || onUpdateTask) && (
        <div style={{ padding: '12px 14px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1 }}>
              Related tasks
            </span>
          </div>
          {parentTask && !parentTask.deletedAt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0 }}>↩</span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {parentTask.ticketId && (
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-info)', marginRight: 5 }}>{parentTask.ticketId}</span>
                )}
                {parentTask.title || '(untitled)'}
              </span>
              {onSelectTask && (
                <button
                  onClick={() => onSelectTask(parentTask as SelectedTask)}
                  style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-info)', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 7px', cursor: 'pointer', flexShrink: 0 }}
                >
                  View
                </button>
              )}
              <button
                onClick={() => onUpdateTask?.({ parentId: null })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-faint)', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                title="Remove parent"
              >×</button>
            </div>
          )}
          {childTasks.map(child => (
            <div key={child.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                background: child.status === 'done' ? 'var(--color-success-bg)' : child.status === 'in_progress' ? 'var(--color-warning-bg)' : 'var(--color-surface)',
                color: child.status === 'done' ? 'var(--color-success)' : child.status === 'in_progress' ? 'var(--color-warning)' : 'var(--color-text-faint)',
                border: '1px solid',
                borderColor: child.status === 'done' ? 'var(--color-success)' : child.status === 'in_progress' ? 'var(--color-warning)' : 'var(--color-border)',
              }}>
                {child.status === 'done' ? '✓' : child.status === 'cancelled' ? '✗' : child.status === 'in_progress' ? '▶' : '○'}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {child.title || '(untitled)'}
              </span>
              {onSelectTask && (
                <button
                  onClick={() => onSelectTask(child as SelectedTask)}
                  style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-info)', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 7px', cursor: 'pointer', flexShrink: 0 }}
                >
                  View
                </button>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: (parentTask || childTasks.length > 0) ? 8 : 0, flexWrap: 'wrap' }}>
            {onCreateFollowup && (
              <button
                onClick={() => onCreateFollowup(task.id)}
                style={{ fontSize: 12, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Create follow-up
              </button>
            )}
            {!parentTask && onUpdateTask && (
              <button
                onClick={() => { setShowParentPicker(v => !v); setParentSearch(''); }}
                style={{ fontSize: 12, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>↩</span> Link existing task
              </button>
            )}
          </div>
          {showParentPicker && (
            <div style={{ marginTop: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)' }}>
              <input
                autoFocus
                placeholder="Search tasks…"
                value={parentSearch}
                onChange={e => setParentSearch(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px', fontSize: 12, boxSizing: 'border-box',
                  border: 'none', borderBottom: '1px solid var(--color-border)',
                  background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none',
                }}
              />
              <div style={{ maxHeight: 160, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                {filteredPickerTasks.length === 0 ? (
                  <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-text-faint)' }}>No tasks found</div>
                ) : filteredPickerTasks.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { onUpdateTask({ parentId: t.id }); setShowParentPicker(false); }}
                    style={{
                      width: '100%', padding: '7px 10px', textAlign: 'left', fontSize: 12,
                      background: 'none', border: 'none', borderBottom: '1px solid var(--color-border)',
                      cursor: 'pointer', color: 'var(--color-text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                  >
                    {t.ticketId && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-info)', marginRight: 5 }}>{t.ticketId}</span>}
                    {t.title || '(untitled)'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workspace */}
      {workspaces && workspaces.length > 0 && (
        <div style={{ padding: '12px 14px 0' }}>
          <FieldLabel>Workspace</FieldLabel>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {workspaces.map(ws => {
              const isSelected = wsId === ws.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => { setWsId(ws.id); onUpdateTask?.({ workspaceId: ws.id }); }}
                  style={{
                    padding: '4px 10px', fontSize: 11, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    border: `1px solid ${isSelected ? ws.color : 'var(--color-border)'}`,
                    background: isSelected ? `${ws.color}22` : 'transparent',
                    color: isSelected ? ws.color : 'var(--color-text-muted)',
                    fontWeight: isSelected ? 600 : 400,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ws.color, flexShrink: 0 }} />
                  {ws.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Project */}
      <div style={{ padding: '12px 14px 0' }}>
        {!showProject ? (
          <AddFieldButton label="Add project" onClick={() => setShowProject(true)} />
        ) : (
          <>
            <FieldLabel>Project</FieldLabel>
            <ProjectPicker
              projects={projects}
              value={projectId}
              timezone={timezone}
              workspaceId={task.workspaceId}
              onChange={(id) => { setProjectId(id); onUpdateTask?.({ projectId: id }); }}
              onAddProject={onAddProject}
              onUpdateProject={onUpdateProject}
              onDeleteProject={(id) => { if (projectId === id) { setProjectId(null); onUpdateTask?.({ projectId: null }); } onDeleteProject(id); }}
            />
          </>
        )}
      </div>

      {/* Status */}
      <div style={{ padding: '12px 14px 0' }}>
        <FieldLabel>Status</FieldLabel>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(opt => {
            const isSelected = status === opt.value;
            const colors = STATUS_ACTIVE_COLORS[opt.value];
            return (
              <button
                key={opt.value}
                onClick={() => {
                  setStatus(opt.value);
                  onUpdateTask?.({ status: opt.value });
                }}
                style={{
                  flex: 1, padding: '5px 0', fontSize: 10, fontWeight: isSelected ? 700 : 500,
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  border: `1px solid ${isSelected ? colors.border : 'var(--color-border)'}`,
                  background: isSelected ? colors.bg : 'transparent',
                  color: isSelected ? colors.color : 'var(--color-text-muted)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Session history + manual time log */}
      <div style={{ padding: '12px 14px 0' }}>
        {(task.timeLogs ?? []).length === 0 && !showAddTime ? (
          <AddFieldButton label="Log time" onClick={() => { setShowTimeLogged(true); setShowAddTime(true); }} />
        ) : (
          <>
            {(task.timeLogs ?? []).length > 0 && (
              <button
                onClick={() => setShowTimeLogged(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', width: '100%',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, gap: 6,
                  marginBottom: showTimeLogged || showAddTime ? 6 : 0,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1, textAlign: 'left' }}>
                  Session history
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {fmtDuration((task.timeLogs ?? []).reduce((s, e) => s + e.durationSeconds, 0))}
                </span>
                <GhostBtn
                  onClick={(e) => { e.stopPropagation(); setShowAddTime(v => !v); }}
                  style={{ marginLeft: 4 }}
                >
                  + Add
                </GhostBtn>
                <span style={{ fontSize: 10, color: 'var(--color-text-faint)', marginLeft: 2 }}>
                  {showTimeLogged ? '▲' : '▼'}
                </span>
              </button>
            )}
            {showAddTime && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                padding: '6px 10px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}>
                <NumInput value={addH} onChange={setAddH} max={99} placeholder="0" />
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>h</span>
                <NumInput value={addM} onChange={setAddM} max={59} placeholder="0" />
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>m</span>
                <div style={{ flex: 1 }} />
                <GhostBtn onClick={handleAddTime} accent>Add</GhostBtn>
                <GhostBtn onClick={() => { setShowAddTime(false); setAddH(''); setAddM(''); }}>Cancel</GhostBtn>
              </div>
            )}
            {showTimeLogged && (task.timeLogs ?? []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {[...(task.timeLogs ?? [])].reverse().map(entry => (
                  <SessionLogRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Notes */}
      <div style={{ padding: '12px 14px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: noteEntries.length > 0 ? 8 : 0 }}>
          <FieldLabel style={{ marginBottom: 0, flex: 1 }}>Notes</FieldLabel>
          <button
            onClick={handleAddNote}
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}
          >
            + Add note
          </button>
        </div>
        {noteEntries.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No notes yet.</div>
        )}
        {noteEntries.map((note, i) => {
          const expanded = expandedNotes.has(note.id);
          const preview = note.content.split('\n')[0]?.slice(0, 60) || '';
          return (
            <div
              key={note.id}
              style={{
                marginBottom: i < noteEntries.length - 1 ? 6 : 0,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
              }}
            >
              <div
                onClick={() => setExpandedNotes(prev => {
                  const s = new Set(prev);
                  expanded ? s.delete(note.id) : s.add(note.id);
                  return s;
                })}
                style={{ display: 'flex', alignItems: 'center', padding: '5px 8px 5px 10px', background: 'var(--color-bg)', cursor: 'pointer', gap: 6 }}
              >
                <span style={{ fontSize: 10, color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  {formatNoteDate(note.createdAt, timezone)}
                </span>
                {!expanded && preview && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {preview}
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0, marginLeft: 'auto' }}>{expanded ? '▲' : '▼'}</span>
                <button
                  onClick={e => { e.stopPropagation(); handleDeleteNote(note.id); }}
                  title="Delete note"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-faint)', padding: '0 0 0 4px', lineHeight: 1, flexShrink: 0 }}
                >×</button>
              </div>
              {expanded && (
                <textarea
                  ref={el => { noteRefs.current[note.id] = el; }}
                  value={note.content}
                  onChange={e => handleUpdateNote(note.id, e.target.value)}
                  placeholder="Write a note…"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none', borderTop: '1px solid var(--color-border)',
                    fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text)', lineHeight: 1.6,
                    resize: 'vertical', outline: 'none', display: 'block',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 16 }} />

      {/* Start button — hidden when done or cancelled */}
      {status !== 'done' && status !== 'cancelled' && (
        <div style={{ padding: '12px 14px 0' }}>
          <button onClick={handleStart} style={{
            width: '100%', padding: '10px 0',
            background: 'var(--color-accent)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            ▶ Start
          </button>
        </div>
      )}

      <div style={{ height: 14 }} />
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--color-text-muted)', fontSize: 18, lineHeight: 1,
  padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
};

const inputBase: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '6px 10px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13, color: 'var(--color-text)',
  outline: 'none', fontFamily: 'inherit',
};

const numInputStyle: React.CSSProperties = {
  padding: '3px 6px',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  background: 'var(--color-bg)',
  fontSize: 12,
  color: 'var(--color-text)',
  outline: 'none',
  textAlign: 'center',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec > 0 ? `${sec}s` : ''}`.trim();
  return `${sec}s`;
}

function fmtLogDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function SessionLogRow({ entry }: { entry: TimeLogEntry }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 8px',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 11,
    }}>
      <span style={{ color: 'var(--color-text-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fmtLogDate(entry.startedAt)}
      </span>
      <span style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0 }}>
        {entry.mode === 'pomodoro' ? '🍅' : entry.mode === 'manual' ? 'manual' : '⏱'}
      </span>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, flexShrink: 0 }}>
        {fmtDuration(entry.durationSeconds)}
      </span>
    </div>
  );
}

function AddFieldButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 0', background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 12, color: 'var(--color-text-faint)',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <span style={{ fontSize: 14, lineHeight: 1, color: 'var(--color-text-muted)' }}>+</span>
      {label}
    </button>
  );
}

function FieldLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--color-text-muted)',
      marginBottom: 6, ...style,
    }}>
      {children}
    </div>
  );
}

function GhostBtn({
  children, onClick, danger, accent, disabled, title, style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      padding: '3px 10px', fontSize: 11, fontWeight: 500,
      cursor: disabled ? 'default' : 'pointer',
      background: 'none', flexShrink: 0,
      border: `1px solid ${danger ? '#C0392B' : accent ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-sm)',
      color: disabled
        ? 'var(--color-text-faint)'
        : danger ? '#C0392B' : accent ? 'var(--color-accent)' : 'var(--color-text-muted)',
      opacity: disabled ? 0.6 : 1,
      ...style,
    }}>
      {children}
    </button>
  );
}

function NumInput({ value, onChange, max, placeholder }: {
  value: string; onChange: (v: string) => void; max: number; placeholder: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => {
        const n = parseInt(e.target.value, 10);
        if (e.target.value === '' || (!isNaN(n) && n >= 0 && n <= max)) onChange(e.target.value);
      }}
      placeholder={placeholder}
      min={0}
      max={max}
      style={{
        width: 40, padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4,
        background: 'var(--color-bg)', fontSize: 12,
        fontFamily: 'var(--font-mono)', color: 'var(--color-text)',
        textAlign: 'center', outline: 'none',
      }}
    />
  );
}

function FormatBtn({ label, title, onClick, bold, italic, mono }: {
  label: string; title: string; onClick: () => void;
  bold?: boolean; italic?: boolean; mono?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 26, height: 24, border: '1px solid var(--color-border)',
      borderRadius: 4, background: 'var(--color-surface)', cursor: 'pointer',
      fontSize: 11, fontWeight: bold ? 700 : 500,
      fontStyle: italic ? 'italic' : 'normal',
      fontFamily: mono ? 'var(--font-mono)' : 'inherit',
      color: 'var(--color-text-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {label}
    </button>
  );
}

function TabToggle<T extends string>({
  active, onChange, options,
}: {
  active: T; onChange: (v: T) => void; options: readonly T[];
}) {
  return (
    <div style={{
      display: 'flex', background: 'var(--color-bg)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)', padding: '1px', gap: 1,
    }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: '2px 10px', border: 'none', cursor: 'pointer',
          fontSize: 11, borderRadius: 4, textTransform: 'capitalize',
          fontWeight: active === opt ? 600 : 400,
          background: active === opt ? 'var(--color-surface)' : 'transparent',
          color: active === opt ? 'var(--color-text)' : 'var(--color-text-muted)',
          boxShadow: active === opt ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
        }}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function pickerItemStyle(selected: boolean): React.CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 10px',
    background: selected ? 'var(--color-bg)' : 'transparent',
    border: 'none', cursor: 'pointer', textAlign: 'left',
  };
}

function ProjectPicker({
  projects, value, timezone, workspaceId, onChange, onAddProject, onUpdateProject, onDeleteProject,
}: {
  projects: Project[];
  value: string | null;
  timezone?: string;
  workspaceId?: string | null;
  onChange: (id: string | null) => void;
  onAddProject: (project: Project) => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]!);
  const [endDate, setEndDate] = useState('');

  const today = localDate(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const wsProjects = projects.filter(p => !p.workspaceId || !workspaceId || p.workspaceId === workspaceId);
  const activeProjects = wsProjects.filter(p => !p.endDate || p.endDate >= today);
  const selectedProject = value ? wsProjects.find(p => p.id === value) ?? projects.find(p => p.id === value) : null;
  const selectedIsArchived = selectedProject && !activeProjects.find(p => p.id === value);

  const openCreate = () => {
    setName(''); setColor(PALETTE[0]!); setEndDate('');
    setMode('create');
  };

  const openEdit = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(p.id);
    setName(p.name);
    setColor(p.color);
    setEndDate(p.endDate ?? '');
    setConfirmDelete(false);
    setMode('edit');
  };

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    if (editingId) onDeleteProject(editingId);
    setMode('list');
    setOpen(false);
    setConfirmDelete(false);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (mode === 'create') {
      const project: Project = {
        id: crypto.randomUUID(),
        name: name.trim(),
        color,
        workspaceId: workspaceId ?? null,
        ...(endDate ? { endDate } : {}),
      };
      onAddProject(project);
      onChange(project.id);
    } else if (mode === 'edit' && editingId) {
      const updates: Partial<Project> = { name: name.trim(), color };
      if (endDate) updates.endDate = endDate;
      onUpdateProject(editingId, updates);
    }
    setMode('list');
    setOpen(false);
  };

  const handleCancel = () => { setMode('list'); setConfirmDelete(false); };

  const ProjectForm = (
    <div style={{ padding: '8px 10px', borderTop: mode === 'edit' ? 'none' : '1px solid var(--color-border)' }}>
      {mode === 'edit' && (
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
          Edit project
        </div>
      )}
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Project name"
        autoFocus
        style={{ ...inputBase, marginBottom: 6, fontSize: 12 }}
      />
      <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
        {PALETTE.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 20, height: 20, borderRadius: '50%',
              background: c, cursor: 'pointer', flexShrink: 0,
              border: color === c ? '2.5px solid var(--color-text)' : '2.5px solid transparent',
              outline: 'none',
            }}
          />
        ))}
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>End date (optional)</div>
        <input
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          style={{ ...inputBase, fontSize: 12 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          style={{
            flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600, border: 'none',
            borderRadius: 'var(--radius-sm)', cursor: name.trim() ? 'pointer' : 'default',
            background: name.trim() ? 'var(--color-accent)' : 'var(--color-border)',
            color: name.trim() ? '#fff' : 'var(--color-text-faint)',
          }}
        >
          Save
        </button>
        <button
          onClick={handleCancel}
          style={{
            padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            background: 'transparent', color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
          }}
        >
          Cancel
        </button>
      </div>
      {mode === 'edit' && (
        <button
          onClick={handleDelete}
          style={{
            marginTop: 6, width: '100%', padding: '5px 0', fontSize: 11, cursor: 'pointer',
            background: confirmDelete ? 'var(--color-accent)' : 'transparent',
            color: confirmDelete ? '#fff' : 'var(--color-accent)',
            border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)',
          }}
        >
          {confirmDelete ? 'Confirm delete' : 'Delete project'}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(v => !v); setMode('list'); }}
        style={{ ...inputBase, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}
      >
        {selectedProject ? (
          <>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: selectedProject.color, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: 13, color: 'var(--color-text)', flex: 1 }}>{selectedProject.name}</span>
            {selectedIsArchived && <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>archived</span>}
          </>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)', flex: 1 }}>No project</span>
        )}
        <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          marginTop: 3, background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden',
        }}>
          {mode === 'edit' ? ProjectForm : (
            <>
              <button onClick={() => { onChange(null); setOpen(false); }} style={pickerItemStyle(value === null)}>
                <span style={{ fontSize: 13, color: value === null ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>No project</span>
                {value === null && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-accent)' }}>✓</span>}
              </button>

              {activeProjects.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <button onClick={() => { onChange(p.id); setOpen(false); }} style={{ ...pickerItemStyle(value === p.id), flex: 1 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 13, color: 'var(--color-text)', flex: 1 }}>{p.name}</span>
                    {value === p.id && <span style={{ fontSize: 11, color: 'var(--color-accent)' }}>✓</span>}
                  </button>
                  <button
                    onClick={(e) => openEdit(p, e)}
                    title="Edit project"
                    style={{
                      flexShrink: 0, padding: '0 10px', height: '100%', minHeight: 34,
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: 'var(--color-text-faint)',
                    }}
                  >
                    ✎
                  </button>
                </div>
              ))}

              {selectedIsArchived && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button style={{ ...pickerItemStyle(true), cursor: 'default', flex: 1 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: selectedProject!.color, flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)', flex: 1 }}>{selectedProject!.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>archived ✓</span>
                  </button>
                  <button
                    onClick={(e) => openEdit(selectedProject!, e)}
                    title="Edit project"
                    style={{
                      flexShrink: 0, padding: '0 10px', height: '100%', minHeight: 34,
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: 'var(--color-text-faint)',
                    }}
                  >
                    ✎
                  </button>
                </div>
              )}

              {mode === 'create' ? ProjectForm : (
                <button
                  onClick={openCreate}
                  style={{ ...pickerItemStyle(false), borderTop: '1px solid var(--color-border)' }}
                >
                  <span style={{ fontSize: 13, color: 'var(--color-accent)' }}>+ New project</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
