# iOS SMS → Backend API (Apple Shortcut)

iOS has no SMS-reading API and no app is installed on the phone, so the
Shortcut pushes each bank SMS directly to the sync server over HTTP. The
server (or a later sync) ingests it; the phone itself does nothing.

## Flow

1. A bank SMS arrives.
2. The Shortcut automation extracts the message body.
3. It POSTs `{ body, receivedAt }` to `${EXPO_PUBLIC_SYNC_URL}/sms`
   with `Authorization: Bearer <access token>`.
4. The server dedupes, parses, and stores the expense with the same rules
   as `src/lib/parse.ts` (ported to `expense-tracker-api/src/sms/`).
5. A device that later syncs pulls the expense on its next `/sync`. The
   server does not send push notifications on its own.

## Create the Shortcut (one time)

In the Shortcuts app on iPhone:

1. **Automation** tab → **+** → **Message**.
   - Sender: (optional filter, e.g. your bank's sender ID)
   - Run Immediately (or "Ask Before Running").
2. Add actions:
   - **Get Details of Message** → Detail: **Content**.
   - **Get Contents of URL**:
     - URL: `https://<your-server>/sms`
     - Method: **POST**
     - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
     - Request Body (JSON): `{ "body": <content>, "receivedAt": <message date> }`
3. (Optional) **Show Notification** "SMS pushed" so you see it happened.

## Token

Do not paste a normal access token: it expires after 15 minutes and the Shortcut will
start failing silently. Set `SMS_INGEST_TOKEN` (and `SMS_USER_EMAIL`) in the server's
`.env`, redeploy, and paste that token once. It does not expire; rotate it by changing the
env value and updating the Shortcut. If left unset, `/sms` only accepts a normal access
token, which is usable for a quick test but not for an automation.

## Server contract

`POST /sms`  (authenticated with the same bearer token `/sync` uses)
```json
{ "body": "Rs.500 debited at SWIGGY on 19/10/2026", "receivedAt": 173... }
```
Response: `201 { "status": "added", "clientId": "..." }`,
`201 { "status": "duplicate" }`, or
`201 { "status": "skipped", "reason": "otp" | "promotion" | ... }`.
A credit is stored as income and never counted as an expense, so it comes back
as `added`, not `skipped`.

`receivedAt` is optional; without it the date written inside the SMS is used.
The server dedupes on `(body, day)` exactly like `dedupeKey` in
`src/lib/db.ts`, honours the user's exclusions, and applies the parse/classify
rules from `src/lib/parse.ts`. A row it creates is an ordinary expense, so the
next `/sync` pulls it to any connected device.

## Fallback (no server)

If the server is unreachable, the Shortcut can fall back to the app URL
scheme instead: `expensetracker://import?sms=<encoded>` (handled by
`src/app/import.tsx`). Keep both actions in the Shortcut with an
"if request failed" branch.

## Notes

- No native app install required on the phone.
- `EXPO_PUBLIC_SYNC_URL` is the base URL; reuse it in the Shortcut.
- The Android path (`src/lib/sms.ts`) is unaffected and keeps using
  `ingestSms` locally.
