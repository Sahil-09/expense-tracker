import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { categorize, type Category } from './categories';
import { addMonths, monthStart } from './money';
import { parseSms, classify } from './parse';

export type Expense = {
  id: number;
  /**
   * Stable id minted on the phone at insert time, and the only identity that survives
   * to a second device. `id` is an autoincrement integer, and two phones each mint id 5
   * for different expenses — syncing on that would silently write one phone's merchant
   * over the other's row. Also what deep links carry, for the same reason.
   */
  client_id: string;
  amount_paise: number;
  merchant: string | null;
  category: Category;
  txn_at: number;
  note: string | null;
  raw_sms: string;
  source: string;
  /** 0 when the user says this was not a spend. Kept in the row, not deleted. */
  is_expense: number;
  /** 1 when the message announced an upcoming charge rather than reporting one. */
  is_due: number;
  /** 1 when the message was money in. Stored for the month's net, never counted as spend. */
  is_income: number;
  /** When this row last changed on this device. Drives push-what-changed. */
  updated_at: number;
};

export type Budget = { category: Category; monthly_paise: number; updated_at: number };

/**
 * A delete waiting to be told to the other devices.
 *
 * A separate table rather than a `deleted_at` column on each synced table, so the local
 * reads never have to learn to filter tombstones out — missing one filter on one of the
 * eight expense queries is a deleted expense quietly reappearing in the monthly total.
 * `kind` is 'expense' | 'budget' | 'exclusion'; `key` is clientId / category / merchant.
 */
export type Tombstone = { kind: string; key: string; updated_at: number };

export type Exclusion = { merchant: string; updated_at: number };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * v4 UUID, the cross-device identity for an expense.
 *
 * crypto.randomUUID is not available in Hermes, and expo-crypto's is a native call — so
 * this is the same value on every device rather than something that quietly differs.
 */
export function uuid(): string {
  return Crypto.randomUUID();
}

/**
 * Monotonic "now" for updated_at.
 *
 * Two edits inside the same millisecond would otherwise share a timestamp and the
 * push-what-changed watermark would silently skip one of them.
 */
