// Habit icon KEYS (the 7-icon set the extension and mobile pickers store) mapped
// to the Tabler classes and colours the dashboard renders them with.
//
// TodayPage and HabitsPage each had their own identical copy; the challenge card
// renders on both, which made a third copy the alternative to this file.

const ICON_CLASS: Record<string, string> = {
  water: 'ti-glass-full',
  fitness: 'ti-barbell',
  book: 'ti-book-2',
  sleep: 'ti-moon',
  run: 'ti-run',
  meditate: 'ti-yin-yang',
  journal: 'ti-notebook',
};

const ICON_COLOR: Record<string, string> = {
  water: 'var(--info)',
  fitness: 'var(--text-sec)',
  book: 'var(--warning)',
  sleep: '#7B5DB4',
  run: 'var(--success)',
  meditate: 'var(--accent)',
  journal: 'var(--text-sec)',
};

export function habitIconClass(icon: string): string {
  return ICON_CLASS[icon] ?? 'ti-check';
}

export function habitIconColor(icon: string): string {
  return ICON_COLOR[icon] ?? 'var(--text-sec)';
}
