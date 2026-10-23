package expo.modules.expensesms

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import org.json.JSONObject

/**
 * Manifest-declared so it runs even when the app process is not alive. Everything is
 * queued first, then flushed: the flush is a no-op with no JS attached, and the next
 * app start replays the queue, so nothing is lost while the app is closed.
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val parts = try {
      Telephony.Sms.Intents.getMessagesFromIntent(intent)
    } catch (e: Exception) {
      null
    } ?: return

    // A long SMS arrives as several PDU parts; the provider stores them joined
    // into one message. Queue the joined text so the live body matches the
    // body a later inbox scan will read - otherwise the scan logs it again.
    val body = parts.joinToString(separator = "") { it.messageBody ?: "" }
    val date = parts.firstOrNull()?.timestampMillis ?: 0L
    val address = parts.firstOrNull()?.originatingAddress ?: ""

    val queue = SmsStore.load(context)
    val o = JSONObject()
    o.put("address", address)
    o.put("body", body)
    o.put("date", date)
    queue.put(o)
    SmsStore.add(context, queue)

    // Post a native heads-up when the app is dead: the JS path (notifyExpense) never
    // runs because no JS bundle is loaded. When a JS sink is attached the live-capture
    // path notifies instead, so exactly one notification is posted either way.
    if (!SmsBridge.isAttached()) postNativeNotification(context, address, body, date)

    SmsBridge.flush(context, false)
  }

  /**
   * Posts a heads-up for a message that arrived while the app was dead.
   *
   * The filters mirror the rejection rules in `src/lib/parse.ts`: a message the parser
   * would not log as a spend must not raise a notification either.
   */
  private fun postNativeNotification(context: Context, address: String, body: String, timestamp: Long) {
    // The channel form of the builder needs API 26; this app supports 24.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (body.trim().isEmpty()) return
    if (OTP_RE.containsMatchIn(body)) return
    if (PROMO_RE.containsMatchIn(body)) return
    // A running balance on its own is not a spend, but a spend that quotes the balance
    // is. The same rule the parser uses: the balance only rules the message out when
    // nothing else in it is a transaction.
    if (BALANCE_RE.containsMatchIn(body) && !TXN_RE.containsMatchIn(body)) return

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(CHANNEL_ID, "Expenses", NotificationManager.IMPORTANCE_HIGH)
      channel.description = "Bank SMS spends"
      manager.createNotificationChannel(channel)
    }

    try {
      val builder = android.app.Notification.Builder(context, CHANNEL_ID)
        .setContentTitle("Expense detected: $address")
        .setContentText(body.take(120))
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setPriority(android.app.Notification.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setStyle(android.app.Notification.BigTextStyle().bigText(body))
      // The id comes from the message, so a repeat of the same SMS replaces its own
      // notification instead of stacking another one.
      manager.notify((body.hashCode() xor timestamp.toInt()) and Int.MAX_VALUE, builder.build())
    } catch (e: Exception) {
      // No POST_NOTIFICATIONS permission, or nothing to post to: there is nothing to do.
    }
  }

  companion object {
    /** The same channel the JS notification path uses. */
    private const val CHANNEL_ID = "expenses"

    /** Mirrors the REJECT list in `src/lib/parse.ts`. */
    private val OTP_RE =
      Regex("""\b(otp|one[\s-]?time (password|code)|verification code|security code|do not share)\b""", RegexOption.IGNORE_CASE)
    private val BALANCE_RE =
      Regex("""\b(avl\.?\s*bal|avail(able)? bal|available balance|your balance is|balance due)\b""", RegexOption.IGNORE_CASE)
    private val PROMO_RE =
      Regex("""\b(pre[\s-]?approved|apply now|offer|voucher|lucky draw|click here|limited period|% ?off)\b""", RegexOption.IGNORE_CASE)
    /** The words that make a message a transaction, so a quoted balance does not veto it. */
    private val TXN_RE =
      Regex("""\b(debited|credited|spent|charged|paid|purchased|transferred|remitted|refund(ed)?|withdrawn|received)\b""", RegexOption.IGNORE_CASE)
  }
}
