package com.olivercraftboy.nortest

import org.json.JSONArray
import org.json.JSONObject

/** One music file on the phone, as MediaStore describes it. */
data class DeviceSong(
    val id: Long,
    val title: String,
    val artist: String,
    val album: String,
    val albumId: Long,
    val durationMs: Long,
    val addedSec: Long,
    val mime: String,
    val size: Long
)

/** What a Range header asks for, against a file of a known length. */
sealed class ByteRange {
    object Full : ByteRange()
    data class Partial(val start: Long, val end: Long) : ByteRange() {
        val length: Long get() = end - start + 1
    }
    object Unsatisfiable : ByteRange()
}

/**
 * Pure helpers for the device music scan (no Android classes, so they run in unit tests):
 * cleaning MediaStore values, the JSON handed to the web player, and HTTP Range parsing
 * for streaming a song into the WebView's audio element.
 */
object DeviceMusicParse {
    const val UNKNOWN_ARTIST = "Unknown Artist"
    const val UNKNOWN_ALBUM = "Unknown Album"

    /** MediaStore writes "<unknown>" when a tag is missing. */
    fun clean(v: String?, fallback: String): String {
        val t = v?.trim().orEmpty()
        return if (t.isEmpty() || t.equals("<unknown>", ignoreCase = true)) fallback else t
    }

    /** Title tag, else the file name without its extension, else "Unknown song". */
    fun title(title: String?, displayName: String?): String {
        val t = clean(title, "")
        if (t.isNotEmpty()) return t
        val n = displayName?.trim().orEmpty()
        if (n.isEmpty()) return "Unknown song"
        val dot = n.lastIndexOf('.')
        return if (dot > 0) n.substring(0, dot) else n
    }

    fun song(
        id: Long, title: String?, displayName: String?, artist: String?, album: String?,
        albumId: Long, durationMs: Long, addedSec: Long, mime: String?, size: Long
    ): DeviceSong? {
        if (id <= 0) return null
        return DeviceSong(
            id = id,
            title = title(title, displayName),
            artist = clean(artist, UNKNOWN_ARTIST),
            album = clean(album, UNKNOWN_ALBUM),
            albumId = albumId,
            durationMs = if (durationMs > 0) durationMs else 0,
            addedSec = if (addedSec > 0) addedSec else 0,
            mime = mime?.trim().orEmpty(),
            size = if (size > 0) size else 0
        )
    }

    /** Compact JSON for the web player: [{id,t,ar,al,aid,d,ad,m,sz}, ...]. */
    fun toJson(list: List<DeviceSong>): String {
        val a = JSONArray()
        for (s in list) {
            a.put(JSONObject().apply {
                put("id", s.id)
                put("t", s.title)
                put("ar", s.artist)
                put("al", s.album)
                put("aid", s.albumId)
                put("d", s.durationMs)
                put("ad", s.addedSec)
                put("m", s.mime)
                put("sz", s.size)
            })
        }
        return a.toString()
    }

    /** Parse "bytes=a-b", "bytes=a-" or "bytes=-n" (first range only). */
    fun parseRange(header: String?, length: Long): ByteRange {
        val h = header?.trim().orEmpty()
        if (h.isEmpty() || length <= 0) return ByteRange.Full
        if (!h.startsWith("bytes=", ignoreCase = true)) return ByteRange.Full
        val spec = h.substring(6).split(',')[0].trim()
        val dash = spec.indexOf('-')
        if (dash < 0) return ByteRange.Full
        val a = spec.substring(0, dash).trim()
        val b = spec.substring(dash + 1).trim()
        return try {
            if (a.isEmpty()) {
                val n = b.toLong()
                if (n <= 0) ByteRange.Unsatisfiable
                else ByteRange.Partial(maxOf(0L, length - n), length - 1)
            } else {
                val start = a.toLong()
                if (start < 0) return ByteRange.Full
                if (start >= length) return ByteRange.Unsatisfiable
                val end = if (b.isEmpty()) length - 1 else minOf(b.toLong(), length - 1)
                if (end < start) ByteRange.Full else ByteRange.Partial(start, end)
            }
        } catch (_: NumberFormatException) {
            ByteRange.Full
        }
    }

    /** "/devicemusic/audio/123" -> ("audio", 123); anything else -> null. */
    fun route(path: String?): Pair<String, Long>? {
        val p = path ?: return null
        val m = Regex("^/devicemusic/(audio|art)/(\\d+)$").find(p) ?: return null
        val id = m.groupValues[2].toLongOrNull() ?: return null
        return if (id > 0) m.groupValues[1] to id else null
    }

    /** Permission word for the web player. */
    fun permissionState(granted: Boolean, askedBefore: Boolean, showRationale: Boolean): String = when {
        granted -> "granted"
        !askedBefore -> "ask"
        showRationale -> "denied"
        else -> "blocked"
    }
}
