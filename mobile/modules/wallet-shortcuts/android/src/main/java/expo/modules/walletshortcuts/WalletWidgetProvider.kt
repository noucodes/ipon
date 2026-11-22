package expo.modules.walletshortcuts

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews

/**
 * Quick-add bar widget: Expense / Income / Transfer buttons that open quick add.
 * No balance is shown, so nothing private is visible on the home screen.
 */
class WalletWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) manager.updateAppWidget(id, buildViews(context))
  }

  companion object {
    const val PREFS = "wallet_widget"

    /** Kept for compatibility with the app: stores the latest values and refreshes the widget. */
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

    private fun buildViews(context: Context): RemoteViews =
      RemoteViews(context.packageName, R.layout.wallet_widget).apply {
        setOnClickPendingIntent(R.id.widget_add_expense, DeepLinks.pending(context, "add?type=expense", 201))
        setOnClickPendingIntent(R.id.widget_add_income, DeepLinks.pending(context, "add?type=income", 203))
        setOnClickPendingIntent(R.id.widget_add_transfer, DeepLinks.pending(context, "add?type=transfer", 202))
      }
  }
}
