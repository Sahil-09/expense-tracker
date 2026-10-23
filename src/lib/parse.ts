import { toPaise } from './money';
import { detectKnownMerchant } from './categories';

export type Direction = 'debit' | 'credit';

export type Parsed = {
  amountPaise: number;
  merchant: string | null;
  txnAt: number;
  direction: Direction;
  /** 'due' announces a charge that has not happened yet; see REMINDER. */
  kind: SpendKind;
};

export type SpendKind = 'spend' | 'due' | 'transfer' | 'income';

export type ParseResult = { ok: true; parsed: Parsed } | { ok: false; reason: string };

// Checked before anything else. Anything matching is not a spend.
const REJECT = [
  [/\b(otp|one[\s-]?time (password|code)|verification code|security code|do not share)\b/i, 'otp'],
  [/\b(avl\.?\s*bal|avail(able)? bal|available balance|your balance is|balance due)\b/i, 'balance-enquiry'],
  [/\b(failed|declined|reversed|unsuccessful|could not be)\b/i, 'failed-transaction'],
  [/\b(pre[\s-]?approved|apply now|offer|voucher|lucky draw|click here|limited period|% ?off)\b/i, 'promotion'],
] as const;

// No `g` flag: detectDirection tests these repeatedly, and a global regex carries
// lastIndex between calls, which would make the answer depend on call order.
const CREDIT =
  /\b(credited|received|remitted|refund(?:ed)?|salary|interest earned|cashback)|\bcr\.?\s+(?=₹|rs\.?|inr|\d)/i;

/**
 * Money demonstrably left the account. Beats CREDIT, so "debited ... cashback credited" stays a spend.
 *
 * "Dr." is Canara's shorthand for a debit, but the bare word is also a title, so it only
 * counts when an amount follows it: "Dr. INR 1,680.00" is a spend, "Dr. Smith's clinic" is not.
 */
const DEBIT_STRONG =
  /\b(debited|spent|charged|paid|withdrawn|purchased)\b|\bdr\.?\s+(?=₹|rs\.?|inr|\d)/i;

/**
 * Names a payment without saying one left. Loses to CREDIT, so "Payment of Rs 500 has
 * been received" and "Rs 50 cashback sent" are both income, while a bare "Sent Rs.40" or
 * an "EMI ... is due" reminder is a spend you owe.
 */
const DEBIT_WEAK = /\b(payment of|purchase of|paid to|sent|due)\b/i;

/**
 * Announces a charge that has not happened yet, rather than reporting one that did.
 *
 * The bank sends both messages: "your payment of INR 149 is due on 21/07" and then
 * "Transaction of Rs.149.00 ... has been debited". Counting the first double-charges the
 * month, so these are logged to keep the obligation visible but never counted.
 *
 * Anchored on reminder phrasing and never on a bare "due", so a real debit that happens
 * to mention a due date still parses as a spend.
 */
const REMINDER =
  /\b(is due (on|by)|has been generated|is generated|bill (for|generated)|will be processed|will be debited|will be charged|upcoming mandate|(?:min|max|total)\s+(?:amt|amount)\s+due\b|payable\s+(?:by|on)\b)\b/i;

export function isDueMessage(body: string): boolean {
  return REMINDER.test(body);
}

/**
 * Banks style words in mathematical letters ("𝐂𝐫𝐞𝐝𝐢𝐭𝐞𝐝"), and every keyword above is
 * written in plain ASCII, so a styled credit reads as no direction at all and is
 * dropped. Folding just that block back to ASCII is enough; NFKD over the whole body
 * would also decompose the rupee sign and the dashes the parser relies on.
 */
const STYLED_LETTERS = /[\u{1D400}-\u{1D7FF}]/gu;

function fold(body: string): string {
  return body.replace(STYLED_LETTERS, (c) => c.normalize('NFKD'));
}

/**
 * A destination the user can bank at.
 *
 * Banks are matched on stems that survive HDFC's payee truncation: the real message
 * reads "To Suryoday Small Finance Ba", not "...Bank", so matching on "bank" alone finds
 * nothing. "Small finance" covers Unity, Suryoday, AU, Equitas and friends; the short
 * names are the majors. Bajaj Finance is deliberately absent — an EMI paid to a lender is
 * a Bill, not a transfer.
 */
const BANK_DEST =
  /\b(bank|small finance|hdfc|sbi|icici|axis|kotak|idfc|indusind|canara|punjab national|union bank|federal bank|equitas|standard chartered|hsbc|citi)\b/i;

