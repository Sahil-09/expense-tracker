package expo.modules.expensesms

import android.content.Context
import android.content.Intent
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpenseSmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No react context")

  override fun definition() = ModuleDefinition {
    Name("ExpenseSms")

    Events("onSmsReceived")

    /** Messages in the inbox newer than [sinceMs], newest first. */
    AsyncFunction("readInbox") { sinceMs: Double ->
      val cursor = context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(
          Telephony.Sms._ID,
          Telephony.Sms.ADDRESS,
          Telephony.Sms.BODY,
          Telephony.Sms.DATE,
        ),
        "${Telephony.Sms.DATE} >= ?",
        arrayOf(sinceMs.toLong().toString()),
        "${Telephony.Sms.DATE} DESC"
      ) ?: return@AsyncFunction emptyList<Map<String, Any>>()

      cursor.use {
        val idIdx = it.getColumnIndexOrThrow(Telephony.Sms._ID)
        val addrIdx = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyIdx = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
        // Explicit type argument: without it buildList infers Map<String, Comparable<*>>,
        // which does not unify with the declared List<Map<String, Any>> return type.
        buildList<Map<String, Any>> {
          while (it.moveToNext()) {
            add(
              mapOf(
                "id" to it.getLong(idIdx),
                "address" to it.getString(addrIdx).orEmpty(),
                "body" to it.getString(bodyIdx).orEmpty(),
                "date" to it.getLong(dateIdx),
              )
            )
          }
        }
      }
    }

    // The receiver lives in AndroidManifest.xml so it also fires while the app is
    // closed. Attaching a sink here is what lets those queued messages reach JS.
    OnStartObserving {
      val ctx = appContext.reactContext
      SmsBridge.attach(object : SmsSink {
        override fun onMessage(address: String, body: String, date: Double, isReplay: Boolean) {
          sendEvent(
            "onSmsReceived",
            mapOf("address" to address, "body" to body, "date" to date, "isReplay" to isReplay)
          )
        }
      })
      // Whatever is still queued was captured while the app was closed: log it, but do
      // not notify, or every cold start would fire one popup per old message.
      if (ctx != null) SmsBridge.flush(ctx, true)
    }

    OnStopObserving {
      SmsBridge.detach()
    }
  }
}