package expo.modules.walletshortcuts

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Quick Settings tile: tap it from the pull-down panel to open "Add transaction". */
class AddTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      label = getString(R.string.tile_label)
      updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { openQuickAdd() } else openQuickAdd()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun openQuickAdd() {
    val intent = DeepLinks.intent(this, "add")
    if (Build.VERSION.SDK_INT >= 34) {
      // Android 14+ requires a PendingIntent here.
      val pending = PendingIntent.getActivity(
        this, 100, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
