// Plugins: declarative YAML mini-apps. Kept out of the package's main entry
// (`@pomodoso/types/plugins`) so importing a plain type never pulls in the
// YAML parser or zod.

export * from './catalog.ts';
export { createEvaluator, type EvalContext, type PluginEvaluator, type PluginRecord, type PluginValue, type SeriesPoint } from './compute.ts';
export { checkManifest, optionValue } from './check.ts';
export { didYouMean, formatPath, type PluginIssue } from './issues.ts';
export * from './manifest.ts';
export { parsePluginFile, validatePluginData, type PluginParseResult } from './parse.ts';