let lastStamp = 0;
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/**
 * Opens the database once and guarantees the schema exists before anyone writes.
 *
 * Caches the *promise*, not the handle. Caching the handle left the module variable
 * null for the whole `await`, so two callers arriving together each opened the file,
 * and the loser could insert before the winner finished CREATE TABLE.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = SQLite.openDatabaseAsync('expenses.db')
    .then(async (handle) => {
      await handle.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_paise INTEGER NOT NULL,
      merchant TEXT,
      category TEXT NOT NULL,
      txn_at INTEGER NOT NULL,
      note TEXT,
      raw_sms TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      is_expense INTEGER NOT NULL DEFAULT 1,
      is_income INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_txn_at ON expenses (txn_at);
    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      monthly_paise INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prefs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exclusions (
      merchant TEXT PRIMARY KEY
    );
  `);
      // Existing installs predate is_expense; ALTER throws once the column is there.
      try {
        await handle.execAsync(
          'ALTER TABLE expenses ADD COLUMN is_expense INTEGER NOT NULL DEFAULT 1;'
        );
      } catch {
        /* already migrated */
      }
      try {
        await handle.execAsync('ALTER TABLE expenses ADD COLUMN is_due INTEGER NOT NULL DEFAULT 0;');
      } catch {
        /* already migrated */
      }
      try {
        await handle.execAsync(
          'ALTER TABLE expenses ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0;'
        );
      } catch {
        /* already migrated */
      }

      // --- Sync migration -------------------------------------------------------
      // Reindex, never rebuild: existing rows keep their ids, which every reader in the
      // app still uses.
      //
      // One try per statement, not one try for the lot. A single try means a launch
      // killed halfway never finishes the backfill — every later launch throws on the
      // first ALTER and skips past the rest, leaving rows with no clientId that the
      // first sync then quietly never sends.
      for (const stmt of [
        'ALTER TABLE expenses ADD COLUMN client_id TEXT;',
        'ALTER TABLE expenses ADD COLUMN updated_at INTEGER;',
        'ALTER TABLE budgets ADD COLUMN updated_at INTEGER;',
        'ALTER TABLE exclusions ADD COLUMN updated_at INTEGER;',
      ]) {
        try {
          await handle.execAsync(stmt);
        } catch {
          /* already migrated */
        }
      }

      await handle.execAsync(
        `CREATE TABLE IF NOT EXISTS tombstones (
           kind TEXT NOT NULL,
           key TEXT NOT NULL,
           updated_at INTEGER NOT NULL,
           PRIMARY KEY (kind, key)
         );`,
      );

      // Backfilled with the row's own date rather than 0, so the first sync pushes the
      // whole existing history instead of nothing.
      await handle.runAsync('UPDATE expenses SET updated_at = txn_at WHERE updated_at IS NULL;');
      await handle.runAsync('UPDATE budgets SET updated_at = 0 WHERE updated_at IS NULL;');
      await handle.runAsync('UPDATE exclusions SET updated_at = 0 WHERE updated_at IS NULL;');

      // One row at a time because the value is a UUID from JS. Runs on every open, and
      // is a no-op once every row has one.
      const blank = await handle.getAllAsync<{ id: number }>(
        'SELECT id FROM expenses WHERE client_id IS NULL;'
      );
      for (const row of blank) {
        await handle.runAsync('UPDATE expenses SET client_id = ? WHERE id = ?', uuid(), row.id);
      }

      // Partial, so the NULLs a half-finished migration leaves behind never trip the
      // UNIQUE constraint.
      await handle.execAsync(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_client_id ON expenses (client_id) WHERE client_id IS NOT NULL;'
      );
      await handle.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_expenses_updated_at ON expenses (updated_at);'
      );
      return handle;
    })
    .catch((error) => {
      dbPromise = null; // never cache a failed open; the next call retries
      throw error;
    });

  return dbPromise;
}

/**
 * Exact-match dedupe: the normalised body plus the day it landed on. Storing the text
 * rather than a hash means no birthday collisions can silently drop a real expense.
 */
function dedupeKey(body: string, at: number): string {
  const day = new Date(at).toDateString();
  return `${body.replace(/\s+/g, ' ').trim().toLowerCase()}|${day}`;
}

export type IngestOutcome =
  | { status: 'added'; id: number }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: string };

