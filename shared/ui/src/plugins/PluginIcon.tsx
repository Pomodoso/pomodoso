// A plugin's `icon` is a plain word from the file. Known words get a glyph;
// anything else shows the plugin's initial, so a file can never load an
// image or markup through its icon.

const GLYPHS: Record<string, string> = {
  book: '📚',
  bookmark: '🔖',
  film: '🎬',
  movie: '🎬',
  grid: '🟩',
  'no-smoking': '🚭',
  smoking: '🚬',
  water: '💧',
  coffee: '☕',
  run: '🏃',
  heart: '❤️',
  mood: '🙂',
  sleep: '😴',
  money: '💰',
  music: '🎵',
  game: '🎮',
  plant: '🌱',
  pill: '💊',
  food: '🍎',
  star: '⭐',
  check: '✅',
  calendar: '📅',
  pen: '✏️',
  link: '🔗',
  code: '💻',
  brain: '🧠',
  dumbbell: '🏋️',
};

export function PluginIcon({ icon, name, size = 28 }: { icon?: string | undefined; name: string; size?: number }) {
  // Own keys only: `icon: __proto__` must fall back to the initial, not reach Object.prototype.
  const glyph = icon && Object.hasOwn(GLYPHS, icon) ? GLYPHS[icon] : undefined;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-accent-soft)',
        color: 'var(--color-accent)',
        fontSize: glyph ? size * 0.55 : size * 0.45,
        fontWeight: 700,
      }}
    >
      {glyph ?? name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
