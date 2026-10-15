package com.olivercraftboy.nortest

import android.support.v4.media.session.PlaybackStateCompat
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaControlsTest {

    private fun has(actions: Long, flag: Long) = actions and flag == flag

    @Test
    fun playbackStateOffersFiveControls() {
        val s = MediaControls.buildState(true, 42_000L, 1f, 1000L)
        // Standard slots used by the Android 13+ media player.
        assertTrue(has(s.actions, PlaybackStateCompat.ACTION_PLAY_PAUSE))
        assertTrue(has(s.actions, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
        assertTrue(has(s.actions, PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
        assertTrue(has(s.actions, PlaybackStateCompat.ACTION_SEEK_TO))
        // Two custom actions fill the remaining two slots: -10s then +10s.
        val custom = s.customActions.map { it.action }
        assertEquals(listOf(MediaControls.CUSTOM_REWIND, MediaControls.CUSTOM_FORWARD), custom)
        assertEquals(R.drawable.ic_replay_10, s.customActions[0].icon)
        assertEquals(R.drawable.ic_forward_10, s.customActions[1].icon)
        // 3 standard + 2 custom = 5 buttons.
        assertEquals(5, 3 + custom.size)
    }

    @Test
    fun stateReflectsPlaying() {
        val playing = MediaControls.buildState(true, 5_000L, 1f, 10L)
        assertEquals(PlaybackStateCompat.STATE_PLAYING, playing.state)
        assertEquals(5_000L, playing.position)
        assertEquals(1f, playing.playbackSpeed)
        val paused = MediaControls.buildState(false, 7_000L, 1f, 10L)
        assertEquals(PlaybackStateCompat.STATE_PAUSED, paused.state)
        assertEquals(0f, paused.playbackSpeed)
    }

    @Test
    fun notificationHasFiveButtonsInOrder() {
        assertEquals(listOf("prev", "rew", "toggle", "ff", "next"), MediaControls.NOTIFICATION_ORDER)
        assertArrayEquals(intArrayOf(0, 2, 4), MediaControls.COMPACT_INDICES)
        MediaControls.NOTIFICATION_ORDER.forEach { assertTrue(MediaControls.commandFor(it) != null) }
    }

    @Test
    fun customActionsMapToSeekCommands() {
        assertEquals("rew", MediaControls.commandFor(MediaControls.CUSTOM_REWIND))
        assertEquals("ff", MediaControls.commandFor(MediaControls.CUSTOM_FORWARD))
        assertEquals(null, MediaControls.commandFor("bogus"))
    }

    @Test
    fun filePickerMimeTypes() {
        val noMime: (String) -> String? = { null }
        assertEquals(listOf("audio/*"), FilePicker.mimeTypesFor(listOf("audio/*"), noMime))
        assertEquals(listOf("image/*", "video/*"), FilePicker.mimeTypesFor(listOf("image/*,video/*"), noMime))
        val zip = FilePicker.mimeTypesFor(listOf(".zip,application/zip,application/x-zip-compressed"), noMime)
        assertTrue(zip.contains("application/zip"))
        assertEquals(listOf("*/*"), FilePicker.mimeTypesFor(emptyList(), noMime))
    }
}
