import { db, now, type MeetingRow, type MeetingTrackMode } from './db';

// Desktop app OAuth2 credentials — safe to embed (Google explicitly allows this for installed apps).
// Set VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_SECRET in .env.development or .env.production.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

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

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function readRecord<T>(key: string): Promise<Record<string, T>> {
  const row = await db.settings.get(key);
  return (row?.value as Record<string, T> | undefined) ?? {};
}

async function writeRecord<T>(key: string, wsId: string, value: T): Promise<void> {
  const record = await readRecord<T>(key);
  record[wsId] = value;
  await db.settings.put({ key, value: record });
}

async function deleteFromRecord(key: string, wsId: string): Promise<void> {
  const record = await readRecord(key);
  delete record[wsId];
  await db.settings.put({ key, value: record });
}

// ─── OAuth2 — launchWebAuthFlow ───────────────────────────────────────────────

async function exchangeCodeForTokens(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data;
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data;
}

// Returns a valid access token for the given workspace, refreshing if needed.
// Returns null if no connection exists or refresh fails (user must reconnect).
async function getValidToken(wsId: string): Promise<string | null> {
  const conn = await getCalendarConnection(wsId);
  if (!conn) return null;

  // Token still valid with 60s buffer
  if (conn.tokenExpiry > Date.now() + 60_000) {
    return conn.accessToken;
  }

  try {
    const { access_token, expires_in } = await refreshAccessToken(conn.refreshToken);
    const updated: CalendarConnection = {
      ...conn,
      accessToken: access_token,
      tokenExpiry: Date.now() + expires_in * 1000,
    };
    await writeRecord('calendar_connections', wsId, updated);
    return access_token;
  } catch {
    return null;
  }
}

// ─── Per-workspace API ────────────────────────────────────────────────────────

export async function connectCalendar(wsId: string): Promise<{ connection: CalendarConnection; calendars: CalendarInfo[] }> {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', CALENDAR_SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'select_account consent');

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, url => {
      if (chrome.runtime.lastError || !url) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Authorization cancelled.'));
      } else {
        resolve(url);
      }
    });
  });

  const code = new URL(responseUrl).searchParams.get('code');
  if (!code) throw new Error('No authorization code received.');

  const tokens = await exchangeCodeForTokens(code);

  const [profileRes, calListRes] = await Promise.all([
    fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }),
    fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }),
  ]);

  if (!calListRes.ok) {
    throw new Error(`Google Calendar access was not granted (HTTP ${calListRes.status}). Please try again and make sure to check the calendar permission box.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile: any = await profileRes.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calList: any = await calListRes.json();

  const email: string = profile.email ?? '';
  const calendars: CalendarInfo[] = (calList.items ?? []).map((c: { id: string; summary: string; primary?: boolean; backgroundColor?: string }) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary,
    backgroundColor: c.backgroundColor,
  }));

  const connection: CalendarConnection = {
    email,
    connectedAt: now(),
    selectedCalendarIds: calendars.filter(c => c.primary).map(c => c.id),
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: Date.now() + tokens.expires_in * 1000,
  };

  await db.transaction('rw', db.settings, async () => {
    await writeRecord('calendar_connections', wsId, connection);
    await writeRecord('calendar_lists', wsId, calendars);
  });

  return { connection, calendars };
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

export async function disconnectCalendar(wsId: string): Promise<void> {
  const conn = await getCalendarConnection(wsId);
  if (conn) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(conn.accessToken)}`).catch(() => {});
  }

  await db.transaction('rw', db.settings, async () => {
    await deleteFromRecord('calendar_connections', wsId);
    await deleteFromRecord('calendar_lists', wsId);
    await deleteFromRecord('calendar_last_synced', wsId);
  });
}

// ─── Sync ──────────────────────────────────────────────────────────────────────

export async function syncTodayMeetings(wsId: string, timezone: string): Promise<void> {
  const token = await getValidToken(wsId);
  if (!token) return;

  const conn = await getCalendarConnection(wsId);
  if (!conn || conn.selectedCalendarIds.length === 0) return;

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const todayStart = new Date(todayStr + 'T00:00:00');
  const todayEnd = new Date(todayStr + 'T23:59:59');
  const timeMin = todayStart.toISOString();
  const timeMax = todayEnd.toISOString();

  const seenGoogleIds = new Set<string>();

  for (const calendarId of conn.selectedCalendarIds) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    );
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '50');

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = data.items ?? [];

    for (const item of items) {
      if (item.status === 'cancelled') continue;
      const googleEventId: string = item.id;
      seenGoogleIds.add(googleEventId);

      const startStr: string = item.start?.dateTime ?? item.start?.date ?? timeMin;
      const endStr: string = item.end?.dateTime ?? item.end?.date ?? startStr;
      const durationMinutes = Math.round((new Date(endStr).getTime() - new Date(startStr).getTime()) / 60000);
      const past = new Date(endStr) < new Date();

      const recurringEventId: string | undefined = item.recurringEventId;
      const existing = await db.meetings.where('googleEventId').equals(googleEventId).first();

      if (existing) {
        await db.meetings.update(existing.id, {
          title: item.summary ?? '(no title)',
          time: startStr,
          durationMinutes,
          description: item.description ?? '',
          past,
          ...(recurringEventId ? { recurringEventId } : {}),
          updatedAt: now(),
        });
      } else {
        // For recurring events, inherit trackMode 'always' from the most recent prior occurrence
        let inheritedTrackMode: MeetingTrackMode = 'off';
        if (recurringEventId) {
          const prev = await db.meetings
            .where('recurringEventId').equals(recurringEventId)
            .filter(m => !m.deletedAt && m.workspaceId === wsId)
            .toArray()
            .then(rows => rows.sort((a, b) => b.time.localeCompare(a.time))[0]);
          if (prev?.trackMode === 'always') inheritedTrackMode = 'always';
        }
        const row: MeetingRow = {
          id: crypto.randomUUID(),
          googleEventId,
          recurringEventId,
          title: item.summary ?? '(no title)',
          time: startStr,
          durationMinutes,
          description: item.description ?? '',
          trackMode: inheritedTrackMode,
          past,
          logged: false,
          notes: '',
          projectId: null,
          workspaceId: wsId,
          updatedAt: now(),
        };
        await db.meetings.put(row);
      }
    }
  }

  // Soft-delete Google-sourced meetings for today that are no longer returned
  const todayGoogleMeetings = await db.meetings
    .filter(m => {
      if (m.deletedAt || !m.googleEventId) return false;
      if (m.workspaceId !== wsId) return false;
      const t = new Date(m.time);
      return t >= todayStart && t <= todayEnd;
    })
    .toArray();

  for (const m of todayGoogleMeetings) {
    if (m.googleEventId && !seenGoogleIds.has(m.googleEventId)) {
      await db.meetings.update(m.id, { deletedAt: now(), updatedAt: now() });
    }
  }

  await writeRecord('calendar_last_synced', wsId, now());
}

// Syncs all workspaces that have a calendar connection. Called on popup open.
export async function syncAllConnectedWorkspaces(timezone: string): Promise<void> {
  const allConns = await getAllCalendarConnections();
  await Promise.all(
    Object.keys(allConns).map(wsId => syncTodayMeetings(wsId, timezone))
  );
}
