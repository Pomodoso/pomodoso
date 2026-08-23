import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/AuthContext.tsx';
import { HabitsActivityHeatmap } from '../../components/HabitsActivityHeatmap.tsx';

// ─── Types ─────────────────────────────────────────────────────────────────────
// Habits are user-global (CLAUDE.md rule 6) — unlike every other dashboard
// page, this one takes no workspaceId.

interface Habit {
  id: string;
  name: string;
  icon: string;
  kind: 'boolean' | 'counter';
  target_count: number | null;
  frequency: 'daily' | 'weekdays' | 'custom';
  frequency_days: string | null; // JSON number[], 0=Mon..6=Sun
  unit: string | null;
  unit_amount: number | null;
  log_value: number;
  log_done: boolean;
}

interface HabitFormValue {
  name: string;
  icon: string;
  kind: 'boolean' | 'counter';
  target_count: number | null;
  frequency: 'daily' | 'weekdays' | 'custom';
  frequency_days: string | null;
  unit: string | null;
  unit_amount: number | null;
}

// Same 7-icon set as the extension/mobile habit picker (HABIT_ICON_OPTIONS) —
// icon KEYS stored on the habit, mapped to Tabler classes for display.
const ICONS = ['water', 'fitness', 'book', 'sleep', 'run', 'meditate', 'journal'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function habitIconClass(icon: string): string {
  const map: Record<string, string> = {
    water: 'ti-glass-full', fitness: 'ti-barbell', book: 'ti-book-2', sleep: 'ti-moon',
    run: 'ti-run', meditate: 'ti-yin-yang', journal: 'ti-notebook',
  };
  return map[icon] ?? 'ti-check';
}

function habitIconColor(icon: string): string {
  const map: Record<string, string> = {
    water: 'var(--info)', fitness: 'var(--text-sec)', book: 'var(--warning)', sleep: '#7B5DB4',
    run: 'var(--success)', meditate: 'var(--accent)', journal: 'var(--text-sec)',
  };
  return map[icon] ?? 'var(--text-sec)';
}

function scheduleLabel(habit: Pick<Habit, 'frequency' | 'frequency_days'>): string {
  if (habit.frequency === 'daily') return 'Every day';
  if (habit.frequency === 'weekdays') return 'Weekdays';
  try {
    const days = JSON.parse(habit.frequency_days ?? '[]') as number[];
    return days.map(d => DAY_LABELS[d]).join(' ');
  } catch {
    return 'Custom';
  }
}

const EMPTY_FORM: HabitFormValue = {
  name: '', icon: 'water', kind: 'boolean', target_count: null,
  frequency: 'daily', frequency_days: null, unit: null, unit_amount: null,
};

// ─── Form ──────────────────────────────────────────────────────────────────────

function HabitForm({ initial, onSave, onCancel }: {
  initial: HabitFormValue;
  onSave: (value: HabitFormValue) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [customDays, setCustomDays] = useState<number[]>(() => {
    try { return JSON.parse(initial.frequency_days ?? '[]') as number[]; } catch { return []; }
  });

  const toggleDay = (day: number) => {
    setCustomDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)));
  };

  const handleSave = async () => {
    if (!value.name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...value,
        name: value.name.trim(),
        frequency_days: value.frequency === 'custom' ? JSON.stringify(customDays) : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pomo-card" style={{ marginBottom: 16 }}>
      <input
        className="pomo-input"
        placeholder="Habit name"
        value={value.name}
        onChange={e => setValue(v => ({ ...v, name: e.target.value }))}
        style={{ width: '100%', marginBottom: 12 }}
        autoFocus
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {ICONS.map(icon => (
          <button
            key={icon}
            onClick={() => setValue(v => ({ ...v, icon }))}
            style={{
              width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `2px solid ${value.icon === icon ? 'var(--accent)' : 'var(--border)'}`,
              background: 'var(--surface)', cursor: 'pointer',
            }}
          >
            <i className={`ti ${habitIconClass(icon)}`} style={{ fontSize: 15, color: habitIconColor(icon) }} />
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['boolean', 'counter'] as const).map(kind => (
          <button
            key={kind}
            className="pomo-btn"
            style={kind === value.kind ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            onClick={() => setValue(v => ({ ...v, kind }))}
          >
            {kind === 'boolean' ? 'Checkbox' : 'Counter'}
          </button>
        ))}
      </div>

      {value.kind === 'counter' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="pomo-input"
            type="number"
            placeholder="Goal"
            value={value.target_count ?? ''}
            onChange={e => setValue(v => ({ ...v, target_count: e.target.value ? Number(e.target.value) : null }))}
            style={{ width: 90 }}
          />
          <input
            className="pomo-input"
            type="number"
            placeholder="Amount/step"
            value={value.unit_amount ?? ''}
            onChange={e => setValue(v => ({ ...v, unit_amount: e.target.value ? Number(e.target.value) : null }))}
            style={{ width: 110 }}
          />
          <input
            className="pomo-input"
            placeholder="Unit (ml)"
            value={value.unit ?? ''}
            onChange={e => setValue(v => ({ ...v, unit: e.target.value || null }))}
            style={{ width: 90 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: value.frequency === 'custom' ? 8 : 16 }}>
        {(['daily', 'weekdays', 'custom'] as const).map(f => (
          <button
            key={f}
            className="pomo-btn"
            style={f === value.frequency ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            onClick={() => setValue(v => ({ ...v, frequency: f }))}
          >
            {f === 'daily' ? 'Every day' : f === 'weekdays' ? 'Weekdays' : 'Custom'}
          </button>
        ))}
      </div>

      {value.frequency === 'custom' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {DAY_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => toggleDay(i)}
              className="pomo-btn"
              style={{
                flex: 1, justifyContent: 'center',
                ...(customDays.includes(i) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}),
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="pomo-btn pomo-btn-primary" onClick={() => void handleSave()} disabled={saving || !value.name.trim()}>
          Save
        </button>
        <button className="pomo-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────────

function HabitRow({ habit, onToggle, onIncrement, onEdit, onDelete }: {
  habit: Habit;
  onToggle: (habit: Habit) => void;
  onIncrement: (habit: Habit, delta: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <i className={`ti ${habitIconClass(habit.icon)}`} style={{ fontSize: 18, color: habitIconColor(habit.icon), width: 20 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{habit.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>{scheduleLabel(habit)}</div>
      </div>

      {habit.kind === 'counter' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="pomo-btn pomo-btn-icon" onClick={() => onIncrement(habit, -1)} aria-label="Decrease">
              <i className="ti ti-minus" />
            </button>
            <span style={{ fontSize: 12.5, minWidth: 40, textAlign: 'center', color: habit.log_done ? 'var(--success)' : 'var(--text)' }}>
              {habit.log_value}/{habit.target_count ?? 0}
            </span>
            <button className="pomo-btn pomo-btn-icon" onClick={() => onIncrement(habit, 1)} aria-label="Increase">
              <i className="ti ti-plus" />
            </button>
          </div>
          {habit.unit && habit.unit_amount && (
            <span style={{ fontSize: 10, color: habit.log_done ? 'var(--success)' : 'var(--text-tert)', fontVariantNumeric: 'tabular-nums' }}>
              {habit.log_value * habit.unit_amount}/{(habit.target_count ?? 1) * habit.unit_amount}{habit.unit}
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {habit.unit && habit.unit_amount && (
            <span style={{ fontSize: 11, color: 'var(--text-tert)' }}>
              {habit.unit_amount}{habit.unit}
            </span>
          )}
          <button
            onClick={() => onToggle(habit)}
            aria-label="Toggle done"
            style={{
              width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
              border: `1.5px solid ${habit.log_done ? 'var(--success)' : 'var(--border-strong)'}`,
              background: habit.log_done ? 'var(--success)' : 'var(--surface)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {habit.log_done && <i className="ti ti-check" style={{ fontSize: 14, color: '#fff' }} />}
          </button>
        </div>
      )}

      <button className="pomo-btn pomo-btn-icon" aria-label="Edit habit" onClick={onEdit}>
        <i className="ti ti-pencil" />
      </button>

      {confirmDelete ? (
        <button
          className="pomo-btn"
          style={{ fontSize: 11, padding: '4px 8px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
          onClick={onDelete}
          onBlur={() => setConfirmDelete(false)}
          autoFocus
        >
          Confirm
        </button>
      ) : (
        <button className="pomo-btn pomo-btn-icon" aria-label="Delete habit" onClick={() => setConfirmDelete(true)}>
          <i className="ti ti-trash" />
        </button>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function HabitsPage() {
  const { user } = useAuth();
  const minYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    api
      .get<Habit[]>('/habits')
      .then(setHabits)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const todayStr = () => new Date().toLocaleDateString('en-CA');

  const handleCreate = async (value: HabitFormValue) => {
    const habit = await api.post<Habit>('/habits', value);
    setHabits(prev => [...(prev ?? []), habit]);
    setAdding(false);
  };

  const handleUpdate = async (id: string, value: HabitFormValue) => {
    const habit = await api.patch<Habit>(`/habits/${id}`, value);
    setHabits(prev => (prev ?? []).map(h => (h.id === id ? { ...habit, log_value: h.log_value, log_done: h.log_done } : h)));
    setEditingId(null);
  };

  const handleToggle = (habit: Habit) => {
    const done = !habit.log_done;
    setHabits(prev => (prev ?? []).map(h => (h.id === habit.id ? { ...h, log_done: done } : h)));
    api.post(`/habits/${habit.id}/log`, { date: todayStr(), value: done ? 1 : 0, done }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to save');
      refresh();
    });
  };

  const handleIncrement = (habit: Habit, delta: number) => {
    const value = Math.max(0, habit.log_value + delta);
    const done = habit.target_count != null && value >= habit.target_count;
    setHabits(prev => (prev ?? []).map(h => (h.id === habit.id ? { ...h, log_value: value, log_done: done } : h)));
    api.post(`/habits/${habit.id}/log`, { date: todayStr(), value, done }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to save');
      refresh();
    });
  };

  const handleDelete = (id: string) => {
    api.del(`/habits/${id}`).then(() => {
      setHabits(prev => (prev ?? []).filter(h => h.id !== id));
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to delete'));
  };

  const editingHabit = habits?.find(h => h.id === editingId);

  return (
    <>
      <div className="pomo-page-header">
        <div>
          <div className="pomo-eyebrow">Settings</div>
          <h1 className="pomo-page-title">Habits</h1>
        </div>
        {!adding && !editingId && (
          <button className="pomo-btn pomo-btn-primary" onClick={() => setAdding(true)}>
            <i className="ti ti-plus" /> New habit
          </button>
        )}
      </div>

      {error && <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {adding && (
        <HabitForm initial={EMPTY_FORM} onSave={handleCreate} onCancel={() => setAdding(false)} />
      )}

      {editingHabit && (
        <HabitForm
          initial={{
            name: editingHabit.name, icon: editingHabit.icon, kind: editingHabit.kind,
            target_count: editingHabit.target_count, frequency: editingHabit.frequency,
            frequency_days: editingHabit.frequency_days, unit: editingHabit.unit, unit_amount: editingHabit.unit_amount,
          }}
          onSave={value => handleUpdate(editingHabit.id, value)}
          onCancel={() => setEditingId(null)}
        />
      )}

      <div className="pomo-card" style={{ maxWidth: 560 }}>
        {loading ? (
          <div style={{ color: 'var(--text-tert)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
        ) : !habits || habits.length === 0 ? (
          <div className="pomo-empty">
            <i className="ti ti-checkup-list" />
            No habits yet.
          </div>
        ) : (
          habits.map(h => (
            <HabitRow
              key={h.id}
              habit={h}
              onToggle={handleToggle}
              onIncrement={handleIncrement}
              onEdit={() => setEditingId(h.id)}
              onDelete={() => handleDelete(h.id)}
            />
          ))
        )}
      </div>

      {habits && habits.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Activity</h2>
          <div className="pomo-card">
            <HabitsActivityHeatmap minYear={minYear} />
          </div>
        </div>
      )}
    </>
  );
}
