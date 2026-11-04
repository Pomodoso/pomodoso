// Plugin components, on their own entry (`@pomodoso/ui/plugins`) so the main
// one doesn't pull in the plugin engine.

export { PluginView, type PluginActions, type PluginEnv, type PluginTasks } from './PluginView.js';
export { FieldInput, RecordForm, type FieldChoice } from './RecordForm.js';
export { BreakdownBars, Legend, SeriesChart, YearGrid } from './charts.js';
export { PluginIcon } from './PluginIcon.js';
export { TodayWidget, type TodayWidgetProps } from './TodayWidget.js';
