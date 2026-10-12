package expo.modules.expensesms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
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

    val queue = SmsStore.load(context)
    for (m in parts) {
      val o = JSONObject()
      o.put("address", m.originatingAddress ?: "")
      o.put("body", m.messageBody ?: "")
      o.put("date", m.timestampMillis)
      queue.put(o)
    }
    SmsStore.add(context, queue)
    // This message is arriving now, so it is not a replay of an earlier one.
    SmsBridge.flush(context, false)
  }
}