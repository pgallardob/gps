package io.github.pgallardob.punto

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.WebMessage
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** A local map renderer, not a browser for remote pages and not a native command bridge. */
class NativeMap(private val view: WebView) {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val PAGE = "$ORIGIN/assets/punto-map.html"
    }
    @Volatile private var tiles = false
    private var requestedTiles = false
    private var active = false
    private var loaded = false
    private var destroyed = false
    private val assets = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(view.context)).build()

    @SuppressLint("SetJavaScriptEnabled") // Only packaged renderer scripts; no JavascriptInterface is exposed.
    fun initialize() {
        view.isSaveEnabled = false
        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        view.settings.apply {
            javaScriptEnabled = true
            setGeolocationEnabled(false)
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "PuntoAndroid/0.2 (+https://pgallardob.github.io/gps/)"
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(webView: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                val canonical = url.port in listOf(-1, 443) && url.userInfo == null && url.query == null && url.fragment == null
                if (canonical && request.method == "GET" && url.scheme == "https" && url.host == "appassets.androidplatform.net" && url.path.orEmpty().startsWith("/assets/")) {
                    return assets.shouldInterceptRequest(url) ?: blocked()
                }
                if (tiles && canonical && request.method == "GET" && url.scheme == "https" && url.host == "tile.openstreetmap.org" &&
                    Regex("/[0-9]{1,2}/[0-9]+/[0-9]+\\.png").matches(url.path.orEmpty())) return null
                return blocked()
            }
            override fun shouldOverrideUrlLoading(webView: WebView, request: WebResourceRequest): Boolean {
                if (request.url.toString() == PAGE) return false
                val allowed = request.url.scheme == "https" && request.url.host in setOf("www.openstreetmap.org", "leafletjs.com")
                if (request.isForMainFrame && request.hasGesture() && allowed) {
                    runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                }
                return true
            }
            override fun onPageFinished(webView: WebView, url: String) {
                if (!destroyed && url == PAGE) { loaded = true; render() }
            }
        }
        view.loadUrl(PAGE)
    }

    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    fun allowTiles(enabled: Boolean) { requestedTiles = enabled && !BuildConfig.SIMULATION; tiles = active && requestedTiles; render() }
    fun render(center: Boolean = false) {
        if (!loaded || destroyed) return
        if (!active) {
            view.postWebMessage(WebMessage(JSONObject().put("type", "state").put("segments", JSONArray()).put("tiles", false).toString()), Uri.parse(ORIGIN))
            return
        }
        val snapshot = PersonalData.route.snapshot()
        val segments = JSONArray(snapshot.segments.map { segment -> JSONArray(segment.map { JSONArray().put(it.fix.latitude).put(it.fix.longitude) }) })
        val state = JSONObject().put("type", "state").put("segments", segments).put("tiles", tiles).put("center", center)
        PersonalData.current?.takeIf { it.coordinatesValid() }?.let {
            state.put("point", JSONObject().put("latitude", it.latitude).put("longitude", it.longitude).put("accuracy", it.accuracy))
            state.put("fresh", SystemClock.elapsedRealtime() - it.elapsedMillis in 0L..20000L)
        }
        view.postWebMessage(WebMessage(state.toString()), Uri.parse(ORIGIN))
    }
    fun setActive(enabled: Boolean) {
        active = enabled
        tiles = active && requestedTiles
        if (active) view.onResume()
        render()
        if (!active) view.onPause()
    }
    fun destroy() { destroyed = true; view.stopLoading(); view.destroy() }
}
