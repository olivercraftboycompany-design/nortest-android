package com.olivercraftboy.nortest

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.session.MediaButtonReceiver

/**
 * Foreground media service. Owns the MediaSession (lock screen, notification shade,
 * Bluetooth / headset buttons, car) and keeps the app process alive while music plays
 * with the screen off. The actual audio is played by the web player in the WebView;
 * this service mirrors its state and forwards button presses back to it.
 */
class PlaybackService : Service() {

    companion object {
        const val CHANNEL_ID = "nortest_playback"
        const val NOTIFICATION_ID = 7013
        const val ACTION_CONTROL = "com.olivercraftboy.nortest.CONTROL"
        const val EXTRA_CMD = "cmd"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, PlaybackService::class.java))
        }
    }

    private lateinit var session: MediaSessionCompat
    private var wakeLock: PowerManager.WakeLock? = null
    private var defaultArt: Bitmap? = null
    private var noisyRegistered = false
    private var lastNotifiedKey = ""
    private val listener: () -> Unit = { refresh() }

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) PlayerHub.command("pause")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        defaultArt = BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher)

        session = MediaSessionCompat(this, "Nortest").apply {
            setCallback(callback)
            setSessionActivity(contentIntent())
            setPlaybackState(MediaControls.buildState(false, 0L, 1f, SystemClock.elapsedRealtime()))
            isActive = true
        }
        val wm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = wm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Nortest:playback").apply {
            setReferenceCounted(false)
        }
        goForeground(buildNotification())
        PlayerHub.addListener(listener)
        refresh()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Make sure we are foreground as early as possible on every start.
        goForeground(buildNotification())
        if (intent != null) {
            if (intent.action == Intent.ACTION_MEDIA_BUTTON) {
                MediaButtonReceiver.handleIntent(session, intent)
            } else if (intent.action == ACTION_CONTROL) {
                MediaControls.commandFor(intent.getStringExtra(EXTRA_CMD) ?: "")?.let { cmd ->
                    if (cmd == "toggle") {
                        PlayerHub.command(if (PlayerHub.state.playing) "pause" else "play")
                    } else {
                        PlayerHub.command(cmd)
                    }
                }
            }
        }
        if (!PlayerHub.hasPlayer) {
            // The player screen is gone (app closed): nothing to control.
            shutdown()
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // App swiped away from recents: the WebView (and the music) goes with it.
        shutdown()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        PlayerHub.removeListener(listener)
        setPlayingResources(false)
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    private fun shutdown() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private val callback = object : MediaSessionCompat.Callback() {
        override fun onPlay() = PlayerHub.command("play")
        override fun onPause() = PlayerHub.command("pause")
        override fun onStop() = PlayerHub.command("pause")
        override fun onSkipToNext() = PlayerHub.command("next")
        override fun onSkipToPrevious() = PlayerHub.command("prev")
        override fun onFastForward() = PlayerHub.command("ff")
        override fun onRewind() = PlayerHub.command("rew")
        override fun onSeekTo(pos: Long) = PlayerHub.command("seek", pos.coerceAtLeast(0L))
        override fun onCustomAction(action: String?, extras: android.os.Bundle?) {
            MediaControls.commandFor(action ?: return)?.let { PlayerHub.command(it) }
        }
    }

    private fun refresh() {
        val t = PlayerHub.track
        val s = PlayerHub.state
        val art = PlayerHub.art ?: defaultArt

        val meta = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, t.title.ifBlank { getString(R.string.nothing_playing) })
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, t.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, t.album)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, t.title.ifBlank { getString(R.string.nothing_playing) })
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, t.artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (t.durationMs > 0) t.durationMs else -1L)
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
            .putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art)
            .build()
        session.setMetadata(meta)
        session.setPlaybackState(MediaControls.buildState(s.playing, s.positionMs, s.speed, s.updatedAt))
        setPlayingResources(s.playing)

        // Re-post the notification only when something visible changed.
        val key = listOf(t.title, t.artist, t.album, s.playing, PlayerHub.artKey).joinToString("|")
        if (key != lastNotifiedKey) {
            lastNotifiedKey = key
            notifySafely(buildNotification())
        }
    }

    @SuppressLint("WakelockTimeout")
    private fun setPlayingResources(playing: Boolean) {
        val wl = wakeLock ?: return
        if (playing) {
            if (!wl.isHeld) wl.acquire(6 * 60 * 60 * 1000L)
            if (!noisyRegistered) {
                ContextCompat.registerReceiver(
                    this, noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                    ContextCompat.RECEIVER_NOT_EXPORTED
                )
                noisyRegistered = true
            }
        } else {
            if (wl.isHeld) wl.release()
            if (noisyRegistered) {
                try { unregisterReceiver(noisyReceiver) } catch (_: Exception) {}
                noisyRegistered = false
            }
        }
    }

    private fun goForeground(n: Notification) {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
        } catch (e: Exception) {
            // Starting a foreground service can be refused when the app is in the
            // background on Android 12+. The session keeps working; try again later.
            android.util.Log.w("Nortest", "startForeground refused", e)
        }
    }

    private fun notifySafely(n: Notification) {
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, n)
        } catch (_: SecurityException) {
            // Notification permission not granted; the media session still works.
        }
    }

    private fun contentIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun controlIntent(cmd: String, req: Int): PendingIntent = PendingIntent.getService(
        this, req,
        Intent(this, PlaybackService::class.java).setAction(ACTION_CONTROL).putExtra(EXTRA_CMD, cmd),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW).apply {
                description = getString(R.string.channel_desc)
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    fun buildNotification(): Notification {
        val t = PlayerHub.track
        val playing = PlayerHub.state.playing
        val b = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(t.title.ifBlank { getString(R.string.nothing_playing) })
            .setContentText(t.artist)
            .setSubText(t.album.ifBlank { null })
            .setLargeIcon(PlayerHub.art ?: defaultArt)
            .setContentIntent(contentIntent())
            .setDeleteIntent(controlIntent("pause", 99))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setOngoing(true)
            .setColor(ContextCompat.getColor(this, R.color.brand))

        MediaControls.NOTIFICATION_ORDER.forEachIndexed { i, cmd ->
            val (icon, label) = when (cmd) {
                "prev" -> R.drawable.ic_prev to getString(R.string.action_prev)
                "rew" -> R.drawable.ic_replay_10 to getString(R.string.action_rew)
                "toggle" -> if (playing) R.drawable.ic_pause to getString(R.string.action_pause)
                            else R.drawable.ic_play to getString(R.string.action_play)
                "ff" -> R.drawable.ic_forward_10 to getString(R.string.action_ff)
                else -> R.drawable.ic_next to getString(R.string.action_next)
            }
            b.addAction(icon, label, controlIntent(cmd, i + 1))
        }

        b.setStyle(
            androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.sessionToken)
                .setShowActionsInCompactView(*MediaControls.COMPACT_INDICES)
        )
        return b.build()
    }
}
