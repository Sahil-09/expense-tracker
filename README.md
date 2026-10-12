# Expense Tracker

Turns bank SMS into expenses.

- **Android** — reads the inbox and captures new bank SMS automatically.
- **iOS** — Apple gives no app permission to read the SMS inbox, so intake is via the
  share sheet (Messages → Share → this app) or by pasting the text.

## Running it

This app has a custom native module, so **Expo Go will not work**. You need a dev build.

```bash
npm install
npm run android        # or: npx expo run:android
npm run ios            # needs macOS + Xcode for the iOS share extension
```

Requires JDK 17+ for the Android build.

## Checks

```bash
npm test        # parser unit tests
npm run typecheck
npm run lint
```

## How it fits together

Every SMS source funnels through one function, so there is a single place to fix parsing:

```
Android inbox (ContentResolver) ─┐
Android live broadcast ──────────┼─> ingestSms() ─> parseSms() ─> expenses table
iOS share sheet / paste ─────────┘
```

| File | What it owns |
| --- | --- |
| `src/lib/parse.ts` | Raw text → amount, date, merchant. Pure, no I/O. |
| `src/lib/db.ts` | SQLite schema and queries. |
| `src/lib/money.ts` | Paise (integer) maths and INR formatting. |
| `src/lib/categories.ts` | Merchant keyword → category. |
| `src/lib/sms.ts` | Android permission, inbox scan, live subscription. |
| `modules/expense-sms/` | Kotlin: `readInbox()` + `SMS_RECEIVED` receiver. |

Money is stored as **integer paise**, never floats.

Duplicate protection uses the normalised message text plus its date as a unique key, so
re-scanning the inbox cannot double-post. `INSERT OR IGNORE` does the check and the write
in a single statement.

### Tuning the parser

`src/lib/parse.ts` is currently written against **common Indian bank formats without real
samples**. Messages that do not match come back with a `reason` (`otp`, `income`,
`no-amount`, `no-direction`, `no-date`, `failed-transaction`, `promotion`) instead of
being guessed at.

If a real SMS is missed, add its format to `AMOUNT_PATTERNS` / `MERCHANT_PATTERNS` /
`REJECT` and add a case to `src/lib/parse.test.ts`. Income is deliberately rejected — a
"credited" message is not a spend.

### Swapping in an LLM later

`parseSms(body, receivedAt)` returns `{ ok: true, parsed }` or `{ ok: false, reason }`.
A second implementation with that same signature can be dropped in without touching any
other file.

## Limitations

- **Play Store** rejects `READ_SMS` for anything that is not a default SMS app. Build this
  to your own device (EAS or local) rather than shipping it.
- The iOS share extension is flagged experimental by Expo.
- Some OEMs suppress `SMS_RECEIVED` for non-default SMS apps. If live capture is silent on
  your phone, use **Settings → Scan inbox now**, which reads history directly.
- A full 90-day inbox scan runs inserts on the JS thread and can take a few seconds.
- `expo lint` reports one pre-existing error in `src/hooks/use-color-scheme.web.ts`, which
  came with the Expo template and is untouched by this app.