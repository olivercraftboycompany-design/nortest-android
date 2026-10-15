package com.olivercraftboy.nortest

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInfo
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * In-app updates for sideloaded apps.
 *
 * One shared manifest (versions.json) lists every app:
 *   { "<package>": { "versionCode": 3, "versionName": "1.2", "url": "https://.../App.apk", "notes": "..." } }
 * The app checks it on launch and when it comes back to the foreground, at most once every 6 hours.
 * If the manifest's versionCode is higher than the installed one, it shows "Update available".
 * "Later" snoozes that version for 24 hours. "Update" downloads the APK inside the app, checks it is
 * this app and newer, makes sure "Install unknown apps" is allowed for this app, then opens the
 * system installer. Anything that fails falls back to opening the APK link in the browser.
 * Network failures while checking are silent.
 */
object UpdateRules {
    const val CHECK_EVERY_MS = 6L * 60 * 60 * 1000
    const val RETRY_AFTER_FAIL_MS = 10L * 60 * 1000
    const val SNOOZE_MS = 24L * 60 * 60 * 1000

    data class Release(val versionCode: Long, val versionName: String, val url: String, val notes: String)

    /** The entry for [packageName], or null when it is missing or malformed. */
    fun parse(json: String?, packageName: String, allowHttp: Boolean = false): Release? {
        if (json.isNullOrBlank()) return null
        return try {
            val o = JSONObject(json).optJSONObject(packageName) ?: return null
            val code = o.optLong("versionCode", -1L)
            val url = o.optString("url", "")
            if (code <= 0L || !(url.startsWith("https://") || (allowHttp && url.startsWith("http://")))) return null
            Release(code, o.optString("versionName", code.toString()), url, o.optString("notes", "").trim())
        } catch (_: Throwable) {
            null
        }
    }

    /** Time for an automatic check? (6 h after the last good check, 10 min after a failed try.) */
    fun dueForCheck(now: Long, lastOk: Long, lastAttempt: Long): Boolean {
        val okAge = now - lastOk
        val tryAge = now - lastAttempt
        // A clock that moved backwards counts as due.
        val okDue = okAge < 0 || okAge >= CHECK_EVERY_MS
        val tryDue = tryAge < 0 || tryAge >= RETRY_AFTER_FAIL_MS
        return okDue && tryDue
    }

    /** Show the dialog? Manual checks ignore the snooze. */
    fun shouldPrompt(r: Release, installedCode: Long, snoozedCode: Long, snoozeUntil: Long, now: Long, manual: Boolean): Boolean {
        if (r.versionCode <= installedCode) return false
        if (manual) return true
        return !(snoozedCode == r.versionCode && now < snoozeUntil)
    }

    /** Is a downloaded APK acceptable? Same package, newer than what is installed. */
    fun apkAcceptable(apkPackage: String?, apkCode: Long, myPackage: String, installedCode: Long): Boolean =
        apkPackage == myPackage && apkCode > installedCode

    fun cacheBusted(url: String, now: Long): String = url + (if (url.contains('?')) "&" else "?") + "t=" + (now / 60000L)
}