/** The payee of a "Sent/Transferred ... To <X>" message, stopping at the trailing date/ref. */
const TO_DEST = /\bto\s+([A-Za-z][A-Za-z .&'-]{1,28}?)(?:\s+on\b|\s+ref\b|\s{2,}|$)/i;

/**
 * Money moving between the user's own accounts, not spending.
 *
 * Matched on the *destination* rather than the message shape, because a real purchase
 * wears the same wording: "Sent Rs.13005 From HDFC Bank A/C *5391 To Amazon India" is a
 * genuine spend, while "... To Suryoday Small Finance Bank" is not.
 *
 * shortcut: CheQ and person-to-person sends are deliberately not treated as transfers.
 * Add them here once confirmed they are always the user's own accounts.
 */
export function isTransferMessage(body: string): boolean {
  const m = body.match(TO_DEST);
  return m !== null && BANK_DEST.test(m[1]);
}

/** What kind of row a raw message should become. Also used to re-check stored rows. */
export function classify(body: string): SpendKind {
  const text = fold(body);
  if (isDueMessage(text)) return 'due';
  if (isTransferMessage(text)) return 'transfer';
  // A credit is money in, not a spend. It is stored so the month can show net spend,
  // but it is never counted as an expense.
  if (detectDirection(text) === 'credit') return 'income';
  return 'spend';
}

const AMOUNT_PATTERNS = [
  // Axis card statements write the total as "INR  Dr. 13436.07": currency, debit marker, number.
  /(?:₹|rs\.?|inr)\s?(?:dr\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i, // Rs.500 / Rs 500 / ₹500 / INR 500 / INR Dr. 500
  /([\d,]+(?:\.\d{1,2})?)\s*(?:inr|rs\.?|₹)/i, // 5000 INR / 500.00 INR
  // `by` is allowed because SBI UPI writes "debited by 1.00". The digit floor stays for
  // whole numbers, so a reference number or helpline is never read as money, but an
  // explicit decimal point is proof enough to allow amounts under Rs 100 — exactly the
  // range UPI mandates and small test payments live in.
  /\b(?:debited|spent|charged|paid|purchased|of|for|towards)\s+(?:by\s+)?(?:₹|rs\.?|inr)?\s?([\d,]{3,}(?:\.\d{1,2})?|\d{1,2}\.\d{1,2})/i,
];

const MERCHANT_PATTERNS = [
  /\b(?:at|to)\s+([A-Za-z0-9][A-Za-z0-9 .&'/-]{1,38}?)\s+on\s+\d/i,
  // `refno` terminates the scrape alongside `ref`: SBI writes "Refno 628502247435" with
  // no word break after "ref", so the old boundary missed and the name fell through to
  // the "for other services" helpline span further down the same message.
  /\b(?:at|to)\s+([A-Za-z0-9][A-Za-z0-9 .&'/-]{1,38}?)\s+(?:avail|ref(?:no)?\b|txn|transaction)/i,
  // Canara-style UPI SMS puts a separator before the UPI/ref clause: "to Famous Chick; UPI: ...".
  /\b(?:at|to)\s+([A-Za-z0-9][A-Za-z0-9 .&'/-]{1,38}?)\s*[;,]\s*(?:upi|ref|txn|transaction|avail)/i,
  /\btowards\s+([A-Za-z0-9][A-Za-z0-9 .&'/-]{1,38}?)(?:\s+on|\s*,|$)/i,
  /\bfor\s+([A-Za-z0-9][A-Za-z0-9 .&'/-]{1,38}?)(?:\s+on\s|\s+using|\s*$)/i,
];

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

function detectDirection(body: string): Direction | null {
  if (DEBIT_STRONG.test(body)) return 'debit';
  if (CREDIT.test(body)) return 'credit';
  if (DEBIT_WEAK.test(body)) return 'debit';
  return null;
}

/**
 * The words that introduce a running balance rather than a transaction.
 *
 * "Avl bal: INR 1,30,477.87" trails every HDFC credit, and it is the larger number, so
 * a parser that takes the first currency match can log the balance as the amount.
 * "Avl Limit" is a credit limit, which is also never a transaction.
 *
 * Each branch carries its own word boundary: a shared one after the group would never
 * match the branches that end in a colon, and would fail on "total balance" too.
 */
const BALANCE_MARK =
  /\b(?:avl\.?\s*(?:bal|balance|limit)\b|avail(?:able)?\s*(?:bal|balance)\b|total\s*bal(?:ance)?\b|closing\s*bal(?:ance)?\b|bal\.?\s*:(?!\w)|balance\s*(?:is|due)\b)/i;

/** Every amount in the body, with the text that introduces it. */
function amountCandidates(body: string): { paise: number; before: string }[] {
  const out: { paise: number; before: string }[] = [];
  for (const re of AMOUNT_PATTERNS) {
    // A copy with the global flag, so every occurrence is seen. The originals stay
    // flagless: a global regex carries lastIndex between calls.
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(body)) !== null) {
      const paise = toPaise(m[1]);
      if (paise) out.push({ paise, before: body.slice(Math.max(0, m.index - 26), m.index) });
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  }
  return out;
}

function extractAmount(body: string): number | null {
  for (const c of amountCandidates(body)) if (!BALANCE_MARK.test(c.before)) return c.paise;
  return null;
}

const NOISE = /\b(hdfc|icici|axis|sbi|kotak|idfc|yes ?bank|kotak mahindra|pnb|bob|canara|union bank|indusind|kotak|account|a\/c|upi|imps|neft|rtgs|credit card|debit card|card|ref)\b/gi;

function extractMerchant(body: string): string | null {
  for (const re of MERCHANT_PATTERNS) {
    const m = body.match(re);
    if (!m) continue;
    const cleaned = m[1]
      .replace(/[^\w .&'/-]/g, '')
      .replace(NOISE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 3) return cleaned;
  }
  return null;
}

/** Local noon avoids DST shifting a midnight timestamp into the previous day. */
function parseBodyDate(body: string): number | null {
  let m = body.match(new RegExp(`(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2,4})`));
  if (m) return build(+m[3], +m[2], +m[1]);

  m = body.match(new RegExp(`(\\d{1,2})[ -](${MONTHS})[a-z]*[ -](\\d{2,4})`, 'i'));
  if (m) {
    const month = MONTHS.split('|').indexOf(m[2].toLowerCase()) + 1;
    return build(+m[3], month, +m[1]);
  }
  return null;
}

function build(year: number, month: number, day: number): number | null {
  const y = year < 100 ? (year < 70 ? 2000 + year : 1900 + year) : year;
  const t = new Date(y, month - 1, day, 12).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Extracts a spend from raw SMS text.
 *
 * `receivedAt` is the platform timestamp. Pass null for pasted/shared text with no
 * reliable time; the in-body date is then used, and the message is rejected if it has none.
 *
 * shortcut: tuned to common Indian bank formats (HDFC/SBI/ICICI style). Unknown banks
 * will fall through to reason 'no-amount' or 'no-direction'; add a pattern above once you
 * have a real sample that fails.
 */
export function parseSms(body: string, receivedAt: number | null): ParseResult {
  const text = fold(body).replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty' };

  const direction = detectDirection(text);
  const amountPaise = extractAmount(text);

  for (const [re, reason] of REJECT) {
    // A credit SMS often quotes the running balance too. The credit is the transaction;
    // the balance is not. So this only vetoes when the message carries no other money.
    if (reason === 'balance-enquiry' && direction !== null && amountPaise !== null) continue;
    if (re.test(text)) return { ok: false, reason };
  }

  if (direction === null) return { ok: false, reason: 'no-direction' };
  if (!amountPaise) return { ok: false, reason: 'no-amount' };

  const txnAt = receivedAt ?? parseBodyDate(text) ?? null;
  if (txnAt === null) return { ok: false, reason: 'no-date' };

    // A known brand is a truer name than the at/to scrape, so it wins when present.
  const merchant = detectKnownMerchant(text) ?? extractMerchant(text);

  return {
    ok: true,
    parsed: { amountPaise, merchant, txnAt, direction, kind: classify(text) },
  };
}

/** The running balance a message quotes, and the account it belongs to. */
type ParsedBalance = { account: string; amountPaise: number };

/**
 * The balance phrase, and the number that follows it.
 *
 * "Avl bal: INR 1,30,477.87" and "Available balance: Rs.1,30,477.87" are the two shapes
 * Indian banks use. The number is captured by the phrase, so a transaction amount earlier
 * in the message cannot be mistaken for it.
 */
const BALANCE_PHRASE =
  /\b(?:avl\.?\s*(?:bal|balance)\b|avail(?:able)?\s*(?:bal|balance)\b|total\s*bal(?:ance)?\b|closing\s*bal(?:ance)?\b|bal\.?\s*:(?!\w)|balance\s*is\b)[^0-9]{0,14}?(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i;

/** "HDFC Bank A/c XX5391" -> the bank and the masked account number. */
const ACCOUNT_PAIR = /\b([A-Za-z]{3,12})\s+Bank\s+A\/c\s*\*?\s*([A-Za-z0-9]{3,})/i;
const ACCOUNT_ONLY = /\bA\/c\s*\*?\s*([A-Za-z0-9]{4,})/i;

const KNOWN_BANK =
  /\b(hdfc|sbi|icici|axis|kotak|idfc|indusind|canara|pnb|yes\s*bank|union\s*bank|federal\s*bank|equitas|citi|hsbc|standard\s*chartered)\b/i;

/**
 * Reads the balance a message quotes, if it quotes one.
 *
 * A bank SMS often ends with the balance of the account it is talking about, and that
 * number is worth keeping even when the message itself is not a transaction — a message
 * that only says "Avl bal: INR 1,30,477.87" is skipped as a balance enquiry, and
 * without this its balance would be thrown away with it.
 *
 * The account is the masked number the message names, with the bank for readability.
 * Messages that name no account fall back to the bank, then to a generic key.
 */
export function parseBalance(body: string): ParsedBalance | null {
  const text = fold(body).replace(/\s+/g, ' ').trim();
  const m = BALANCE_PHRASE.exec(text);
  if (!m) return null;
  const amountPaise = toPaise(m[1]);
  if (!amountPaise) return null;

  const pair = ACCOUNT_PAIR.exec(text);
  const only = ACCOUNT_ONLY.exec(text);
  const bank = (pair?.[1] ?? KNOWN_BANK.exec(text)?.[1] ?? '').toUpperCase();
  const acct = pair?.[2] ?? only?.[1] ?? null;

  const account = bank && acct ? `${bank} ${acct}` : bank || acct || 'Account';
  return { account, amountPaise };
}
