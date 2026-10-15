package com.olivercraftboy.nortest

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.LruCache
import android.util.Size
import android.webkit.WebResourceResponse
import androidx.core.content.ContextCompat
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.util.concurrent.Executors

/**
 * All the music files on the phone (MediaStore), for the web player's library.
 * Nothing is copied: songs are streamed from their content URI through
 * https://appassets.androidplatform.net/devicemusic/audio/<id> (with Range support so
 * seeking works) and covers through /devicemusic/art/<id>.
 */
object DeviceMusic {
    private const val TAG = "NortestDevice"
    const val PREFIX = "/devicemusic/"

    val permission: String
        get() = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO
                else Manifest.permission.READ_EXTERNAL_STORAGE

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()

    @Volatile private var songs: List<DeviceSong> = emptyList()
    @Volatile private var json: String = "[]"
    @Volatile private var scannedAt = 0L
    @Volatile var scanning = false
        private set

    private var observer: ContentObserver? = null
    private val art = object : LruCache<Long, ByteArray>(8 * 1024 * 1024) {
        override fun sizeOf(key: Long, value: ByteArray) = value.size
    }

    private val base: Uri get() = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

    fun hasPermission(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    fun count() = songs.size

    /** Run a MediaStore query now (on the calling thread). Returns true if the list changed. */
    fun scanNow(ctx: Context): Boolean {
        if (!hasPermission(ctx)) {
            val changed = songs.isNotEmpty()
            synchronized(lock) { songs = emptyList(); json = "[]"; scannedAt = System.currentTimeMillis() }
            return changed
        }
        val out = ArrayList<DeviceSong>()
        val cols = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.SIZE
        )
        try {
            ctx.contentResolver.query(base, cols, MediaStore.Audio.Media.IS_MUSIC + " != 0", null,
                MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC")?.use { c ->
                val iId = c.getColumnIndexOrThrow(cols[0]); val iT = c.getColumnIndexOrThrow(cols[1])
                val iN = c.getColumnIndexOrThrow(cols[2]); val iAr = c.getColumnIndexOrThrow(cols[3])
                val iAl = c.getColumnIndexOrThrow(cols[4]); val iAid = c.getColumnIndexOrThrow(cols[5])
                val iD = c.getColumnIndexOrThrow(cols[6]); val iAd = c.getColumnIndexOrThrow(cols[7])
                val iM = c.getColumnIndexOrThrow(cols[8]); val iS = c.getColumnIndexOrThrow(cols[9])
                while (c.moveToNext()) {
                    DeviceMusicParse.song(
                        c.getLong(iId), c.getString(iT), c.getString(iN), c.getString(iAr), c.getString(iAl),
                        c.getLong(iAid), c.getLong(iD), c.getLong(iAd), c.getString(iM), c.getLong(iS)
                    )?.let { out.add(it) }
                }
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "scan failed", e)
            return false
        }
        val newJson = DeviceMusicParse.toJson(out)
        synchronized(lock) {
            val changed = newJson != json
            songs = out; json = newJson; scannedAt = System.currentTimeMillis()
            if (changed) art.evictAll()
            return changed
        }
    }

    /** JSON list for the web player; scans first if nothing was scanned yet. */
    fun songsJson(ctx: Context): String {
        if (scannedAt == 0L && hasPermission(ctx)) scanNow(ctx)
        return json
    }

    /** Scan in the background; [onChanged] runs on the main thread if the list changed. */
    fun scanAsync(ctx: Context, minGapMs: Long = 0L, onChanged: () -> Unit) {
        val app = ctx.applicationContext
        if (minGapMs > 0 && System.currentTimeMillis() - scannedAt < minGapMs) return
        io.execute {
            scanning = true
            val changed = try { scanNow(app) } finally { scanning = false }
            if (changed) main.post(onChanged)
        }
    }

    /** Watch MediaStore for added/removed songs (debounced 2 s). */
    fun watch(ctx: Context, onChanged: () -> Unit) {
        if (observer != null || !hasPermission(ctx)) return
        val app = ctx.applicationContext
        var pending: Runnable? = null
        val o = object : ContentObserver(main) {
            override fun onChange(selfChange: Boolean) {
                pending?.let { main.removeCallbacks(it) }
                val r = Runnable { scanAsync(app, 0L, onChanged) }
                pending = r
                main.postDelayed(r, 2000)
            }
        }
        try {
            app.contentResolver.registerContentObserver(base, true, o)
            observer = o
        } catch (e: Exception) {
            android.util.Log.w(TAG, "observer failed", e)
        }
    }

    fun unwatch(ctx: Context) {
        observer?.let { try { ctx.applicationContext.contentResolver.unregisterContentObserver(it) } catch (_: Exception) { } }
        observer = null
    }