class AppUpdater(
    private val activity: Activity,
    private val manifestUrl: String,
    private val installedCode: Long,
    private val installedName: String,
    private val appLabel: String,
    accent: Int,
    surface: Int,
) {
    companion object {
        const val ACTION_CHECK_UPDATES = "com.olivercraftboy.action.CHECK_UPDATES"
        const val APK_MIME = "application/vnd.android.package-archive"
        private const val PREFS = "app_updater"
        private val io = Executors.newSingleThreadExecutor()

        /** Fetches the manifest text; replaced in tests. Returns null on any failure. */
        @JvmStatic
        var fetcher: (String) -> String? = { url -> httpGetText(url) }

        /** Reads (package, versionCode) from a downloaded APK; replaced in tests. */
        @JvmStatic
        var archiveInfo: (Context, File) -> Pair<String?, Long> = { ctx, f ->
            val info: PackageInfo? = try { ctx.packageManager.getPackageArchiveInfo(f.absolutePath, 0) } catch (_: Throwable) { null }
            @Suppress("DEPRECATION")
            val code = if (info == null) -1L else if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
            Pair(info?.packageName, code)
        }

        /** Tests serve the APK from a local http server. */
        @JvmStatic
        var allowHttpForTests = false

        fun httpGetText(url: String): String? {
            var c: HttpURLConnection? = null
            return try {
                c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 10_000
                c.readTimeout = 10_000
                c.instanceFollowRedirects = true
                c.setRequestProperty("Cache-Control", "no-cache")
                c.setRequestProperty("Accept", "application/json")
                if (c.responseCode != 200) null else c.inputStream.use { s -> String(s.readBytes(), Charsets.UTF_8) }
            } catch (_: Throwable) {
                null
            } finally {
                try { c?.disconnect() } catch (_: Throwable) { }
            }
        }

        fun fileAuthority(ctx: Context): String = ctx.packageName + ".files"

        /** The intent that hands a downloaded APK to the system installer. */
        fun installIntent(ctx: Context, apk: File): Intent {
            val uri = FileProvider.getUriForFile(ctx, fileAuthority(ctx), apk)
            return Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        /** Settings screen for "Install unknown apps" for this app (Android 8+). */
        fun unknownSourcesIntent(ctx: Context): Intent =
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName))

        fun browserIntent(url: String): Intent =
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        fun canInstallPackages(ctx: Context): Boolean =
            Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

        fun updatesDir(ctx: Context): File = File(ctx.cacheDir, "updates")

        /** Long-press on the app icon: "Check for updates". */
        fun publishShortcut(activity: Activity, iconRes: Int) {
            try {
                val intent = Intent(activity, activity.javaClass).setAction(ACTION_CHECK_UPDATES)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                val info = ShortcutInfoCompat.Builder(activity, "check_updates")
                    .setShortLabel("Check for updates")
                    .setLongLabel("Check for updates")
                    .setIcon(IconCompat.createWithResource(activity, iconRes))
                    .setIntent(intent)
                    .build()
                ShortcutManagerCompat.pushDynamicShortcut(activity, info)
            } catch (_: Throwable) { }
        }

        private fun lum(c: Int): Double = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255.0
    }

    private val prefs: SharedPreferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val surfaceColor = surface
    private val onSurface = if (lum(surface) > 0.55) Color.rgb(20, 22, 28) else Color.WHITE
    private val muted = (onSurface and 0x00FFFFFF) or (0xB0 shl 24)
    // Keep the button readable even when the theme color is close to the dialog background.
    private val accentColor = if (Math.abs(lum(accent) - lum(surface)) < 0.22) onSurface else accent
    private val onAccent = if (lum(accentColor) > 0.52) Color.rgb(16, 18, 24) else Color.WHITE
    private var checking = false
    private var dialog: Dialog? = null
    @Volatile private var cancelDownload = false

    private fun now() = System.currentTimeMillis()
    private fun alive() = !activity.isFinishing && !(Build.VERSION.SDK_INT >= 17 && activity.isDestroyed)

    /** Call from Activity.onResume(): finishes a pending install, else maybe checks. */
    fun onResume() {
        if (resumePendingInstall()) return
        if (dialog?.isShowing == true || checking) return
        if (UpdateRules.dueForCheck(now(), prefs.getLong("last_ok", 0L), prefs.getLong("last_try", 0L))) check(false)
    }

    /** "Check for updates" from the shortcut: always fetches and always answers. */
    fun checkNow() {
        if (checking) return
        dialog?.dismiss()
        check(true)
    }

    private fun check(manual: Boolean) {
        checking = true
        prefs.edit().putLong("last_try", now()).apply()
        if (manual) toast("Checking for updates...")
        val url = UpdateRules.cacheBusted(manifestUrl, now())
        io.execute {
            cleanupOld()
            val text = try { fetcher(url) } catch (_: Throwable) { null }
            val rel = UpdateRules.parse(text, activity.packageName, allowHttpForTests)
            main.post {
                checking = false
                if (!alive()) return@post
                if (text == null) {
                    if (manual) toast("Couldn't check for updates. Check your connection.")
                    return@post
                }
                prefs.edit().putLong("last_ok", now()).apply()
                val snoozed = prefs.getLong("snooze_code", -1L)
                val until = prefs.getLong("snooze_until", 0L)
                if (rel != null && UpdateRules.shouldPrompt(rel, installedCode, snoozed, until, now(), manual)) {
                    showUpdate(rel)
                } else if (manual) {
                    toast("$appLabel is up to date (v$installedName)")
                }
            }
        }
    }

    // ---------------------------------------------------------------- dialogs

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), activity.resources.displayMetrics).toInt()

    private fun newCard(cancelable: Boolean): Pair<Dialog, LinearLayout> {
        dialog?.let { try { it.dismiss() } catch (_: Throwable) { } }
        val d = Dialog(activity)
        d.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val box = LinearLayout(activity)
        box.orientation = LinearLayout.VERTICAL
        box.setPadding(dp(22), dp(20), dp(22), dp(14))
        box.background = GradientDrawable().apply {
            cornerRadius = dp(20).toFloat()
            setColor(surfaceColor)
            setStroke(dp(1), (accentColor and 0x00FFFFFF) or (0x66 shl 24))
        }
        d.setContentView(box)
        d.setCancelable(cancelable)
        d.setCanceledOnTouchOutside(false)
        d.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        val w = activity.resources.displayMetrics.widthPixels
        d.window?.setLayout(minOf((w * 0.88).toInt(), dp(420)), ViewGroup.LayoutParams.WRAP_CONTENT)
        dialog = d
        return d to box
    }

    private fun text(box: LinearLayout, s: String, sp: Float, color: Int, bold: Boolean = false, top: Int = 0): TextView {
        val t = TextView(activity)
        t.text = s
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        t.setTextColor(color)
        if (bold) t.setTypeface(t.typeface, Typeface.BOLD)
        t.setLineSpacing(0f, 1.15f)
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(top)
        box.addView(t, lp)
        return t
    }

    private fun buttonRow(box: LinearLayout): LinearLayout {
        val row = LinearLayout(activity)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.END or Gravity.CENTER_VERTICAL
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(18)
        box.addView(row, lp)
        return row
    }

    private fun button(row: LinearLayout, label: String, filled: Boolean, onClick: () -> Unit): TextView {
        val b = TextView(activity)
        b.text = label
        b.isAllCaps = false
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        b.setTypeface(b.typeface, Typeface.BOLD)
        b.gravity = Gravity.CENTER
        b.minHeight = dp(44)
        b.setPadding(dp(18), dp(10), dp(18), dp(10))
        if (filled) {
            b.setTextColor(onAccent)
            b.background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(accentColor) }
        } else {
            b.setTextColor(muted)
        }
        b.isClickable = true
        b.isFocusable = true
        b.setOnClickListener { onClick() }
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.leftMargin = dp(8)
        row.addView(b, lp)
        return b
    }

    private fun showUpdate(r: UpdateRules.Release) {
        if (!alive()) return
        val (d, box) = newCard(true)
        text(box, "Update available - v" + r.versionName, 20f, onSurface, bold = true)
        text(box, "$appLabel v$installedName is installed.", 13f, muted, top = 4)
        if (r.notes.isNotEmpty()) text(box, r.notes, 15f, onSurface, top = 12)
        val row = buttonRow(box)
        button(row, "Later", false) { snooze(r); d.dismiss() }
        button(row, "Update", true) { startDownload(r) }
        d.setOnCancelListener { snooze(r) }
        d.show()
    }

    private fun snooze(r: UpdateRules.Release) {
        prefs.edit().putLong("snooze_code", r.versionCode).putLong("snooze_until", now() + UpdateRules.SNOOZE_MS).apply()
    }

    @SuppressLint("SetTextI18n")
    private fun startDownload(r: UpdateRules.Release) {
        val (d, box) = newCard(true)
        text(box, "Downloading v" + r.versionName, 19f, onSurface, bold = true)
        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal)
        bar.max = 100
        bar.isIndeterminate = true
        if (Build.VERSION.SDK_INT >= 21) {
            bar.progressTintList = ColorStateList.valueOf(accentColor)
            bar.indeterminateTintList = ColorStateList.valueOf(accentColor)
        }
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(10))
        lp.topMargin = dp(16)
        box.addView(bar, lp)
        val status = text(box, "Starting...", 13f, muted, top = 8)
        val row = buttonRow(box)
        cancelDownload = false
        button(row, "Cancel", false) { cancelDownload = true; d.dismiss() }
        d.setOnCancelListener { cancelDownload = true }
        d.show()

        val dir = updatesDir(activity)
        io.execute {
            val result = download(r, dir) { done, total ->
                main.post {
                    if (total > 0) {
                        bar.isIndeterminate = false
                        val pct = (done * 100 / total).toInt()
                        bar.progress = pct
                        status.text = "$pct%  -  " + mb(done) + " of " + mb(total)
                    } else {
                        status.text = mb(done)
                    }
                }
            }
            main.post {
                if (cancelDownload) { result?.delete(); return@post }
                try { d.dismiss() } catch (_: Throwable) { }
                if (!alive()) return@post
                if (result == null) {
                    toast("Update download failed. Opening it in your browser instead.")
                    openInBrowser(r.url)
                } else {
                    readyToInstall(result, r)
                }
            }
        }
    }

    private fun mb(b: Long): String = String.format(java.util.Locale.US, "%.1f MB", b / 1048576.0)

    /** Downloads to cache/updates and checks it is this app and newer. Null on any failure. */
    private fun download(r: UpdateRules.Release, dir: File, progress: (Long, Long) -> Unit): File? {
        var c: HttpURLConnection? = null
        val part = File(dir, activity.packageName + "-" + r.versionCode + ".apk.part")
        val out = File(dir, activity.packageName + "-" + r.versionCode + ".apk")
        try {
            dir.mkdirs()
            dir.listFiles()?.forEach { if (it.name != out.name) it.delete() }
            var url = URL(r.url)
            var hops = 0
            while (true) {
                c = url.openConnection() as HttpURLConnection
                c.connectTimeout = 15_000
                c.readTimeout = 30_000
                c.instanceFollowRedirects = false
                val code = c.responseCode
                if (code in 300..399 && hops < 6) {
                    val loc = c.getHeaderField("Location") ?: return null
                    url = URL(url, loc)
                    c.disconnect()
                    hops++
                    continue
                }
                if (code != 200) return null
                break
            }
            val conn = c!!
            val total = conn.contentLengthLong
            var done = 0L
            var lastTick = 0L
            conn.inputStream.use { input ->
                part.outputStream().use { o ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelDownload) return null
                        val n = input.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        done += n
                        val t = System.currentTimeMillis()
                        if (t - lastTick > 150) { lastTick = t; progress(done, total) }
                    }
                }
            }
            progress(done, total)
            if (total > 0 && done != total) return null
            out.delete()
            if (!part.renameTo(out)) return null
            val (apkPkg, apkCode) = archiveInfo(activity, out)
            if (!UpdateRules.apkAcceptable(apkPkg, apkCode, activity.packageName, installedCode)) { out.delete(); return null }
            return out
        } catch (_: Throwable) {
            part.delete()
            return null
        } finally {
            try { c?.disconnect() } catch (_: Throwable) { }
        }
    }

    private fun readyToInstall(apk: File, r: UpdateRules.Release) {
        if (canInstallPackages(activity)) {
            launchInstaller(apk, r.url)
            return
        }
        prefs.edit().putString("pending_apk", apk.absolutePath).putString("pending_url", r.url)
            .putBoolean("pending_waiting", false).apply()
        askInstallPermission(first = true)
    }

    private fun askInstallPermission(first: Boolean) {
        if (!alive()) return
        val url = prefs.getString("pending_url", null) ?: return
        val (d, box) = newCard(true)
        text(box, if (first) "One more step" else "Installing is still blocked", 19f, onSurface, bold = true)
        text(box, "Android needs your OK once: turn on \"Allow from this source\" for $appLabel, then come back here.", 15f, onSurface, top = 10)
        val row = buttonRow(box)
        button(row, if (first) "Cancel" else "Use browser", false) {
            d.dismiss()
            if (!first) { clearPending(); openInBrowser(url) } else clearPending()
        }
        button(row, if (first) "Continue" else "Open settings", true) {
            d.dismiss()
            prefs.edit().putBoolean("pending_waiting", true).apply()
            try {
                activity.startActivity(unknownSourcesIntent(activity))
            } catch (_: Throwable) {
                clearPending()
                openInBrowser(url)
            }
        }
        d.setOnCancelListener { clearPending() }
        d.show()
    }

    /** Back from the "Install unknown apps" screen: install if allowed now. */
    private fun resumePendingInstall(): Boolean {
        if (!prefs.getBoolean("pending_waiting", false)) return false
        val path = prefs.getString("pending_apk", null)
        val url = prefs.getString("pending_url", null)
        val apk = path?.let { File(it) }
        if (apk == null || url == null || !apk.exists()) { clearPending(); return false }
        prefs.edit().putBoolean("pending_waiting", false).apply()
        if (canInstallPackages(activity)) {
            clearPending()
            launchInstaller(apk, url)
        } else {
            askInstallPermission(first = false)
        }
        return true
    }

    private fun clearPending() {
        prefs.edit().remove("pending_apk").remove("pending_url").remove("pending_waiting").apply()
    }

    private fun launchInstaller(apk: File, url: String) {
        try {
            activity.startActivity(installIntent(activity, apk))
        } catch (e: Throwable) {
            android.util.Log.w("AppUpdater", "installer failed, opening the browser", e)
            openInBrowser(url)
        }
    }

    private fun openInBrowser(url: String) {
        try { activity.startActivity(browserIntent(url)) } catch (_: Throwable) { toast("Couldn't open $url") }
    }

    private fun cleanupOld() {
        try {
            if (prefs.getString("pending_apk", null) == null) updatesDir(activity).listFiles()?.forEach { it.delete() }
        } catch (_: Throwable) { }
    }

    private fun toast(s: String) {
        try { Toast.makeText(activity, s, Toast.LENGTH_SHORT).show() } catch (_: Throwable) { }
    }
}
