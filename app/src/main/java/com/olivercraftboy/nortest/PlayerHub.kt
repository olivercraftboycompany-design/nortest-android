package com.olivercraftboy.nortest

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import java.lang.ref.WeakReference

/**
 * Shared state between the web player (running inside the WebView) and the native
 * media session / notification. The web page reports what it is doing through
 * [NortestBridge]; the media session sends button presses back through [command].
 */
object PlayerHub {
    data class Track(
        val title: String = "",
        val artist: String = "",
        val album: String = "",
        val durationMs: Long = -1L,
    )

    data class State(
        val playing: Boolean = false,
        val positionMs: Long = 0L,
        val speed: Float = 1f,
        val updatedAt: Long = SystemClock.elapsedRealtime(),
    )

    @Volatile var track: Track = Track()
        private set
    @Volatile var state: State = State()
        private set
    @Volatile var art: Bitmap? = null
        private set
    @Volatile var artKey: String? = null
        private set

    private val main = Handler(Looper.getMainLooper())
    private var webRef: WeakReference<WebView>? = null
    private val listeners = mutableSetOf<() -> Unit>()

    fun attach(webView: WebView) { webRef = WeakReference(webView) }
    fun detach(webView: WebView) { if (webRef?.get() === webView) webRef = null }
    val hasPlayer: Boolean get() = webRef?.get() != null

    fun addListener(l: () -> Unit) { main.post { listeners.add(l) } }
    fun removeListener(l: () -> Unit) { main.post { listeners.remove(l) } }

    private fun changed() = main.post { listeners.toList().forEach { it() } }

    fun updateTrack(t: Track) { track = t; changed() }

    fun updateArt(key: String?, bmp: Bitmap?) { artKey = key; art = bmp; changed() }

    fun updateState(playing: Boolean, positionMs: Long, durationMs: Long, speed: Float) {
        state = State(playing, positionMs.coerceAtLeast(0L), if (speed > 0f) speed else 1f, SystemClock.elapsedRealtime())
        if (durationMs > 0 && durationMs != track.durationMs) track = track.copy(durationMs = durationMs)
        changed()
    }

    /** Best guess of the current position, extrapolated while playing. */
    fun currentPositionMs(): Long {
        val s = state
        if (!s.playing) return s.positionMs
        val p = s.positionMs + ((SystemClock.elapsedRealtime() - s.updatedAt) * s.speed).toLong()
        val d = track.durationMs
        return if (d > 0) p.coerceAtMost(d) else p
    }

    /** Send a control command into the web player. Safe to call from any thread. */
    fun command(cmd: String, arg: Long = 0L) {
        val safe = cmd.filter { it.isLetter() }
        main.post {
            webRef?.get()?.evaluateJavascript(
                "window.__nortestCmd && window.__nortestCmd('$safe', $arg);", null
            )
        }
    }
}
