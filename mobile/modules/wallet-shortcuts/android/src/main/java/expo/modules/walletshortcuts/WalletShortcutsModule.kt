package expo.modules.walletshortcuts

import android.app.StatusBarManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WalletShortcutsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }.applicationContext

  override fun definition() = ModuleDefinition {
    Name("WalletShortcuts")

    /** Save what the home-screen widget shows and refresh any placed widgets. */
    Function("updateWidget") { title: String, amount: String, subtitle: String ->
      WalletWidgetProvider.save(context, title, amount, subtitle)
    }

    /** Long-press app icon shortcuts: Add expense / Add income / Transfer. */
    Function("setShortcuts") {
      publishShortcuts(context)
    }

    /**
     * Android 13+: ask the system to add our tile to the Quick Settings panel.
     * Resolves a StatusBarManager result code, or -1 when unsupported.
     */
    AsyncFunction("requestAddTile") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33) {
        promise.resolve(-1)
        return@AsyncFunction
      }
      val manager = context.getSystemService(StatusBarManager::class.java)
      if (manager == null) {
        promise.resolve(-1)
        return@AsyncFunction
      }
      manager.requestAddTileService(
        ComponentName(context, AddTileService::class.java),
        context.getString(R.string.tile_label),
        Icon.createWithResource(context, R.drawable.ic_tile_add),
        context.mainExecutor,
      ) { result -> promise.resolve(result) }
    }

    // --- Payment detection (GCash / Maya / bank alerts) ---

    /** True once the user has granted Notification access to this app. */
    Function("hasDetectionAccess") { Detections.hasListenerAccess(context) }

    /** Opens Android's Notification access settings screen. */
    Function("openDetectionSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("isDetectionActive") { Detections.isActive(context) }
    Function("setDetectionActive") { active: Boolean -> Detections.setActive(context, active) }

    /** JSON array of detected movements, newest first. */
    Function("getDetections") { Detections.list(context).toString() }
    Function("removeDetection") { id: String -> Detections.remove(context, id) }
    Function("clearDetections") { Detections.clear(context) }

    /** Ask the launcher to place the widget on the home screen. False if the launcher can't. */
    Function("requestPinWidget") {
      if (Build.VERSION.SDK_INT < 26) return@Function false
      val manager = AppWidgetManager.getInstance(context)
      if (!manager.isRequestPinAppWidgetSupported) return@Function false
      manager.requestPinAppWidget(ComponentName(context, WalletWidgetProvider::class.java), null, null)
    }
  }

  private fun publishShortcuts(context: Context) {
    if (Build.VERSION.SDK_INT < 25) return
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return
    fun shortcut(id: String, label: Int, path: String, icon: Int) =
      ShortcutInfo.Builder(context, id)
        .setShortLabel(context.getString(label))
        .setLongLabel(context.getString(label))
        .setIcon(Icon.createWithResource(context, icon))
        .setIntent(DeepLinks.intent(context, path))
        .build()

    manager.dynamicShortcuts = listOf(
      shortcut("add_expense", R.string.shortcut_expense, "add?type=expense", R.drawable.ic_shortcut_expense),
      shortcut("add_income", R.string.shortcut_income, "add?type=income", R.drawable.ic_shortcut_income),
      shortcut("add_transfer", R.string.shortcut_transfer, "add?type=transfer", R.drawable.ic_shortcut_transfer),
    )
  }
}
