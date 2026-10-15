package com.olivercraftboy.nortest

import android.support.v4.media.session.PlaybackStateCompat

/**
 * The five media controls Nortest shows, in order:
 * Previous, Rewind 10s, Play/Pause, Forward 10s, Next.
 *
 * Android 13+ builds the system media player from the session PlaybackState:
 * play/pause + previous + next come from the standard actions, and the two
 * remaining slots are filled by the first two custom actions (rewind 10 and
 * forward 10). Older Android shows the notification actions instead, so the
 * notification gets the same five buttons via addAction.
 */
object MediaControls {
    const val SEEK_STEP_MS = 10_000L

    const val CUSTOM_REWIND = "com.olivercraftboy.nortest.REWIND_10"
    const val CUSTOM_FORWARD = "com.olivercraftboy.nortest.FORWARD_10"

    /** Notification button order (pre-Android 13). */
    val NOTIFICATION_ORDER = listOf("prev", "rew", "toggle", "ff", "next")

    /** Indices of NOTIFICATION_ORDER shown in the collapsed notification: prev, play/pause, next. */
    val COMPACT_INDICES = intArrayOf(0, 2, 4)

    const val SUPPORTED_ACTIONS: Long =
        PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_FAST_FORWARD or
            PlaybackStateCompat.ACTION_REWIND or
            PlaybackStateCompat.ACTION_STOP

    fun buildState(playing: Boolean, positionMs: Long, speed: Float, updateTime: Long): PlaybackStateCompat =
        PlaybackStateCompat.Builder()
            .setActions(SUPPORTED_ACTIONS)
            .setState(
                if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                positionMs,
                if (playing) speed else 0f,
                updateTime
            )
            .addCustomAction(
                PlaybackStateCompat.CustomAction.Builder(CUSTOM_REWIND, "Back 10 seconds", R.drawable.ic_replay_10).build()
            )
            .addCustomAction(
                PlaybackStateCompat.CustomAction.Builder(CUSTOM_FORWARD, "Forward 10 seconds", R.drawable.ic_forward_10).build()
            )
            .build()

    /** Map a notification / custom action id to the web player command. */
    fun commandFor(action: String): String? = when (action) {
        CUSTOM_REWIND, "rew" -> "rew"
        CUSTOM_FORWARD, "ff" -> "ff"
        "prev" -> "prev"
        "next" -> "next"
        "toggle" -> "toggle"
        "play" -> "play"
        "pause" -> "pause"
        else -> null
    }
}
