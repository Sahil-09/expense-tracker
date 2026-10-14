import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  applyRemote,
  applyRemoteBudget,
  applyRemoteExclusion,
  budgetsSince,
  dropByClientId,
  exclusionsSince,
  expensesSince,
  getPref,
  highestStamp,
  setPref,
  uuid,
  type RemoteExpense,
} from './db';

/**
 * The sync engine. Everything the design says about it in one place:
 *
 * - The app stays offline-first. Nothing here is awaited by a screen, and every entry
 *   point swallows its own failure, so a dead or slow server is indistinguishable from
 *   normal use. That is the whole rule the architecture is built around.
 * - Push what changed / pull what changed, one cursor.
 * - Failures back off exponentially and are surfaced only in Settings.
 */

const PREFS = {
  email: 'sync_email',
  password: 'sync_password',
  accessToken: 'sync_access_token',
  accessExpiresAt: 'sync_access_expires_at',
  deviceId: 'sync_device_id',
  deviceName: 'sync_device_name',
  cursor: 'sync_cursor',
  /** Local watermark: everything at or below this has been pushed. */
  pushed: 'sync_pushed_at',
  lastSync: 'sync_last_at',
  lastError: 'sync_last_error',
  failures: 'sync_failures',
  /** Epoch ms before which no attempt is made. */
  backoffUntil: 'sync_backoff_until',
  /** Set once the local SQLite file has been copied to the backup slot. */
  backedUp: 'sync_backup_done',
  /**
   * Set once the user has answered the first-run account question, whether they signed in
   * or chose to stay on this phone. Separate from the credentials above on purpose:
   * signing out later must not bounce them back through onboarding.
   */
  onboarded: 'onboarded',
} as const;

/** 1m, 2m, 4m … capped at an hour, so a server down for a day is not hammered. */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

/** 500 rows a page, so 20 pages covers 10,000 rows — past any plausible personal history. */
const MAX_PAGES = 20;

export type SyncState = {
  configured: boolean;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  backoffUntil: number;
  deviceName: string;
};

const state: SyncState = {
  configured: false,
  running: false,
  lastSyncAt: null,
  lastError: null,
  backoffUntil: 0,
  deviceName: '',
};

const watchers = new Set<(s: SyncState) => void>();

export function onSyncState(fn: (s: SyncState) => void): () => void {
  watchers.add(fn);
  fn({ ...state });
  return () => {
    watchers.delete(fn);
  };
}

function patch(next: Partial<SyncState>) {
  Object.assign(state, next);
  for (const fn of watchers) fn({ ...state });
}

/** True when the user has pointed the app at a server. Absent, sync is simply off. */
export function serverUrl(): string | null {
  const fromEnv =
    process.env.EXPO_PUBLIC_SYNC_URL ??
    (Constants.expoConfig?.extra as { syncUrl?: string } | undefined)?.syncUrl;
  if (!fromEnv) return null;
  return fromEnv.replace(/\/+$/, '');
}

/** Loads prefs into the module state. Cheap, so Settings can call it on every focus. */
export async function refreshState(): Promise<SyncState> {
  patch({
    configured: serverUrl() !== null,
    lastSyncAt: Number((await getPref(PREFS.lastSync)) ?? 0) || null,
    lastError: await getPref(PREFS.lastError),
    backoffUntil: Number((await getPref(PREFS.backoffUntil)) ?? 0),
    deviceName: (await getPref(PREFS.deviceName)) ?? deviceDefaultName(),
  });
  return { ...state };
}

function deviceDefaultName(): string {
  const model = Constants.platform?.android?.model;
  return [Constants.deviceName?.toString(), model].filter(Boolean).join(' · ') || Platform.OS;
}

/** Minted once per install. Stands in for a hardware id we have no business reading. */
async function deviceId(): Promise<string> {
  const existing = await getPref(PREFS.deviceId);
  if (existing) return existing;
  const fresh = uuid();
  await setPref(PREFS.deviceId, fresh);
  return fresh;
}

async function backoffLeft(): Promise<number> {
  return Number((await getPref(PREFS.backoffUntil)) ?? 0) - Date.now();
}

/**
 * The one way sync runs. Safe to call from anywhere; returns quietly when there is
 * nothing to do or when the backoff window is still open.
 *
 * Not re-entrant by design: a second call while one is in flight returns the same
 * in-flight promise, because two concurrent pushes of the same rows is wasted work and
 * the second would return rows the first is already applying.
 */
let inFlight: Promise<SyncResult> | null = null;

export type SyncResult = {
  ok: boolean;
  pushed: number;
  pulled: number;
  skipped?: 'not-configured' | 'backoff' | 'no-credentials';
  error?: string;
};

