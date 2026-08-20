import * as AuthSession from 'expo-auth-session';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { meeting } from '@/db/schema';
import type { MeetingTrackMode } from '@/db/schema';
import { getChunkedItem, removeChunkedItem, setChunkedItem } from '@/utils/secureStore';
import { uid } from '@/utils/id';
import { parseMeetingTime } from '@/utils/meetingTime';
import { triggerSync } from '@/utils/sync';

// Mirrors extension/src/calendarSync.ts's client-side-direct-to-Google
// approach — mobile's OAuth client is an "iOS" application type (PKCE, no
// secret; Google doesn't issue one for native app client types, unlike the
// extension's "Desktop app" client which does), registered in the same
// Google Cloud project. See ADR 0002 (docs/decisions/, corrected 2026-08-20
// — the calendar CONNECTION itself is deliberately per-device, never
// synced; only the resulting `meeting` rows are, via utils/sync.ts, shipped
// in Fase B6a).
const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
// Google's documented redirect scheme for iOS-type OAuth clients — the
// reverse-DNS form of the client id, registered as an additional app.json
// `scheme` entry so ASWebAuthenticationSession can catch the redirect
// before it ever reaches expo-router's own linking. Derived rather than
// duplicated as a second hardcoded literal/env var — the transformation is
// Google's own fixed convention, not something that can drift on its own.
const REVERSED_CLIENT_ID = CLIENT_ID ? `com.googleusercontent.apps.${CLIENT_ID.replace('.apps.googleusercontent.com', '')}` : undefined;

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

export interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

export interface CalendarConnection {
  email: string;
  connectedAt: string;
  selectedCalendarIds: string[];
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number; // Unix ms
}

// ─── Storage — deliberately local-only, never synced (see file header) ────────

async function readRecord<T>(key: string): Promise<Record<string, T>> {
  const raw = await getChunkedItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, T>;
  } catch {
    return {};
  }
}

async function writeRecord<T>(key: string, wsId: string, value: T): Promise<void> {
  const record = await readRecord<T>(key);
  record[wsId] = value;
  await setChunkedItem(key, JSON.stringify(record));
}

async function deleteFromRecord(key: string, wsId: string): Promise<void> {
  const record = await readRecord(key);
  delete record[wsId];
  const remaining = Object.keys(record).length;
  if (remaining === 0) {
    await removeChunkedItem(key);
  } else {
    await setChunkedItem(key, JSON.stringify(record));
  }
}

export async function getCalendarConnection(wsId: string): Promise<CalendarConnection | null> {
  const record = await readRecord<CalendarConnection>('calendar_connections');
  return record[wsId] ?? null;
}

export async function getAllCalendarConnections(): Promise<Record<string, CalendarConnection>> {
  return readRecord<CalendarConnection>('calendar_connections');
}

export async function getCalendarList(wsId: string): Promise<CalendarInfo[]> {
  const record = await readRecord<CalendarInfo[]>('calendar_lists');
  return record[wsId] ?? [];
}

export async function updateSelectedCalendars(wsId: string, ids: string[]): Promise<void> {
  const conn = await getCalendarConnection(wsId);
  if (!conn) return;
  await writeRecord('calendar_connections', wsId, { ...conn, selectedCalendarIds: ids });
}

export async function getCalendarLastSynced(wsId: string): Promise<string | null> {
  const record = await readRecord<string>('calendar_last_synced');
  return record[wsId] ?? null;
}

// ─── OAuth2 — expo-auth-session, PKCE ──────────────────────────────────────────

function redirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: REVERSED_CLIENT_ID });
}

