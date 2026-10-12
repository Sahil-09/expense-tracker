package expo.modules.expensesms

import android.content.Context

/** Hands a captured message to the JS layer. Set by the module while a listener is attached. */
interface SmsSink {
  /**
   * [isReplay] is true when this is a backlog message from a previous run rather than one
   * that just arrived, so JS can log it without firing a notification for each one.
   */
  fun onMessage(address: String, body: String, date: Double, isReplay: Boolean)
}

object SmsBridge {
  @Volatile
  private var sink: SmsSink? = null

  fun attach(s: SmsSink) {
    sink = s
  }

  fun detach() {
    sink = null
  }

  /**
   * Replays everything queued while the app was closed. Safe to call with no listener:
   * with no sink attached it returns and the queue is left for next time.
   */
  fun flush(context: Context, isReplay: Boolean) {
    val s = sink ?: return
    val queue = SmsStore.load(context)
    if (queue.length() == 0) return
    for (i in 0 until queue.length()) {
      val o = queue.optJSONObject(i) ?: continue
      s.onMessage(
        o.optString("address"),
        o.optString("body"),
        o.optDouble("date"),
        isReplay
      )
    }
    SmsStore.clear(context)
  }
}