/** The single entry point for every SMS source: Android inbox, iOS share sheet, paste. */
export async function ingestSms(
  body: string,
  receivedAt: number | null,
  source: string
): Promise<IngestOutcome> {
  const result = parseSms(body, receivedAt);
  if (!result.ok) return { status: 'skipped', reason: result.reason };

  const { amountPaise, merchant, txnAt, kind } = result.parsed;
  const d = await getDb();
  const isDue = kind === 'due' ? 1 : 0;
  const isIncome = kind === 'income' ? 1 : 0;

  // A transfer is never a spend, and naming it beats the merchant scrape, which reads
  // "Suryoday Small Finance Ba" and cannot match a category rule.
  const category: Category = kind === 'transfer' ? 'Transfer' : categorize(merchant ?? body);

  // A payment the user once flagged as personal must never come back as a spend. Income
  // is exempt: a "don't log this merchant" verdict was about spending, and applying it
  // to a refund would hide money coming back in.
  if (kind !== 'income' && merchant && (await isExcluded(merchant))) {
    return { status: 'skipped', reason: 'not-expense' };
  }

  // INSERT OR IGNORE does the dedupe check and the write in one statement, so a second
  // import of the same SMS cannot slip a duplicate past a separate lookup.
  const info = await d.runAsync(
    `INSERT OR IGNORE INTO expenses
       (amount_paise, merchant, category, txn_at, note, raw_sms, dedupe_key, source, is_expense, is_due, is_income, client_id, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    amountPaise,
    merchant,
    category,
    txnAt,
    body,
    dedupeKey(body, txnAt),
    source,
    kind === 'spend' ? 1 : 0,
    isDue,
    isIncome,
    uuid(),
    stamp()
  );
  return info.changes === 0
    ? { status: 'duplicate' }
    : { status: 'added', id: info.lastInsertRowId };
}

/**
 * Re-checks stored rows against the dues and transfer rules, so messages imported before
 * those were split out stop counting toward the month. Dedupe means they never come back
 * through ingest.
 *
 * Runs one way only: it excludes rows it now recognises and never re-includes anything, so
 * a row the user cleared by hand stays cleared.
 */
export async function reclassifyPending(): Promise<number> {
  const d = await getDb();
  const rows = await d.getAllAsync<{
    id: number;
    raw_sms: string;
    is_due: number;
    is_expense: number;
    category: Category;
  }>('SELECT id, raw_sms, is_due, is_expense, category FROM expenses');

  let changed = 0;
  for (const r of rows) {
    if (r.is_expense === 0) continue; // already out of the totals, leave the user's hand alone
    const kind = classify(r.raw_sms);
    if (kind === 'spend') continue;
    await d.runAsync(
      'UPDATE expenses SET is_expense = 0, is_due = ?, is_income = ?, category = ?, updated_at = ? WHERE id = ?',
      kind === 'due' ? 1 : r.is_due,
      kind === 'income' ? 1 : 0,
      kind === 'transfer' ? 'Transfer' : r.category,
      stamp(),
      r.id
    );
    changed++;
  }
  return changed;
}

export async function listExpenses(monthMs: number): Promise<Expense[]> {
  const d = await getDb();
  const start = monthStart(monthMs);
  return d.getAllAsync<Expense>(
    'SELECT * FROM expenses WHERE txn_at >= ? AND txn_at < ? ORDER BY txn_at DESC',
    start,
    addMonths(start, 1)
  );
}

export async function monthlyTotal(monthMs: number): Promise<number> {
  const d = await getDb();
  const start = monthStart(monthMs);
  const row = await d.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount_paise) AS total FROM expenses WHERE txn_at >= ? AND txn_at < ? AND is_expense = 1',
    start,
    addMonths(start, 1)
  );
  return row?.total ?? 0;
}

/** Money in for the month, so the insights screen can show a net figure. Never a spend. */
export async function monthlyIncome(monthMs: number): Promise<number> {
  const d = await getDb();
  const start = monthStart(monthMs);
  const row = await d.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount_paise) AS total FROM expenses WHERE txn_at >= ? AND txn_at < ? AND is_income = 1',
    start,
    addMonths(start, 1)
  );
  return row?.total ?? 0;
}

export async function totalsByCategory(
  monthMs: number
): Promise<{ category: Category; total: number; n: number }[]> {
  const d = await getDb();
  const start = monthStart(monthMs);
  return d.getAllAsync<{ category: Category; total: number; n: number }>(
    `SELECT category, SUM(amount_paise) AS total, COUNT(*) AS n FROM expenses
     WHERE txn_at >= ? AND txn_at < ? AND is_expense = 1 GROUP BY category ORDER BY total DESC`,
    start,
    addMonths(start, 1)
  );
}

export async function totalsByMonth(monthCount: number): Promise<{ month: string; total: number }[]> {
  const d = await getDb();
  return d.getAllAsync<{ month: string; total: number }>(
    `SELECT strftime('%Y-%m', txn_at / 1000, 'unixepoch', 'localtime') AS month,
            SUM(amount_paise) AS total
     FROM expenses WHERE is_expense = 1 GROUP BY month ORDER BY month DESC LIMIT ?`,
    monthCount
  );
}

export async function listBudgets(): Promise<Budget[]> {
  const d = await getDb();
  return d.getAllAsync<Budget>('SELECT * FROM budgets');
}

export async function setBudget(category: Category, monthlyPaise: number): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO budgets (category, monthly_paise, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (category) DO UPDATE SET monthly_paise = excluded.monthly_paise,
                                        updated_at = excluded.updated_at`,
    category,
    monthlyPaise,
    stamp()
  );
}

