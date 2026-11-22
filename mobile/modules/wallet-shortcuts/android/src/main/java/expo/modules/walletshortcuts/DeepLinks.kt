package expo.modules.walletshortcuts

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Builds intents that open screens in the app via its URL scheme (handled by Expo Router). */
object DeepLinks {
  private const val SCHEME = "financetracker"

  /** e.g. path = "add?type=transfer" -> financetracker://add?type=transfer */
  fun intent(context: Context, path: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME://$path"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

  fun pending(context: Context, path: String, requestCode: Int): PendingIntent =
    PendingIntent.getActivity(
      context,
      requestCode,
      intent(context, path),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** Opens the app normally (home screen). */
  fun openApp(context: Context, requestCode: Int): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      requestCode,
      launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
