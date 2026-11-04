// Plugins: declarative YAML mini-apps. Kept out of the package's main entry
// (`@pomodoso/types/plugins`) so importing a plain type never pulls in the
// YAML parser or zod.

export * from './catalog.ts';
export { createEvaluator, type EvalContext, type PluginEvaluator, type PluginRecord, type PluginValue, type SeriesPoint } from './compute.ts';
export { checkManifest, optionValue } from './check.ts';
export { checkUpdate, compareVersions, diffManifests, type ChangeKind, type ManifestChange, type UpdateReport } from './diff.ts';
export { PLUGIN_JSON_SCHEMA_URL, pluginJsonSchema } from './json-schema.ts';
export { PLUGIN_EXPORT_VERSION, parsePluginExport, serializePluginExport, type PluginExport, type PluginExportResult } from './export.ts';
export { PLUGIN_DAILY_NAMESPACE, dailyRecordId, uuidV5 } from './ids.ts';
export { didYouMean, formatPath, type PluginIssue } from './issues.ts';
export * from './manifest.ts';
export { applyMigration, type MigrationResult } from './migrate.ts';
export { parsePluginFile, validatePluginData, type PluginParseResult } from './parse.ts';
export { addDays, localDayOf } from './dates.ts';
export { applyRules, fieldLabel, fieldOptions, formatMinutes, formatStat, humanize, initialRecordData, missingFields, normalizeOption, optionsSettingKey, reportLines, showsOnToday, templateFormat, SHOW_ON_TODAY_KEY, type PluginOption } from './view.ts';
export { STARTER_PROMPT, TOP_LEVEL_DOCS, llmsFullTxt, llmsTxt, remixPrompt } from './llms.ts';
export { BLOCK_DOCS, COLLECTION_DOCS, COMPUTED_DOCS, FIELD_DOCS, FORMAT_DOCS, HOOK_DOCS, WIDGET_DOCS } from './docs.ts';
export { GUIDE_BLOCK_EXAMPLES, GUIDE_COMPUTED_EXAMPLES, GUIDE_FIRST_APP, GUIDE_HOOK_EXAMPLES, GUIDE_PLAYGROUND, GUIDE_WIDGET_EXAMPLES, guideManifestData, guideSeedRecords } from './guide.ts';
