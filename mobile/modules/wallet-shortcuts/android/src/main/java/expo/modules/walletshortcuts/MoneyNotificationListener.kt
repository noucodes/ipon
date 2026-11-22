package expo.modules.walletshortcuts

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Watches incoming notifications for GCash / Maya / bank payment alerts (only while the
 * user has switched the feature on in the app). Nothing leaves the phone: matches are
 * stored locally and offered as one-tap entries.
 */
class MoneyNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      if (sbn.packageName == packageName) return
      if (!Detections.isActive(this)) return
      val n = sbn.notification ?: return
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

      val extras = n.extras ?: return
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
      val body = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
        ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
      val text = "$title $body".trim()

      val result = MoneyParser.parse(sbn.packageName, text) ?: return
      val item = Detections.add(this, result, text, sbn.postTime) ?: return
      Detections.notifyUser(this, item)
    } catch (e: Exception) {
      // Never crash the listener because of an unusual notification.
    }
  }
}
