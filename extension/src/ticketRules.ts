import type { TicketRef } from '@pomodoso/types';
import type { DetectionRuleRow } from './db';

// Providers with a native content script (richer extraction: status, og:title…).
// The generic matcher must not shadow them — their detection is gated separately
// in the background by the same rules.
const NATIVE_PRESETS = new Set(['linear', 'github', 'sentry', 'arxiv']);

/** Generic rule-driven detection: matches the active tab URL against the user's
 *  detection rules (custom rules and presets without a native content script).
 *  Capture group 1 of the pattern, if present, becomes the ticket id. */
export function detectTicketFromRules(
  rules: DetectionRuleRow[],
  url: string,
  title: string,
): TicketRef | null {
  if (!/^https?:/i.test(url)) return null;

  for (const rule of rules) {
    if (!rule.active || rule.deletedAt) continue;
    if (rule.kind === 'preset' && rule.presetId && NATIVE_PRESETS.has(rule.presetId)) continue;

    let re: RegExp;
    try {
      re = new RegExp(rule.urlPattern, 'i');
    } catch {
      continue; // invalid user pattern — skip
    }
    const m = url.match(re);
    if (!m) continue;

    const externalId = (m[1] ?? '').toUpperCase();
    // Page titles usually end in "… | Site" or "… · Site" — drop that suffix.
    const cleanTitle = title.replace(/\s*[|·]\s*[^|·]*$/, '').trim() || title.trim();

    return {
      provider_kind: 'custom',
      external_id: externalId,
      external_url: url,
      title: cleanTitle || externalId || url,
    };
  }
  return null;
}

/** Background gate for native content-script detections: the matching preset
 *  rule must be active and its pattern must match the ticket URL. */
export function providerRuleAllows(rules: DetectionRuleRow[], ticket: TicketRef): boolean {
  const rule = rules.find(r => !r.deletedAt && r.kind === 'preset' && r.presetId === ticket.provider_kind);
  if (!rule) return true; // provider without a rule row — allow
  if (!rule.active) return false;
  try {
    if (!new RegExp(rule.urlPattern, 'i').test(ticket.external_url)) return false;
  } catch {
    // invalid user-edited pattern — don't silently kill native detection
  }
  return true;
}