/** Deep links carry clientId, not the local integer: see Expense.client_id. */
export async function getExpenseByClientId(clientId: string): Promise<Expense | null> {
  const d = await getDb();
  return (
    (await d.getFirstAsync<Expense>('SELECT * FROM expenses WHERE client_id = ?', clientId)) ?? null
  );
}

export async function getExpense(id: number): Promise<Expense | null> {
  const d = await getDb();
  return (await d.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ?', id)) ?? null;
}

/**
 * Removes the row locally and leaves a tombstone behind.
 *
 * The row itself has to go — every total, list and picker reads it, and a `deleted_at`
 * filter missing from one of them would put a deleted expense back in the month's total.
 * The tombstone is what carries the delete to the other devices.
 */
export async function deleteExpense(id: number): Promise<void> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ client_id: string }>(
    'SELECT client_id FROM expenses WHERE id = ?',
    id
  );
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM expenses WHERE id = ?', id);
    if (row !== null) {
      await d.runAsync(
        `INSERT INTO tombstones (kind, key, updated_at) VALUES ('expense', ?, ?)
         ON CONFLICT (kind, key) DO UPDATE SET updated_at = excluded.updated_at`,
        row.client_id,
        stamp()
      );
    }
  });
}

export async function setCategory(id: number, category: Category): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    'UPDATE expenses SET category = ?, updated_at = ? WHERE id = ?',
    category,
    stamp(),
    id
  );
}

/** Blank is stored as NULL so an untouched note stays indistinguishable from no note. */
export async function setNote(id: number, note: string): Promise<void> {
  const d = await getDb();
  const trimmed = note.trim();
  await d.runAsync(
    'UPDATE expenses SET note = ?, updated_at = ? WHERE id = ?',
    trimmed === '' ? null : trimmed,
    stamp(),
    id
  );
}

export async function countExpenses(): Promise<number> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM expenses WHERE is_expense = 1'
  );
  return row?.n ?? 0;
}

/** Merchants the user has flagged as personal, so the same payment is never logged again. */
function exclusionKey(merchant: string): string {
  return merchant.replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function isExcluded(merchant: string): Promise<boolean> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM exclusions WHERE merchant = ?',
    exclusionKey(merchant)
  );
  return (row?.n ?? 0) > 0;
}

export async function listExclusions(): Promise<string[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ merchant: string }>('SELECT merchant FROM exclusions ORDER BY merchant');
  return rows.map((r) => r.merchant);
}

/** Tombstoned rather than deleted, so the other devices stop logging this merchant too. */
export async function addExclusion(merchant: string): Promise<void> {
  const d = await getDb();
  const key = exclusionKey(merchant);
  const at = stamp();
  await d.withTransactionAsync(async () => {
    await d.runAsync(
      `INSERT INTO exclusions (merchant, updated_at) VALUES (?, ?)
       ON CONFLICT (merchant) DO UPDATE SET updated_at = excluded.updated_at`,
      key,
      at
    );
    await clearTombstone(d, 'exclusion', key);
  });
}

export async function removeExclusion(merchant: string): Promise<void> {
  const d = await getDb();
  const key = exclusionKey(merchant);
  const at = stamp();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM exclusions WHERE merchant = ?', key);
    await d.runAsync(
      `INSERT INTO tombstones (kind, key, updated_at) VALUES ('exclusion', ?, ?)
       ON CONFLICT (kind, key) DO UPDATE SET updated_at = excluded.updated_at`,
      key,
      at
    );
  });
}

export async function clearTombstone(
  d: SQLite.SQLiteDatabase,
  kind: string,
  key: string
): Promise<void> {
  await d.runAsync('DELETE FROM tombstones WHERE kind = ? AND key = ?', kind, key);
}

