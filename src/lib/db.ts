import * as SQLite from 'expo-sqlite';

import { categorize, type Category } from './categories';
import { addMonths, monthStart } from './money';
import { parseSms, classify } from './parse';

export type Expense = {
  id: number;
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
};

export type Budget = { category: Category; monthly_paise: number };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

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
      is_expense INTEGER NOT NULL DEFAULT 1
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

  // A transfer is never a spend, and naming it beats the merchant scrape, which reads
  // "Suryoday Small Finance Ba" and cannot match a category rule.
  const category: Category = kind === 'transfer' ? 'Transfer' : categorize(merchant ?? body);

  // A payment the user once flagged as personal must never come back as a spend.
  if (merchant && (await isExcluded(merchant))) {
    return { status: 'skipped', reason: 'not-expense' };
  }

  // INSERT OR IGNORE does the dedupe check and the write in one statement, so a second
  // import of the same SMS cannot slip a duplicate past a separate lookup.
  const info = await d.runAsync(
    `INSERT OR IGNORE INTO expenses
       (amount_paise, merchant, category, txn_at, note, raw_sms, dedupe_key, source, is_expense, is_due)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    amountPaise,
    merchant,
    category,
    txnAt,
    body,
    dedupeKey(body, txnAt),
    source,
    kind === 'spend' ? 1 : 0,
    isDue
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
      'UPDATE expenses SET is_due = ?, is_expense = 0, category = ? WHERE id = ?',
      kind === 'due' ? 1 : r.is_due,
      kind === 'transfer' ? 'Transfer' : r.category,
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
    `INSERT INTO budgets (category, monthly_paise) VALUES (?, ?)
     ON CONFLICT (category) DO UPDATE SET monthly_paise = excluded.monthly_paise`,
    category,
    monthlyPaise
  );
}

export async function getExpense(id: number): Promise<Expense | null> {
  const d = await getDb();
  return (await d.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ?', id)) ?? null;
}

export async function deleteExpense(id: number): Promise<void> {
  const d = await getDb();
  await d.runAsync('DELETE FROM expenses WHERE id = ?', id);
}

export async function setCategory(id: number, category: Category): Promise<void> {
  const d = await getDb();
  await d.runAsync('UPDATE expenses SET category = ? WHERE id = ?', category, id);
}

/** Blank is stored as NULL so an untouched note stays indistinguishable from no note. */
export async function setNote(id: number, note: string): Promise<void> {
  const d = await getDb();
  const trimmed = note.trim();
  await d.runAsync(
    'UPDATE expenses SET note = ? WHERE id = ?',
    trimmed === '' ? null : trimmed,
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

export async function addExclusion(merchant: string): Promise<void> {
  const d = await getDb();
  await d.runAsync('INSERT OR IGNORE INTO exclusions (merchant) VALUES (?)', exclusionKey(merchant));
}

export async function removeExclusion(merchant: string): Promise<void> {
  const d = await getDb();
  await d.runAsync('DELETE FROM exclusions WHERE merchant = ?', exclusionKey(merchant));
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
  await d.runAsync('UPDATE expenses SET is_expense = ? WHERE id = ?', isExpense ? 1 : 0, id);
  if (!merchant || isDue) return;
  if (isExpense) await removeExclusion(merchant);
  else await addExclusion(merchant);
}

export async function clearAll(): Promise<void> {
  const d = await getDb();
  await d.runAsync('DELETE FROM expenses');
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