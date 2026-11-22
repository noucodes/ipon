package expo.modules.walletshortcuts

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Stores detected e-wallet / bank movements on the phone (SharedPreferences) and
 * shows a "Log ₱500 expense?" notification that opens quick add pre-filled.
 */
object Detections {
  private const val PREFS = "wallet_detections"
  private const val CHANNEL = "detections"
  private const val MAX = 30

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isActive(ctx: Context) = prefs(ctx).getBoolean("active", false)
  fun setActive(ctx: Context, active: Boolean) = prefs(ctx).edit().putBoolean("active", active).apply()

  /** Has the user granted notification access to this app (Settings → Notification access)? */
  fun hasListenerAccess(ctx: Context): Boolean {
    val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
    return flat.split(":").any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
  }

  fun list(ctx: Context): JSONArray = try {
    JSONArray(prefs(ctx).getString("items", "[]"))
  } catch (e: Exception) {
    JSONArray()
  }

  private fun save(ctx: Context, items: JSONArray) = prefs(ctx).edit().putString("items", items.toString()).apply()

  /** Adds a detection; returns null if it's a duplicate (apps often re-post the same notification). */
  @Synchronized
  fun add(ctx: Context, r: MoneyParser.Result, text: String, postedAt: Long): JSONObject? {
    val id = Integer.toHexString("${r.source}|${r.amountCents}|$text".hashCode())
    val items = list(ctx)
    for (i in 0 until items.length()) if (items.getJSONObject(i).optString("id") == id) return null
    val item = JSONObject()
      .put("id", id)
      .put("source", r.source)
      .put("type", r.type)
      .put("amount_cents", r.amountCents)
      .put("text", text.take(300))
      .put("posted_at", postedAt)
    val next = JSONArray().put(item)
    for (i in 0 until minOf(items.length(), MAX - 1)) next.put(items.get(i))
    save(ctx, next)
    return item
  }

  @Synchronized
  fun remove(ctx: Context, id: String) {
    val items = list(ctx)
    val next = JSONArray()
    for (i in 0 until items.length()) {
      val entry = items.getJSONObject(i)
      if (entry.optString("id") != id) next.put(entry)
    }
    save(ctx, next)
    (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(id.hashCode())
  }

  fun clear(ctx: Context) = save(ctx, JSONArray())

  fun notifyUser(ctx: Context, item: JSONObject) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return

    val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Detected payments", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "Suggestions to log GCash, Maya and bank activity"
        },
      )
    }

    val id = item.getString("id")
    val type = item.getString("type")
    val cents = item.getLong("amount_cents")
    val source = item.getString("source")
    val amount = String.format(Locale.US, "₱%,.2f", cents / 100.0)
    val path = "add?type=$type&amount=$cents&source=${Uri.encode(source)}&detection=$id"

    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, CHANNEL) else Notification.Builder(ctx)
    val notification = builder
      .setSmallIcon(R.drawable.ic_tile_add)
      .setContentTitle("Log $amount ${if (type == "income") "income" else "expense"}?")
      .setContentText("$source · tap to add it to your wallet")
      .setStyle(Notification.BigTextStyle().bigText(item.optString("text")))
      .setAutoCancel(true)
      .setContentIntent(DeepLinks.pending(ctx, path, id.hashCode()))
      .build()
    manager.notify(id.hashCode(), notification)
  }
}