export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<SyncResult> {
  const base = serverUrl();
  if (!base) return done({ ok: true, pushed: 0, pulled: 0, skipped: 'not-configured' });

  if ((await backoffLeft()) > 0) {
    return done({ ok: true, pushed: 0, pulled: 0, skipped: 'backoff' });
  }

  const email = await getPref(PREFS.email);
  const password = await getPref(PREFS.password);
  if (!email || !password) {
    return done({ ok: true, pushed: 0, pulled: 0, skipped: 'no-credentials' });
  }

  patch({ running: true });
  try {
    const me = await deviceId();
    const token = await accessToken(base, email, password, me);

    const since = Number((await getPref(PREFS.pushed)) ?? 0);

    // Read BEFORE building the push lists, and used as the new watermark.
    //
    // Anything at or below this stamp existed before the lists were read, so it was in
    // them. Taking it after would be a silent loss: a row written between the read and
    // the query has a stamp below the watermark but was never pushed, so nothing would
    // ever send it.
    const watermark = await highestStamp();

    const [expenses, budgets, exclusions] = await Promise.all([
      expensesSince(since),
      budgetsSince(since),
      exclusionsSince(since),
    ]);

    type PullBody = {
      cursor: string;
      hasMore: boolean;
      expenses: RemoteExpense[];
      budgets: { category: string; monthlyPaise: number; deletedAt: number | null }[];
      exclusions: { merchant: string; deletedAt: number | null }[];
      duplicates: Record<string, string>;
    };

    const post = (cursor: string | null, push: boolean) =>
      fetch(`${base}/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          deviceId: me,
          cursor,
          expenses: push ? expenses : [],
          budgets: push ? budgets : [],
          exclusions: push ? exclusions : [],
        }),
      });

    const res = await post(await getPref(PREFS.cursor), true);

    if (res.status === 401) {
      // The access token outlived its 15 minutes and the stored one is stale. Drop it so
      // the next attempt logs in again; the refresh path is not worth the moving parts
      // for one account on a personal box.
      await setPref(PREFS.accessToken, '');
      throw new Error('Session expired — will sign in again next time.');
    }
    if (!res.ok) throw new Error(`Server said ${res.status}`);

    let body = (await res.json()) as PullBody;
    await applyPull(body);
    let pulled = body.expenses.length + body.budgets.length + body.exclusions.length;

    // The server pages at 500 rows and says so. Follow it here rather than waiting for
    // the next foreground, or a reinstalled phone looks like it lost most of its history
    // until the user happens to open the app a few more times. Capped so a server that
    // always answers hasMore cannot spin this forever.
    for (let page = 0; page < MAX_PAGES && body.hasMore; page++) {
      const more = await post(body.cursor, false);
      if (!more.ok) break;
      const next = (await more.json()) as PullBody;
      await applyPull(next);
      pulled += next.expenses.length + next.budgets.length + next.exclusions.length;
      body = next;
    }

    await setPref(PREFS.pushed, String(watermark));
    await setPref(PREFS.cursor, body.cursor);
    await setPref(PREFS.lastSync, String(Date.now()));
    await setPref(PREFS.lastError, '');
    await setPref(PREFS.failures, '0');
    await setPref(PREFS.backoffUntil, '0');

    return done({
      ok: true,
      pushed: expenses.length + budgets.length + exclusions.length,
      pulled,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const failures = Number((await getPref(PREFS.failures)) ?? 0) + 1;
    const wait = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
    await setPref(PREFS.failures, String(failures));
    await setPref(PREFS.lastError, message);
    await setPref(PREFS.backoffUntil, String(Date.now() + wait));
    patch({ lastError: message, backoffUntil: Date.now() + wait });
    // Swallowed on purpose: a caller on a render path has nowhere to show this.
    return { ok: false, pushed: 0, pulled: 0, error: message };
  } finally {
    patch({ running: false });
  }
}

async function done(r: SyncResult): Promise<SyncResult> {
  patch({ running: false, lastError: r.error ?? null });
  return r;
}

/**
 * Signs in when there is no usable access token, and reuses the stored one otherwise.
 *
 * The 60-second margin means a token cannot expire between the check and the sync call
 * in any way that matters.
 */
async function accessToken(base: string, email: string, password: string, me: string): Promise<string> {
  const stored = await getPref(PREFS.accessToken);
  const expiry = Number((await getPref(PREFS.accessExpiresAt)) ?? 0);
  if (stored && expiry - Date.now() > 60_000) return stored;

  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      deviceId: me,
      deviceName: (await getPref(PREFS.deviceName)) ?? deviceDefaultName(),
      platform: Platform.OS,
    }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Wrong email or password' : `Login failed (${res.status})`);

  const body = (await res.json()) as { accessToken: string; expiresIn: number };
  await setPref(PREFS.accessToken, body.accessToken);
  await setPref(PREFS.accessExpiresAt, String(Date.now() + body.expiresIn * 1000));
  return body.accessToken;
}

/** Applies a pull, newest last so an older row cannot undo a newer one. */
async function applyPull(body: {
  cursor: string;
  expenses: RemoteExpense[];
  budgets: { category: string; monthlyPaise: number; deletedAt: number | null }[];
  exclusions: { merchant: string; deletedAt: number | null }[];
  duplicates: Record<string, string>;
}): Promise<void> {
  for (const [clientId] of Object.entries(body.duplicates ?? {})) {
    await dropByClientId(clientId);
  }
  for (const e of body.expenses) await applyRemote(e);
  for (const b of body.budgets) await applyRemoteBudget(b);
  for (const x of body.exclusions) await applyRemoteExclusion(x);
}

/** Fires sync in the background after a capture, where a failure must not surface. */
export function syncInBackground(): void {
  void syncNow();
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const base = serverUrl();
  if (!base) return 'No sync server configured. Set EXPO_PUBLIC_SYNC_URL.';
  try {
    await setPref(PREFS.email, email);
    await setPref(PREFS.password, password);
    await setPref(PREFS.accessToken, '');
    await setPref(PREFS.failures, '0');
    await setPref(PREFS.backoffUntil, '0');
    patch({ configured: true, lastError: null });
    const result = await syncNow();
    return result.ok ? null : (result.error ?? 'Sync failed');
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Creates an account and signs in, in one round trip — the server returns the same tokens
 * login does, so there is nothing extra to store afterwards.
 */
export async function register(
  email: string,
  password: string,
  code: string
): Promise<string | null> {
  // The device details go with the signup, or this device lands in the server's device
  // list as "Phone / unknown" until the user happens to sign in a second time.
  const error = await postAuth('/auth/register', {
    email,
    password,
    code,
    deviceName: (await getPref(PREFS.deviceName)) ?? deviceDefaultName(),
    platform: Platform.OS,
  });
  // Signup does not push the existing history on its own: a phone that has been logging
  // expenses as a guest has rows to send, and nothing else would trigger a sync right
  // after this, because the root layout never loses focus.
  if (error === null) await syncNow();
  return error;
}

/** No confirmation either way: the server answers 204 for known and unknown addresses alike. */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<string | null> {
  return postAuth('/auth/reset-password', { email, code, newPassword });
}

/**
 * One place for the three account calls, because they differ only in path and body.
 *
 * Returns null on success, or a sentence worth showing. The password is only persisted by
 * signIn — a half-finished register should not leave a password sitting in prefs for an
 * account that does not exist.
 */
async function postAuth(path: string, body: Record<string, unknown>): Promise<string | null> {
  const base = serverUrl();
  if (!base) return 'No sync server configured. Set EXPO_PUBLIC_SYNC_URL.';

  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return 'That code is not valid.';
    if (res.status === 409) return 'That email is already registered.';
    if (!res.ok) return `The server said ${res.status}.`;

    const tokens = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      deviceId: string;
    };
    await setPref(PREFS.email, String(body.email));
    await setPref(PREFS.password, String(body.password ?? body.newPassword));
    await setPref(PREFS.deviceId, tokens.deviceId);
    await setPref(PREFS.accessToken, tokens.accessToken);
    await setPref(PREFS.accessExpiresAt, String(Date.now() + tokens.expiresIn * 1000));
    await setPref(PREFS.failures, '0');
    await setPref(PREFS.backoffUntil, '0');
    patch({ configured: true, lastError: null });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function signOut(): Promise<void> {
  await setPref(PREFS.email, '');
  await setPref(PREFS.password, '');
  await setPref(PREFS.accessToken, '');
  await setPref(PREFS.cursor, '');
  await setPref(PREFS.pushed, '0');
  await setPref(PREFS.lastError, '');
  patch({ configured: false, lastError: null, lastSyncAt: null });
}

/** Never blocks a screen; used from the root layout on foreground. */
export function startBackgroundSync(): void {
  void refreshState();
  void syncNow();
}

/**
 * True when this device has its own expense table backed up.
 *
 * The migration that gives every row a clientId is the one step in this project that can
 * corrupt live history, so Settings shows this before the first sync rather than after.
 */
export async function hasBackedUp(): Promise<boolean> {
  return (await getPref(PREFS.backedUp)) === '1';
}

export async function markBackedUp(): Promise<void> {
  await setPref(PREFS.backedUp, '1');
}