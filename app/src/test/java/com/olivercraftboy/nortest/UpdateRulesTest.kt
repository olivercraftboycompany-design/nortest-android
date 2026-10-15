package com.olivercraftboy.nortest

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {
    private val pkg = "com.olivercraftboy.bibley"
    private val manifest = """
        {
          "_readme": "bump versionCode + versionName + notes here after uploading the new APK",
          "com.olivercraftboy.bibley": {"versionCode": 3, "versionName": "1.2", "url": "https://oliver-apps.sites.tab.bot/apks/Bibley.apk", "notes": "Faster search"},
          "com.olivercraftboy.weedx": {"versionCode": 2, "versionName": "1.1", "url": "https://oliver-apps.sites.tab.bot/apks/Weed-X.apk"},
          "com.olivercraftboy.bad1": {"versionCode": 0, "url": "https://x/y.apk"},
          "com.olivercraftboy.bad2": {"versionCode": 4, "url": "http://insecure/y.apk"}
        }
    """.trimIndent()
    private val H = 60L * 60 * 1000

    @Test fun parsesItsOwnEntry() {
        val r = UpdateRules.parse(manifest, pkg)!!
        assertEquals(3L, r.versionCode)
        assertEquals("1.2", r.versionName)
        assertEquals("https://oliver-apps.sites.tab.bot/apks/Bibley.apk", r.url)
        assertEquals("Faster search", r.notes)
        val w = UpdateRules.parse(manifest, "com.olivercraftboy.weedx")!!
        assertEquals("", w.notes)
    }

    @Test fun missingOrBadEntriesAreIgnored() {
        assertNull(UpdateRules.parse(manifest, "com.olivercraftboy.nothere"))
        assertNull(UpdateRules.parse(manifest, "com.olivercraftboy.bad1"))
        assertNull(UpdateRules.parse(manifest, "com.olivercraftboy.bad2"))
        assertNotNull(UpdateRules.parse(manifest, "com.olivercraftboy.bad2", allowHttp = true))
        assertNull(UpdateRules.parse(manifest, "_readme"))
        assertNull(UpdateRules.parse("<html>502 Bad Gateway</html>", pkg))
        assertNull(UpdateRules.parse("", pkg))
        assertNull(UpdateRules.parse(null, pkg))
    }

    @Test fun checksAtMostEverySixHours() {
        val now = 1_000_000_000_000L
        assertTrue(UpdateRules.dueForCheck(now, 0L, 0L))
        assertFalse(UpdateRules.dueForCheck(now, now - 5 * H, now - 5 * H))
        assertTrue(UpdateRules.dueForCheck(now, now - 6 * H, now - 6 * H))
        // a failed try 2 minutes ago waits; 11 minutes ago retries
        assertFalse(UpdateRules.dueForCheck(now, now - 7 * H, now - 2 * 60_000L))
        assertTrue(UpdateRules.dueForCheck(now, now - 7 * H, now - 11 * 60_000L))
        // clock moved backwards
        assertTrue(UpdateRules.dueForCheck(now, now + 3 * H, now + 3 * H))
    }

    @Test fun promptsOnlyForNewerAndRespectsSnooze() {
        val r = UpdateRules.Release(3, "1.2", "https://a/b.apk", "")
        val now = 5_000_000L * H
        assertTrue(UpdateRules.shouldPrompt(r, 2, -1, 0, now, false))
        assertFalse(UpdateRules.shouldPrompt(r, 3, -1, 0, now, false))
        assertFalse(UpdateRules.shouldPrompt(r, 4, -1, 0, now, true))
        // "Later" on v3 hides v3 for 24 h ...
        assertFalse(UpdateRules.shouldPrompt(r, 2, 3, now + 23 * H, now, false))
        assertTrue(UpdateRules.shouldPrompt(r, 2, 3, now - 1, now, false))
        // ... but not a newer v4, and not a manual check
        assertTrue(UpdateRules.shouldPrompt(r.copy(versionCode = 4), 2, 3, now + 23 * H, now, false))
        assertTrue(UpdateRules.shouldPrompt(r, 2, 3, now + 23 * H, now, true))
    }

    @Test fun downloadedApkMustBeThisAppAndNewer() {
        assertTrue(UpdateRules.apkAcceptable(pkg, 3, pkg, 2))
        assertFalse(UpdateRules.apkAcceptable(pkg, 2, pkg, 2))
        assertFalse(UpdateRules.apkAcceptable("com.evil", 9, pkg, 2))
        assertFalse(UpdateRules.apkAcceptable(null, -1, pkg, 2))
    }

    @Test fun cacheBuster() {
        assertEquals("https://x/v.json?t=2", UpdateRules.cacheBusted("https://x/v.json", 120_000L))
        assertEquals("https://x/v.json?a=1&t=2", UpdateRules.cacheBusted("https://x/v.json?a=1", 120_000L))
    }
}
