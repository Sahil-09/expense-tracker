package expo.modules.expensesms

import android.content.Context
import org.json.JSONArray

/**
 * A short on-disk queue for messages that arrived with no JS running.
 *
 * The manifest receiver can fire while the app is closed, so anything it captures is
 * parked here and replayed by [SmsBridge.flush] the next time the app starts.
 */
object SmsStore {
  private const val PREFS = "expense_sms_pending"
  private const val KEY = "messages"

  /** Cap the queue so a device that never opens the app cannot grow it without bound. */
  private const val MAX = 200

  fun load(context: Context): JSONArray {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]")
    return try {
      JSONArray(raw ?: "[]")
    } catch (e: Exception) {
      JSONArray()
    }
  }

  fun add(context: Context, queue: JSONArray) {
    if (queue.length() >= MAX) return
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, queue.toString())
      .apply()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }
}