/**
 * Flips the expense flag and keeps the memory in step: marking one as "not an expense"
 * teaches the app to skip that merchant, and marking it back un-teaches.
 *
 * A due is exempt from that memory. "This reminder is not a spend" is a fact about the
 * message, not a verdict on the merchant, and learning it would silently stop logging
 * the real charge that follows.
 */
export async function setExpense(
  id: number,
  isExpense: boolean,
  merchant: string | null,
  isDue = false
): Promise<void> {
  const d = await getDb();
  const flag = isExpense ? 1 : 0;
  // Marking money-in as an expense clears the income flag, so a row can never count on
  // both sides of the month at once.
  await d.runAsync(
    'UPDATE expenses SET is_expense = ?, is_income = CASE WHEN ? = 1 THEN 0 ELSE is_income END, updated_at = ? WHERE id = ?',
    flag,
    flag,
    stamp(),
    id
  );
  if (!merchant || isDue) return;
  if (isExpense) await removeExclusion(merchant);
  else await addExclusion(merchant);
}

/** Just enough of a row to let the user tell two same-merger transactions apart. */
export type SimilarExpense = {
  id: number;
  merchant: string;
  amount_paise: number;
  category: Category;
  txn_at: number;
};

/**
 * Counted rows elsewhere in history that share this merchant.
 *
 * Compared on the same normalised key <setExpense> writes to `exclusions`, so "similar"
 * means exactly the merchant the app is about to stop logging forever. Matching on
 * category instead would sweep in unrelated shops that merely filed the same way.
 *
 * The merchant is normalised in JS rather than SQL because only the JS key knows the
 * rules; dues are already out of the totals, so `is_expense = 1` leaves them alone.
 * `raw_sms` is deliberately not selected — the picker shows amount, category and date,
 * and pulling every message body in history to do it would be a pointless transfer.
 */
export async function listSimilarExpenses(merchant: string): Promise<SimilarExpense[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<SimilarExpense & { merchant: string | null }>(
    'SELECT id, merchant, amount_paise, category, txn_at FROM expenses ' +
      'WHERE is_expense = 1 AND merchant IS NOT NULL'
  );
  const key = exclusionKey(merchant);
  return rows.filter((r) => exclusionKey(r.merchant as string) === key);
}

/**
 * Takes a batch of rows out of the totals in one statement.
 *
 * One statement, so a batch cannot half-apply if the app is killed midway, and one
 * round trip instead of one per row. No merchant memory is written here: the caller has
 * already been through <setExpense>, which is what teaches the app to skip them.
 */