    /** Serve /devicemusic/... requests from the WebView, or null if not ours. */
    fun intercept(ctx: Context, path: String?, headers: Map<String, String>?): WebResourceResponse? {
        if (path == null || !path.startsWith(PREFIX)) return null
        val r = DeviceMusicParse.route(path) ?: return error(404, "Not Found")
        if (!hasPermission(ctx)) return error(403, "Forbidden")
        return try {
            if (r.first == "audio") audio(ctx, r.second, headerValue(headers, "Range")) else cover(ctx, r.second)
        } catch (e: SecurityException) {
            error(403, "Forbidden")
        } catch (e: Exception) {
            android.util.Log.w(TAG, "serve failed " + path, e)
            error(404, "Not Found")
        }
    }

    private fun headerValue(h: Map<String, String>?, name: String): String? =
        h?.entries?.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

    private fun baseHeaders(): MutableMap<String, String> = mutableMapOf(
        "Access-Control-Allow-Origin" to "*",
        "Cache-Control" to "no-cache"
    )

    private fun error(code: Int, reason: String): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", code, reason, baseHeaders(), ByteArrayInputStream(ByteArray(0)))

    private fun audio(ctx: Context, id: Long, range: String?): WebResourceResponse {
        val uri = ContentUris.withAppendedId(base, id)
        val cr = ctx.contentResolver
        val afd = cr.openAssetFileDescriptor(uri, "r") ?: return error(404, "Not Found")
        var len = afd.length
        if (len < 0) len = try { afd.parcelFileDescriptor.statSize } catch (_: Exception) { -1L }
        val mime = (cr.getType(uri) ?: songs.firstOrNull { it.id == id }?.mime)?.takeIf { it.isNotBlank() } ?: "audio/mpeg"
        val h = baseHeaders()
        h["Accept-Ranges"] = "bytes"
        val input = afd.createInputStream()
        return when (val br = if (len > 0) DeviceMusicParse.parseRange(range, len) else ByteRange.Full) {
            is ByteRange.Partial -> {
                skipFully(input, br.start)
                h["Content-Range"] = "bytes " + br.start + "-" + br.end + "/" + len
                h["Content-Length"] = br.length.toString()
                WebResourceResponse(mime, null, 206, "Partial Content", h, Bounded(input, br.length))
            }
            is ByteRange.Unsatisfiable -> {
                input.close()
                h["Content-Range"] = "bytes */$len"
                WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, ByteArrayInputStream(ByteArray(0)))
            }
            else -> {
                if (len > 0) h["Content-Length"] = len.toString()
                WebResourceResponse(mime, null, 200, "OK", h, input)
            }
        }
    }

    private fun skipFully(input: InputStream, n: Long) {
        var left = n
        while (left > 0) {
            val s = input.skip(left)
            if (s <= 0) { if (input.read() < 0) break; left-- } else left -= s
        }
    }

    /** Cover art as JPEG, or the player's gradient placeholder when the song has none. */
    private fun cover(ctx: Context, id: Long): WebResourceResponse {
        val bytes = art.get(id) ?: loadArt(ctx, id)?.also { art.put(id, it) }
        val h = baseHeaders()
        h["Cache-Control"] = "max-age=3600"
        if (bytes == null || bytes.isEmpty()) {
            return WebResourceResponse("image/svg+xml", "utf-8", 200, "OK", h, ByteArrayInputStream(PLACEHOLDER.toByteArray()))
        }
        return WebResourceResponse("image/jpeg", null, 200, "OK", h, ByteArrayInputStream(bytes))
    }

    private fun loadArt(ctx: Context, id: Long): ByteArray? {
        val bmp: Bitmap? = try {
            if (Build.VERSION.SDK_INT >= 29) {
                ctx.contentResolver.loadThumbnail(ContentUris.withAppendedId(base, id), Size(512, 512), null)
            } else {
                val albumId = songs.firstOrNull { it.id == id }?.albumId ?: return ByteArray(0)
                val u = ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumId)
                ctx.contentResolver.openInputStream(u)?.use { BitmapFactory.decodeStream(it) }
            }
        } catch (_: Exception) { null }
        if (bmp == null) return ByteArray(0)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
        return out.toByteArray()
    }

    private class Bounded(input: InputStream, private var left: Long) : FilterInputStream(input) {
        override fun read(): Int {
            if (left <= 0) return -1
            val b = super.read()
            if (b >= 0) left--
            return b
        }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0) return -1
            val n = super.read(b, off, minOf(len.toLong(), left).toInt())
            if (n > 0) left -= n
            return n
        }
        override fun available(): Int = minOf(super.available().toLong(), left).toInt()
    }

    // Same gradient as the web player's placeholder (PH in app.js).
    private const val PLACEHOLDER = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\">" +
        "<defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4b5bff\"/>" +
        "<stop offset=\"1\" stop-color=\"#b24bff\"/></linearGradient></defs><rect width=\"100\" height=\"100\" fill=\"url(#g)\"/>" +
        "<circle cx=\"50\" cy=\"50\" r=\"18\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".6\" stroke-width=\"4\"/></svg>"
}
