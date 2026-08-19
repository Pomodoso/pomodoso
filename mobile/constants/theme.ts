// Same design tokens as docs/mockups/mobile/*.html — keep in sync until this
// becomes a shared package consumed by more than one native client.
export const colors = {
  bg: '#FBFAF7',
  surface: '#FFFFFF',
  border: '#E8E5DD',
  borderStrong: '#D6D2C8',
  text: '#1A1A17',
  textSecondary: '#5F5D55',
  textTertiary: '#98948A',
  accent: '#C8553D',
  accentSoft: '#FAEEEA',
  success: '#4A7C4A',
  successSoft: '#EBF1E9',
  warning: '#B07A1F',
  warningSoft: '#FAF1DE',
  info: '#4A6FA5',
  infoSoft: '#E9EFF7',
  delayed: '#7B5DB4', // matches extension's TaskStatus 'delayed' — no existing token fit
  delayedSoft: '#F1ECF9',
  break: '#2E8B8B', // extension's badge color scheme: "break = teal"
  breakSoft: '#E7F3F3',
} as const;

export const fontMono = 'SpaceMono-Regular';
