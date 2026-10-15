package com.olivercraftboy.nortest

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.MimeTypeMap
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

class MainActivity : ComponentActivity() {

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val START_URL = "https://$HOST/assets/www/index.html"
        const val UPDATE_URL = "https://oliver-apps.sites.tab.bot/versions.json"
    }

    private lateinit var root: FrameLayout
    private var webView: WebView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var updater: AppUpdater? = null
    private var manualUpdateCheck = false

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val data = res.data
        val uris = mutableListOf<Uri>()
        if (res.resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) {
                for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
            } else {
                data.data?.let { uris.add(it) }
            }
        }
        cb.onReceiveValue(uris.toTypedArray())
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val askStorage = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        setContentView(root)
        createWebView()
        webView?.loadUrl(START_URL)

        PlaybackService.start(this)
        requestNotificationPermission()

        // In-app updates from the shared version manifest (see README "Updating").
        updater = try {
            AppUpdater(this, UPDATE_URL, installedVersionCode(), BuildConfigCompat.versionName(this), getString(R.string.app_name),
                ContextCompat.getColor(this, R.color.brand), Color.rgb(0x16, 0x18, 0x20))
        } catch (_: Throwable) { null }
        AppUpdater.publishShortcut(this, R.drawable.ic_update)
        if (intent?.action == AppUpdater.ACTION_CHECK_UPDATES) manualUpdateCheck = true

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Back keeps the music going: send the app to the background instead of closing it.
                moveTaskToBack(true)
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)
        val wv = WebView(this)
        wv.setBackgroundColor(ContextCompat.getColor(this, R.color.bg))
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString + " NortestApp/" + BuildConfigCompat.versionName(this@MainActivity)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Keep the page's renderer at full priority even when the screen is off,
            // so music keeps playing in the background.
            wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        }
        wv.addJavascriptInterface(NortestBridge(this), "NortestNative")
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == HOST) return false
                if (url.scheme == "blob" || url.scheme == "data") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url)); true
                } catch (_: ActivityNotFoundException) { true }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The page crashed or was killed: rebuild it instead of crashing the app.
                PlayerHub.detach(view)
                root.removeView(view)
                view.destroy()
                webView = null
                PlayerHub.updateState(false, 0L, -1L, 1f)
                createWebView()
                webView?.loadUrl(START_URL)
                return true
            }
        }
        wv.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFiles.launch(fileIntent(params))
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                android.util.Log.d("NortestWeb", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")")
                return true
            }

            override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?) = false
        }
        root.addView(wv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView = wv
        PlayerHub.attach(wv)
    }

    /** Build the system file picker intent from the page's accept= list (audio, zip, images...). */
    private fun fileIntent(params: WebChromeClient.FileChooserParams): Intent {
        val mimes = FilePicker.mimeTypesFor(params.acceptTypes.toList()) { ext ->
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
        }
        return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (mimes.size == 1) mimes[0] else "*/*"
            if (mimes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun canWritePublicDownloads(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return true
        val ok = ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        if (!ok) runOnUiThread { askStorage.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) }
        return ok
    }

    fun setImmersiveBars(on: Boolean) {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        if (on) {
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            c.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == AppUpdater.ACTION_CHECK_UPDATES) manualUpdateCheck = true
    }

    override fun onResume() {
        super.onResume()
        try {
            val u = updater ?: return
            if (manualUpdateCheck) { manualUpdateCheck = false; u.checkNow() } else u.onResume()
        } catch (_: Throwable) { }
    }

    private fun installedVersionCode(): Long {
        val info = packageManager.getPackageInfo(packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }

    // Note: we deliberately do NOT call webView.onPause()/pauseTimers() in onPause/onStop,
    // so the player keeps running (and playing) with the screen off.

    override fun onDestroy() {
        webView?.let {
            PlayerHub.detach(it)
            it.evaluateJavascript("try{au.pause()}catch(e){}", null)
            root.removeView(it)
            it.destroy()
        }
        webView = null
        PlayerHub.updateState(false, 0L, -1L, 1f)
        stopService(Intent(this, PlaybackService::class.java))
        super.onDestroy()
    }
}
