package com.olivercraftboy.nortest

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceMusicTest {

    @Test fun unknownTagsBecomeFriendlyNames() {
        val s = DeviceMusicParse.song(7, "<unknown>", "My Song.mp3", "<unknown>", "  ", 3, 215000, 1700000000, "audio/mpeg", 4000000)!!
        assertEquals("My Song", s.title)
        assertEquals("Unknown Artist", s.artist)
        assertEquals("Unknown Album", s.album)
        assertEquals(215000L, s.durationMs)
    }

    @Test fun titleFallbacks() {
        assertEquals("Real Title", DeviceMusicParse.title(" Real Title ", "x.mp3"))
        assertEquals("track.01", DeviceMusicParse.title(null, "track.01.flac"))
        assertEquals(".hidden", DeviceMusicParse.title("", ".hidden"))
        assertEquals("Unknown song", DeviceMusicParse.title(null, null))
    }

    @Test fun badRowsAreSkippedAndNegativesClamped() {
        assertNull(DeviceMusicParse.song(0, "a", "a.mp3", "b", "c", 1, 1, 1, null, 1))
        val s = DeviceMusicParse.song(5, "a", null, "b", "c", 1, -1, -5, null, -9)!!
        assertEquals(0L, s.durationMs); assertEquals(0L, s.addedSec); assertEquals(0L, s.size); assertEquals("", s.mime)
    }

    @Test fun jsonRoundTripKeepsQuotesAndUnicodeEscapes() {
        val list = listOf(
            DeviceMusicParse.song(1, "Say \"Hi\" </script>", null, "A & B", "Alb\\um", 9, 180500, 1700000001, "audio/mpeg", 123)!!,
            DeviceMusicParse.song(2, "Caf\u00e9", null, "X", "Y", 9, 1, 2, "audio/flac", 5)!!
        )
        val a = JSONArray(DeviceMusicParse.toJson(list))
        assertEquals(2, a.length())
        val o = a.getJSONObject(0)
        assertEquals(1L, o.getLong("id")); assertEquals("Say \"Hi\" </script>", o.getString("t"))
        assertEquals("A & B", o.getString("ar")); assertEquals("Alb\\um", o.getString("al"))
        assertEquals(180500L, o.getLong("d")); assertEquals(1700000001L, o.getLong("ad")); assertEquals(9L, o.getLong("aid"))
        assertEquals("Caf\u00e9", a.getJSONObject(1).getString("t"))
        assertEquals("[]", DeviceMusicParse.toJson(emptyList()))
    }

    @Test fun rangeParsing() {
        val n = 1000L
        assertEquals(ByteRange.Full, DeviceMusicParse.parseRange(null, n))
        assertEquals(ByteRange.Full, DeviceMusicParse.parseRange("", n))
        assertEquals(ByteRange.Full, DeviceMusicParse.parseRange("items=0-1", n))
        assertEquals(ByteRange.Partial(0, 999), DeviceMusicParse.parseRange("bytes=0-", n))
        assertEquals(ByteRange.Partial(100, 199), DeviceMusicParse.parseRange("bytes=100-199", n))
        assertEquals(ByteRange.Partial(500, 999), DeviceMusicParse.parseRange("bytes=500-5000", n))
        assertEquals(ByteRange.Partial(900, 999), DeviceMusicParse.parseRange("bytes=-100", n))
        assertEquals(ByteRange.Partial(0, 999), DeviceMusicParse.parseRange("bytes=-5000", n))
        assertEquals(ByteRange.Partial(10, 20), DeviceMusicParse.parseRange("BYTES=10-20, 30-40", n))
        assertEquals(ByteRange.Unsatisfiable, DeviceMusicParse.parseRange("bytes=1000-", n))
        assertEquals(ByteRange.Full, DeviceMusicParse.parseRange("bytes=abc-", n))
        assertEquals(ByteRange.Full, DeviceMusicParse.parseRange("bytes=20-10", n))
        assertEquals(ByteRange.Full, DeviceMusicParse.parseRange("bytes=0-", 0))
        assertEquals(1000L, (DeviceMusicParse.parseRange("bytes=0-", n) as ByteRange.Partial).length)
    }

    @Test fun routes() {
        assertEquals("audio" to 42L, DeviceMusicParse.route("/devicemusic/audio/42"))
        assertEquals("art" to 7L, DeviceMusicParse.route("/devicemusic/art/7"))
        assertNull(DeviceMusicParse.route("/devicemusic/audio/0"))
        assertNull(DeviceMusicParse.route("/devicemusic/audio/../../etc"))
        assertNull(DeviceMusicParse.route("/devicemusic/video/1"))
        assertNull(DeviceMusicParse.route("/assets/www/index.html"))
        assertNull(DeviceMusicParse.route(null))
    }

    @Test fun permissionFlow() {
        assertEquals("granted", DeviceMusicParse.permissionState(true, false, false))
        assertEquals("granted", DeviceMusicParse.permissionState(true, true, true))
        // never asked: show the Allow button (Android will show its prompt)
        assertEquals("ask", DeviceMusicParse.permissionState(false, false, false))
        // said no once: Android still lets us ask again
        assertEquals("denied", DeviceMusicParse.permissionState(false, true, true))
        // said no twice / "don't ask again": only Settings can turn it on
        assertEquals("blocked", DeviceMusicParse.permissionState(false, true, false))
    }
}
