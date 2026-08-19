// Ionicons names, not a 1:1 port of extension's icon set (extension bundles
// its own custom icon sprites keyed by a semantic HabitIconKind — mobile
// already just stores a raw Ionicons name directly, see seeded habits in
// db/client.ts, so this is a comparable fixed set rather than an exact
// cross-library match).
export const HABIT_ICON_OPTIONS = ['water', 'walk', 'book', 'moon', 'barbell', 'nutrition', 'bicycle', 'body'] as const;