// Returns a valid access token for the given workspace, refreshing if
// needed. Returns null if no connection exists or refresh fails (the caller
// should treat this the same as "not connected" — the UI's reconnect button
// is the recovery path, matching extension's own silent-abort-on-refresh-
// failure behavior).
async function getValidToken(wsId: string): Promise<string | null> {
  if (!CLIENT_ID) return null;
  const conn = await getCalendarConnection(wsId);
  if (!conn) return null;

  if (conn.tokenExpiry > Date.now() + 60_000) {
    return conn.accessToken;
  }

  try {
    const refreshed = await AuthSession.refreshAsync({ clientId: CLIENT_ID, refreshToken: conn.refreshToken }, discovery);
    const updated: CalendarConnection = {
      ...conn,
      accessToken: refreshed.accessToken,
      tokenExpiry: Date.now() + (refreshed.expiresIn ?? 3600) * 1000,
    };
    await writeRecord('calendar_connections', wsId, updated);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}

export async function connectCalendar(wsId: string): Promise<{ connection: CalendarConnection; calendars: CalendarInfo[] }> {
  if (!CLIENT_ID) throw new Error('Google Calendar is not configured on this build.');

  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID,
    scopes: CALENDAR_SCOPES,
    redirectUri: redirectUri(),
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    // access_type=offline is required to get a refresh_token at all;
    // prompt forces the account picker + consent screen every time (rather
    // than silently reusing a prior grant) so re-running connect always
    // yields a fresh refresh_token even if the user connected before and
    // later disconnected — same combination extension's own connectCalendar
    // uses (calendarSync.ts).
    extraParams: { access_type: 'offline' },
    prompt: [AuthSession.Prompt.Consent, AuthSession.Prompt.SelectAccount],
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') {
    throw new Error(result.type === 'error' ? (result.error?.message ?? 'Authorization failed.') : 'Authorization cancelled.');
  }
  const code = result.params.code;
  if (!code) throw new Error('No authorization code received.');

  const tokenResult = await AuthSession.exchangeCodeAsync(
    {
      clientId: CLIENT_ID,
      code,
      redirectUri: redirectUri(),
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
    },
    discovery,
  );

  if (!tokenResult.refreshToken) {
    throw new Error('Google did not grant offline access — try again and make sure to approve the full permission request.');
  }

  const [profileRes, calListRes] = await Promise.all([
    fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokenResult.accessToken}` } }),
    fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100', {
      headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
    }),
  ]);

  if (!calListRes.ok) {
    throw new Error(`Google Calendar access was not granted (HTTP ${calListRes.status}). Please try again and make sure to check the calendar permission box.`);
  }

  const profile = (await profileRes.json()) as { email?: string };
  const calList = (await calListRes.json()) as { items?: CalendarInfo[] };
  const calendars: CalendarInfo[] = (calList.items ?? []).map(c => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary,
    backgroundColor: c.backgroundColor,
  }));

  const connection: CalendarConnection = {
    email: profile.email ?? '',
    connectedAt: new Date().toISOString(),
    selectedCalendarIds: calendars.filter(c => c.primary).map(c => c.id),
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    tokenExpiry: Date.now() + (tokenResult.expiresIn ?? 3600) * 1000,
  };

  await writeRecord('calendar_connections', wsId, connection);
  await writeRecord('calendar_lists', wsId, calendars);

  return { connection, calendars };
}

// Three sequential SecureStore writes, not atomic — unlike extension's
// equivalent (a single Dexie `db.transaction('rw', db.settings, ...)`
// across one table), SecureStore has no multi-key transaction primitive to
// wrap these in. A failure between deletes could in principle leave
// calendar_connections gone but calendar_lists/calendar_last_synced still
// present — harmless (they're only ever read alongside a connection that
// no longer exists, per getCalendarConnection/getCalendarList's callers)
// but a known, accepted gap rather than a silent one. The caller (UI) is
// responsible for surfacing a thrown error to the user; this function
// itself doesn't swallow anything.
export async function disconnectCalendar(wsId: string): Promise<void> {
  const conn = await getCalendarConnection(wsId);
  if (conn && CLIENT_ID) {
    AuthSession.revokeAsync({ token: conn.accessToken, clientId: CLIENT_ID }, discovery).catch(() => {});
  }
  await deleteFromRecord('calendar_connections', wsId);
  await deleteFromRecord('calendar_lists', wsId);
  await deleteFromRecord('calendar_last_synced', wsId);
}

// ─── Sync ───────────────────────────────────────────────────────────────────

interface GoogleEventItem {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

// Fetches today's events from every selected calendar and upserts them into
// the local `meeting` table, matching extension's syncTodayMeetings — same
// upsert-by-googleEventId semantics, same "never touch trackMode/projectId/
// notes on re-import" rule, same soft-delete-if-no-longer-returned pass.
// Local device timezone (not a stored setting — mobile has no per-workspace
// timezone field the extension does) determines "today"'s boundaries.
export async function syncTodayMeetings(wsId: string): Promise<void> {
  const token = await getValidToken(wsId);
  if (!token) return;

  const conn = await getCalendarConnection(wsId);
  if (!conn || conn.selectedCalendarIds.length === 0) return;

  const calList = await getCalendarList(wsId);
  const calInfo = new Map(calList.map(c => [c.id, c]));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const timeMin = todayStart.toISOString();
  const timeMax = todayEnd.toISOString();

  const seenGoogleIds = new Set<string>();
  // Calendars whose fetch didn't fully succeed this cycle (an HTTP error on
  // any page, so seenGoogleIds is incomplete for it) — the stale-deletion
  // pass below must skip these calendars' meetings entirely, or an
  // incomplete seenGoogleIds would make every one of their still-real
  // events look "no longer returned" and get wrongly soft-deleted.
  const failedCalendarIds = new Set<string>();
  let wroteAny = false;

  for (const calendarId of conn.selectedCalendarIds) {
    let pageToken: string | undefined;
    let calendarFailed = false;

    do {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '50');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        calendarFailed = true;
        break;
      }

      const data = (await res.json()) as { items?: GoogleEventItem[]; nextPageToken?: string };
      for (const item of data.items ?? []) {
        if (item.status === 'cancelled') continue;
        const googleEventId = item.id;
        seenGoogleIds.add(googleEventId);

        const startStr = item.start?.dateTime ?? item.start?.date ?? timeMin;
        const endStr = item.end?.dateTime ?? item.end?.date ?? startStr;
        const durationMinutes = Math.round((parseMeetingTime(endStr).getTime() - parseMeetingTime(startStr).getTime()) / 60_000);
        const recurringEventId = item.recurringEventId;
        const cal = calInfo.get(calendarId);
        const nowIso = new Date().toISOString();

        // Scoped by workspaceId too, not just googleEventId — the same
        // Google event could otherwise be visible to (and get imported
        // into) two different workspaces if the same calendar were ever
        // selected in both, and an unscoped lookup would let the second
        // workspace's sync overwrite the first's row instead of creating
        // its own (Greptile P1, security).
        const existing = db
          .select()
          .from(meeting)
          .where(and(eq(meeting.workspaceId, wsId), eq(meeting.googleEventId, googleEventId)))
          .all()[0];
        wroteAny = true;

        if (existing) {
          db.update(meeting)
            .set({
              title: item.summary ?? '(no title)',
              time: startStr,
              durationMinutes,
              description: item.description ?? null,
              calendarId,
              // Only overwrite the cached name/color when the calendar list
              // actually resolved this cycle — a momentarily-missing
              // calendar_lists entry shouldn't clobber a previously-good
              // cached name with the raw id (matches extension's own guard).
              ...(cal ? { calendarName: cal.summary, ...(cal.backgroundColor ? { calendarColor: cal.backgroundColor } : {}) } : {}),
              ...(recurringEventId ? { recurringEventId } : {}),
              deletedAt: null,
              updatedAt: nowIso,
            })
            .where(eq(meeting.id, existing.id))
            .run();
        } else {
          let inheritedTrackMode: MeetingTrackMode = 'off';
          if (recurringEventId) {
            const priorOccurrences = db
              .select()
              .from(meeting)
              .where(and(eq(meeting.recurringEventId, recurringEventId), isNull(meeting.deletedAt), eq(meeting.workspaceId, wsId)))
              .all();
            const mostRecent = priorOccurrences.sort((a, b) => b.time.localeCompare(a.time))[0];
            if (mostRecent?.trackMode === 'always') inheritedTrackMode = 'always';
          }
          db.insert(meeting)
            .values({
              id: uid(),
              workspaceId: wsId,
              title: item.summary ?? '(no title)',
              time: startStr,
              durationMinutes,
              description: item.description ?? null,
              trackMode: inheritedTrackMode,
              logged: false,
              notes: '',
              projectId: null,
              googleEventId,
              recurringEventId: recurringEventId ?? null,
              calendarId,
              calendarName: cal?.summary ?? calendarId,
              calendarColor: cal?.backgroundColor ?? null,
              createdAt: nowIso,
              updatedAt: nowIso,
            })
            .run();
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    if (calendarFailed) failedCalendarIds.add(calendarId);
  }

  // Soft-delete Google-sourced meetings for today that are no longer
  // returned (cancelled/moved off today) — parseMeetingTime handles the
  // bare all-day-date case the same way the fetch itself does, so a
  // same-day all-day event isn't spuriously treated as "gone". Meetings
  // from a calendar whose fetch failed this cycle are skipped entirely —
  // seenGoogleIds is necessarily incomplete for that calendar, so treating
  // its absence-from-the-set as "deleted on Google" would be wrong.
  const candidates = db
    .select()
    .from(meeting)
    .where(and(eq(meeting.workspaceId, wsId), isNull(meeting.deletedAt), isNotNull(meeting.googleEventId)))
    .all();
  const staleNowIso = new Date().toISOString();
  for (const m of candidates) {
    if (!m.googleEventId || seenGoogleIds.has(m.googleEventId)) continue;
    if (m.calendarId && failedCalendarIds.has(m.calendarId)) continue;
    const t = parseMeetingTime(m.time);
    if (t < todayStart || t > todayEnd) continue;
    db.update(meeting).set({ deletedAt: staleNowIso, updatedAt: staleNowIso }).where(eq(meeting.id, m.id)).run();
    wroteAny = true;
  }

  await writeRecord('calendar_last_synced', wsId, new Date().toISOString());
  if (wroteAny) triggerSync();
}

// Syncs every workspace that has a calendar connection — call on app
// foreground/cold-start, mirroring extension's "popup open -> sync all
// connected workspaces" behavior (App.tsx).
export async function syncAllConnectedWorkspaces(): Promise<void> {
  const conns = await getAllCalendarConnections();
  await Promise.all(Object.keys(conns).map(wsId => syncTodayMeetings(wsId)));
}