export async function markNotExpenses(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const d = await getDb();
  await d.runAsync(
    `UPDATE expenses SET is_expense = 0, updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    stamp(),
    ...ids
  );
}

/**
 * Danger zone. Deletes every row and tombstones each one, so a synced device deletes
 * them too rather than quietly pushing them all back on the next sync.
 */
export async function clearAll(): Promise<void> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ client_id: string }>('SELECT client_id FROM expenses');
  const at = stamp();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM expenses');
    for (const r of rows) {
      await d.runAsync(
        `INSERT INTO tombstones (kind, key, updated_at) VALUES ('expense', ?, ?)
         ON CONFLICT (kind, key) DO UPDATE SET updated_at = excluded.updated_at`,
        r.client_id,
        at
      );
    }
  });
}

export async function getPref(key: string): Promise<string | null> {
  const d = await getDb();
  return (await d.getFirstAsync<{ value: string }>('SELECT value FROM prefs WHERE key = ?', key))
    ?.value ?? null;
}

export async function setPref(key: string, value: string): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO prefs (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

/* ---------------------------------------------------------------------------
 * Everything below exists only for sync.ts. Kept here rather than in sync.ts so the
 * SQL stays in one file and a query change cannot miss a writer.
 * ------------------------------------------------------------------------- */

/** One local row in the wire shape. `dedupe_key` is needed so the server can dedupe too. */
export type PushableExpense = {
  clientId: string;
  amountPaise: number;
  merchant: string | null;
  category: string;
  txnAt: number;
  note: string | null;
  rawSms: string;
  dedupeKey: string;
  source: string;
  isExpense: boolean;
  isDue: boolean;
  isIncome: boolean;
  deleted: boolean;
};

/**
 * Everything changed since `since`, oldest first.
 *
 * `since` is the last successful sync's watermark, and rows carry the stamp they were
 * given when they were written, so a row edited twice is sent once with its final value.
 */
export async function expensesSince(since: number): Promise<PushableExpense[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{
    client_id: string;
    amount_paise: number;
    merchant: string | null;
    category: string;
    txn_at: number;
    note: string | null;
    raw_sms: string;
    dedupe_key: string;
    source: string;
    is_expense: number;
    is_due: number;
    is_income: number;
  }>('SELECT * FROM expenses WHERE updated_at > ? ORDER BY updated_at', since);

  const tombs = await tombstonesSince(since, 'expense');
  const deleted = new Set(tombs.map((t) => t.key));

  const live = rows.map((r) => ({
    clientId: r.client_id,
    amountPaise: r.amount_paise,
    merchant: r.merchant,
    category: r.category,
    txnAt: r.txn_at,
    note: r.note,
    rawSms: r.raw_sms,
    dedupeKey: r.dedupe_key,
    source: r.source,
    isExpense: r.is_expense === 1,
    isDue: r.is_due === 1,
    isIncome: r.is_income === 1,
    deleted: false,
  }));

  return [
    ...live,
    // A tombstone carries no payload; the server only needs to know the row is gone.
    ...[...deleted].map((key) => ({
      clientId: key,
      amountPaise: 0,
      merchant: null,
      category: '',
      txnAt: 0,
      note: null,
      rawSms: '',
      dedupeKey: '',
      source: '',
      isExpense: false,
      isDue: false,
      isIncome: false,
      deleted: true,
    })),
  ];
}

export async function budgetsSince(since: number): Promise<{ category: string; monthlyPaise: number; deleted: boolean }[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ category: string; monthly_paise: number }>(
    'SELECT category, monthly_paise FROM budgets WHERE updated_at > ? ORDER BY updated_at',
    since
  );
  const deleted = new Set((await tombstonesSince(since, 'budget')).map((t) => t.key));
  return [
    ...rows.map((r) => ({ category: r.category, monthlyPaise: r.monthly_paise, deleted: false })),
    ...[...deleted].map((category) => ({ category, monthlyPaise: 0, deleted: true })),
  ];
}

export async function exclusionsSince(since: number): Promise<{ merchant: string; deleted: boolean }[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ merchant: string }>(
    'SELECT merchant FROM exclusions WHERE updated_at > ? ORDER BY updated_at',
    since
  );
  const deleted = new Set((await tombstonesSince(since, 'exclusion')).map((t) => t.key));
  return [
    ...rows.map((r) => ({ merchant: r.merchant, deleted: false })),
    ...[...deleted].map((merchant) => ({ merchant, deleted: true })),
  ];
}

async function tombstonesSince(since: number, kind: string): Promise<Tombstone[]> {
  const d = await getDb();
  return d.getAllAsync<Tombstone>(
    'SELECT kind, key, updated_at FROM tombstones WHERE kind = ? AND updated_at > ?',
    kind,
    since
  );
}

/** A remote row. Same shape the server sends, which is the wire shape. */
export type RemoteExpense = {
  clientId: string;
  amountPaise: number;
  merchant: string | null;
  category: string;
  txnAt: number;
  note: string | null;
  rawSms: string;
  dedupeKey: string;
  source: string;
  isExpense: boolean;
  isDue: boolean;
  isIncome: boolean;
  deletedAt: number | null;
};

/**
 * Applies one pulled expense, or deletes it when it arrives as a tombstone.
 *
 * `INSERT OR REPLACE` on `client_id`, matched on the partial unique index. A remote row
 * that collides on `dedupe_key` instead — the same SMS captured on two phones — is
 * reported by the server as a duplicate before it gets here, so this never sees one.
 *
 * `updated_at` is set to the arrival stamp rather than the sender's, so a row pulled from
 * the other phone does not look like a local edit and get pushed straight back.
 */
export async function applyRemote(row: RemoteExpense): Promise<void> {
  const d = await getDb();
  const at = stamp();

  if (row.deletedAt !== null) {
    await d.withTransactionAsync(async () => {
      await d.runAsync('DELETE FROM expenses WHERE client_id = ?', row.clientId);
      await d.runAsync(
        `INSERT INTO tombstones (kind, key, updated_at) VALUES ('expense', ?, ?)
         ON CONFLICT (kind, key) DO NOTHING`,
        row.clientId,
        at
      );
    });
    return;
  }

  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM expenses WHERE client_id = ?', row.clientId);
    await clearTombstone(d, 'expense', row.clientId);
    await d.runAsync(
      `INSERT OR REPLACE INTO expenses
         (client_id, amount_paise, merchant, category, txn_at, note, raw_sms,
          dedupe_key, source, is_expense, is_due, is_income, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.clientId,
      row.amountPaise,
      row.merchant,
      row.category,
      row.txnAt,
      row.note,
      row.rawSms,
      row.dedupeKey,
      row.source,
      row.isExpense ? 1 : 0,
      row.isDue ? 1 : 0,
      row.isIncome ? 1 : 0,
      at
    );
  });
}

