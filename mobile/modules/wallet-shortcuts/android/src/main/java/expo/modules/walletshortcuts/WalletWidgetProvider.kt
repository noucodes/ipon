package expo.modules.walletshortcuts

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews

/**
 * Home-screen widget. Shows the last balance the app saved (it doesn't fetch on its own,
 * so it works offline and never needs your login), plus quick-add buttons.
 */
class WalletWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) manager.updateAppWidget(id, buildViews(context))
  }

  companion object {
    const val PREFS = "wallet_widget"

    fun save(context: Context, title: String, amount: String, subtitle: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("title", title)
        .putString("amount", amount)
        .putString("subtitle", subtitle)
        .apply()
      updateAll(context)
    }

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, WalletWidgetProvider::class.java))
      for (id in ids) manager.updateAppWidget(id, buildViews(context))
    }

    private fun buildViews(context: Context): RemoteViews {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return RemoteViews(context.packageName, R.layout.wallet_widget).apply {
        setTextViewText(R.id.widget_title, prefs.getString("title", "Finance Tracker"))
        setTextViewText(R.id.widget_amount, prefs.getString("amount", "Open the app"))
        setTextViewText(R.id.widget_subtitle, prefs.getString("subtitle", ""))
        setOnClickPendingIntent(R.id.widget_root, DeepLinks.openApp(context, 200))
        setOnClickPendingIntent(R.id.widget_add_expense, DeepLinks.pending(context, "add?type=expense", 201))
        setOnClickPendingIntent(R.id.widget_add_transfer, DeepLinks.pending(context, "add?type=transfer", 202))
      }
    }
  }
}
