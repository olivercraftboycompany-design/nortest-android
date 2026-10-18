package com.olivercraftboy.nortest

import android.content.ContentValues
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * window.NortestNative inside the web player. Methods run on the WebView's
 * JavaBridge thread, never the UI thread.
 */
class NortestBridge(private val activity: MainActivity) {

    private class Save(val name: String, val out: OutputStream, val finish: () -> Unit)
    private val saves = ConcurrentHashMap<Int, Save>()
    private val ids = AtomicInteger(1)

    @JavascriptInterface
    fun isApp(): Boolean = true

    @JavascriptInterface
    fun appVersion(): String = BuildConfigCompat.versionName(activity)

    /** Settings > About > "Check for updates": same as the icon shortcut, always answers. */
    @JavascriptInterface
    fun checkForUpdates() = activity.checkForUpdatesFromPage()

    @JavascriptInterface
    fun setMetadata(title: String?, artist: String?, album: String?, durationMs: Double) {
        PlayerHub.updateTrack(
            PlayerHub.Track(
                title.orEmpty(), artist.orEmpty(), album.orEmpty(),
                if (durationMs.isFinite() && durationMs > 0) durationMs.toLong() else -1L
            )
        )
    }

    @JavascriptInterface
    fun setArt(key: String?, base64Jpeg: String?) {
        if (base64Jpeg.isNullOrEmpty()) { PlayerHub.updateArt(key, null); return }
        val bmp = try {
            val bytes = Base64.decode(base64Jpeg, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) { null }
        PlayerHub.updateArt(key, bmp)
    }

    @JavascriptInterface
    fun setState(playing: Boolean, positionMs: Double, durationMs: Double, speed: Double) {
        PlayerHub.updateState(
            playing,
            if (positionMs.isFinite()) positionMs.toLong() else 0L,
            if (durationMs.isFinite()) durationMs.toLong() else -1L,
            if (speed.isFinite()) speed.toFloat() else 1f
        )
    }

    @JavascriptInterface
    fun setFullscreen(on: Boolean) = activity.runOnUiThread { activity.setImmersiveBars(on) }

    // ---- Music on the phone ----

    /** "granted", "ask", "denied" or "blocked". */
    @JavascriptInterface
    fun musicPermission(): String = try { activity.musicPermissionState() } catch (_: Exception) { "ask" }

    /** Ask for music access (opens Settings if Android won't show the prompt again). */
    @JavascriptInterface
    fun requestMusicAccess() { activity.requestMusicAccess() }

    @JavascriptInterface
    fun openMusicSettings() { activity.openAppSettings() }

    /** Every music file on the phone as JSON: [{id,t,ar,al,aid,d,ad,m,sz}]. */
    @JavascriptInterface
    fun deviceSongs(): String = try { DeviceMusic.songsJson(activity) } catch (_: Exception) { "[]" }

    @JavascriptInterface
    fun rescanDeviceMusic() { activity.rescanDeviceMusic() }

    @JavascriptInterface
    fun isScanningDeviceMusic(): Boolean = DeviceMusic.scanning

    @JavascriptInterface
    fun toast(msg: String?) = activity.runOnUiThread {
        Toast.makeText(activity, msg.orEmpty(), Toast.LENGTH_LONG).show()
    }

    /** Start saving a file (e.g. a backup .zip) into Downloads. Returns an id, or 0 on failure. */
    @JavascriptInterface
    fun saveStart(fileName: String?, mime: String?): Int {
        val name = (fileName ?: "nortest-file").replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val type = mime?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        return try {
            val id = ids.getAndIncrement()
            val resolver = activity.contentResolver
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, type)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return 0
                val out = resolver.openOutputStream(uri) ?: return 0
                saves[id] = Save(name, out) {
                    val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
                    resolver.update(uri, done, null, null)
                }
            } else {
                @Suppress("DEPRECATION")
                val pub = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val dir = if (activity.canWritePublicDownloads()) pub
                          else activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: activity.filesDir
                dir.mkdirs()
                val f = File(dir, name)
                saves[id] = Save(f.absolutePath, FileOutputStream(f)) {}
            }
            id
        } catch (e: Exception) {
            android.util.Log.w("Nortest", "saveStart failed", e)
            0
        }
    }

    @JavascriptInterface
    fun saveChunk(id: Int, base64: String?): Boolean {
        val s = saves[id] ?: return false
        return try {
            if (!base64.isNullOrEmpty()) s.out.write(Base64.decode(base64, Base64.DEFAULT))
            true
        } catch (e: Exception) {
            android.util.Log.w("Nortest", "saveChunk failed", e)
            false
        }
    }

    @JavascriptInterface
    fun saveEnd(id: Int, ok: Boolean): Boolean {
        val s = saves.remove(id) ?: return false
        return try {
            s.out.flush(); s.out.close()
            if (ok) s.finish()
            toast(if (ok) "Saved " + File(s.name).name + " to Downloads" else "Saving failed")
            ok
        } catch (e: Exception) {
            toast("Saving failed: " + e.message)
            false
        }
    }
}

object BuildConfigCompat {
    fun versionName(ctx: android.content.Context): String = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
    } catch (_: Exception) { "" }
}