export async function applyRemoteBudget(b: {
  category: string;
  monthlyPaise: number;
  deletedAt: number | null;
}): Promise<void> {
  const d = await getDb();
  const at = stamp();
  await d.withTransactionAsync(async () => {
    if (b.deletedAt !== null) {
      await d.runAsync('DELETE FROM budgets WHERE category = ?', b.category);
      await d.runAsync(
        `INSERT INTO tombstones (kind, key, updated_at) VALUES ('budget', ?, ?)
         ON CONFLICT (kind, key) DO NOTHING`,
        b.category,
        at
      );
      return;
    }
    await clearTombstone(d, 'budget', b.category);
    await d.runAsync(
      `INSERT INTO budgets (category, monthly_paise, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (category) DO UPDATE SET monthly_paise = excluded.monthly_paise,
                                          updated_at = excluded.updated_at`,
      b.category,
      b.monthlyPaise,
      at
    );
  });
}

export async function applyRemoteExclusion(x: { merchant: string; deletedAt: number | null }): Promise<void> {
  const d = await getDb();
  const at = stamp();
  await d.withTransactionAsync(async () => {
    if (x.deletedAt !== null) {
      await d.runAsync('DELETE FROM exclusions WHERE merchant = ?', x.merchant);
      await d.runAsync(
        `INSERT INTO tombstones (kind, key, updated_at) VALUES ('exclusion', ?, ?)
         ON CONFLICT (kind, key) DO NOTHING`,
        x.merchant,
        at
      );
      return;
    }
    await clearTombstone(d, 'exclusion', x.merchant);
    await d.runAsync(
      `INSERT INTO exclusions (merchant, updated_at) VALUES (?, ?)
       ON CONFLICT (merchant) DO UPDATE SET updated_at = excluded.updated_at`,
      x.merchant,
      at
    );
  });
}

/** Drops the local copy of a row the server already holds under another clientId. */
export async function dropByClientId(clientId: string): Promise<void> {
  const d = await getDb();
  await d.runAsync('DELETE FROM expenses WHERE client_id = ?', clientId);
}

export async function highestStamp(): Promise<number> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ m: number | null }>(
    `SELECT MAX(m) AS m FROM (
       SELECT MAX(updated_at) AS m FROM expenses
       UNION ALL SELECT MAX(updated_at) FROM budgets
       UNION ALL SELECT MAX(updated_at) FROM exclusions
       UNION ALL SELECT MAX(updated_at) FROM tombstones
     )`,
  );
  return row?.m ?? 0;
}