import { PermissionsAndroid, Platform } from 'react-native';

import ExpenseSms from '@/modules/expense-sms/src/ExpenseSmsModule';

import { ingestSms, reclassifyPending } from './db';
import { notifyExpense } from './notify';
import { syncInBackground } from './sync';

export const isAndroid = Platform.OS === 'android';

/**
 * True when the native module is missing from the running binary. This happens on iOS/web,
 * and on Android in Expo Go or any build made before the module existed — those builds cannot
 * read the inbox no matter what permission we hold.
 */
export const nativeModuleMissing = isAndroid && ExpenseSms == null;

export const canReadSms = isAndroid && ExpenseSms != null;

/**
 * Both are needed and they are not interchangeable.
 *
 * READ_SMS is what reads the inbox during a manual scan. RECEIVE_SMS is what makes Android
 * deliver `SMS_RECEIVED` to the manifest receiver, so without it the app never sees a new
 * message arrive at all and auto-capture silently does nothing.
 */
const SMS_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.READ_SMS,
  PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
];

export async function hasSmsPermission(): Promise<boolean> {
  if (!isAndroid) return false;
  for (const p of SMS_PERMISSIONS) {
    if (!(await PermissionsAndroid.check(p))) return false;
  }
  return true;
}

export async function requestSmsPermission(): Promise<boolean> {
  if (!isAndroid) return false;
  // No rationale object: Android's requestMultiple takes none, and the in-app explanation
  // already lives in <SmsPermissionGate> where it can actually be read before the prompt.
  const result = await PermissionsAndroid.requestMultiple(SMS_PERMISSIONS);
  return SMS_PERMISSIONS.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

const NOOP: ScanSummary = {
  scanned: 0,
  added: 0,
  duplicates: 0,
  skipped: 0,
  failed: 0,
  reclassified: 0,
};

/**
 * Scan state, shared so any screen can show the same progress without owning it.
 *
 * A module-level store rather than context: the only consumers are the Timeline bar and
 * the root layout's auto-start, and this file already keeps a watcher set for
 * <onCaptured>.
 */
export type ScanState = { running: boolean; done: number; total: number; added: number };

let scanState: ScanState = { running: false, done: 0, total: 0, added: 0 };
const scanWatchers = new Set<(s: ScanState) => void>();

function setScanState(patch: Partial<ScanState>) {
  scanState = { ...scanState, ...patch };
  for (const fn of scanWatchers) fn(scanState);
}

/** Subscribes to scan progress and is called once immediately with the current state. */
export function onScanState(fn: (s: ScanState) => void): () => void {
  scanWatchers.add(fn);
  fn(scanState);
  return () => {
    scanWatchers.delete(fn);
  };
}

/**
 * The one way to start a scan. Auto-start on launch, the first-run gate and the two
 * scan buttons all go through here, so they cannot overlap and each gets progress.
 */
export async function runScan(): Promise<ScanResult> {
  if (scanState.running) return { ok: true, ...NOOP };
  setScanState({ running: true, done: 0, total: 0, added: 0 });
  try {
    const result = await scanInbox((done, total) => setScanState({ done, total }));
    setScanState({ running: false, added: result.ok ? result.added : 0 });
    // A scan that found nothing has nothing to push, and a scan that found something has
    // rows the server has never seen. This is the "fires after a scan" trigger; the other
    // one is app-foreground, in _layout.
    if (result.ok && result.added > 0) syncInBackground();
    return result;
  } catch (e) {
    setScanState({ running: false });
    throw e;
  }
}

export type ScanSummary = {
  scanned: number;
  added: number;
  duplicates: number;
  skipped: number;
  failed: number;
  /** Existing rows moved into the dues section by this scan. */
  reclassified: number;
};

export type ScanResult = ({ ok: true } & ScanSummary) | { ok: false; error: string };

/**
 * Walks the entire inbox newest-first and feeds every message through the normal ingest
 * path. `scanned` matters as much as `added`: scanned 0 means we read nothing, while
 * scanned > 0 with added 0 means the parser rejected everything.
 *
 * The whole inbox, not a recent window: an expense from fourteen months ago is still an
 * expense, and the months with no messages cost nothing but a parse. Dedupe makes
 * re-scanning free of side effects, so there is no reason to hide older history.
 *
 * `onProgress` fires per message so a screen can show a moving bar; a full inbox is long
 * enough that a spinner alone reads as a hang.
 */
export async function scanInbox(
  onProgress?: (done: number, total: number) => void
): Promise<ScanResult> {
  if (!isAndroid) return { ok: false, error: 'Inbox reading is Android only.' };
  if (nativeModuleMissing) {
    return {
      ok: false,
      error: 'This build has no SMS module. Expo Go cannot include custom native code — run `npx expo run:android` to build a dev client.',
    };
  }
  if (!(await hasSmsPermission())) {
    return { ok: false, error: 'SMS permission not granted. Grant it in Android Settings, then scan again.' };
  }

  let messages;
  try {
    // sinceMs 0 is the whole inbox: the native query is `date >= ?`, and no SMS has a
    // non-positive timestamp.
    messages = await ExpenseSms!.readInbox(0);
  } catch (e) {
    return { ok: false, error: `Inbox read failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const summary: ScanSummary = {
    scanned: messages.length,
    added: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    reclassified: 0,
  };
  for (const m of messages) {
    try {
      const outcome = await ingestSms(m.body, m.date, 'android-inbox');
      if (outcome.status === 'added') {
        summary.added++;
        // No notification here: a 90-day backfill would fire one per row. The caller
        // that started the scan owns showing the result.
        notifyCaptured();
      } else if (outcome.status === 'duplicate') summary.duplicates++;
      else summary.skipped++;
    } catch {
      // One bad message must not abandon the rest of the 90-day window.
      summary.failed++;
    } finally {
      summary.scanned++;
      onProgress?.(summary.scanned, messages.length);
    }
  }

  // Dedupe means the new rows never come back through ingest, so anything imported before
  // dues and transfers were split out is fixed here instead. Failures must not fail the scan.
  try {
    summary.reclassified = await reclassifyPending();
    // This pass rewrites rows that were already on screen, and no add fired above for them.
    if (summary.reclassified > 0) notifyCaptured();
  } catch {
    summary.reclassified = 0;
  }
  return { ok: true, ...summary };
}

const captured = new Set<() => void>();
let liveSub: { remove: () => void } | null = null;

/** Fires every watcher. Live capture and the inbox scan both route through here. */
function notifyCaptured(): void {
  for (const fn of captured) fn();
}

/**
 * Starts the single live-capture subscription for the whole app.
 *
 * The native receiver is declared in AndroidManifest.xml, so it fires even while the app
 * is closed; anything captured with no JS running is queued natively and replayed here on
 * the next start. Calling this more than once is harmless.
 */
export function startLiveCapture(): void {
  if (!canReadSms || liveSub) return;
  const handler = (event: { body: string; date: number; isReplay?: boolean }) => {
    void ingestSms(event.body, event.date, 'android-live')
      .then(async (outcome) => {
        if (outcome.status !== 'added') return;
        notifyCaptured();
        // A replay is the app catching up on messages that arrived while it was closed.
        // The expense is real, but a burst of them on every cold start is noise, not news.
        if (!event.isReplay) await notifyExpense(outcome.id);
      })
      // A live-capture failure has nowhere to surface; swallowing it keeps the app up.
      .catch(() => {});
  };
  liveSub = ExpenseSms!.addListener('onSmsReceived', handler);
}

/** Fires when a new expense is captured, whatever screen is open. Returns an unsubscribe. */
export function onCaptured(fn: () => void): () => void {
  captured.add(fn);
  return () => {
    captured.delete(fn);
  };
}