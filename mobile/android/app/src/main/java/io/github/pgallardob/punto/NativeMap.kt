package io.github.pgallardob.punto

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebMessage
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** Only the packaged dashboard can call the closed native device adapter. */
class NativeMap(private val view: WebView, private val command: (JSONObject) -> Unit, private val ready: () -> Unit) {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val PAGE = "$ORIGIN/assets/index.html"
    }
    @Volatile private var tiles = false
    private var requestedTiles = false
    private var active = false
    private var loaded = false
    private var destroyed = false
    private val assets = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(view.context)).build()

    @SuppressLint("SetJavaScriptEnabled") // Only packaged renderer scripts; no JavascriptInterface is exposed.
    fun initialize(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        val major = WebViewCompat.getCurrentWebViewPackage(view.context)?.versionName?.substringBefore('.')?.toIntOrNull()
        if (major != null && major < 86) return false // The shared dashboard uses replaceChildren (Chromium 86+).
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
            userAgentString = "PuntoAndroid/0.3 (+https://pgallardob.github.io/gps/)"
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
                if (!destroyed && url == PAGE) { loaded = true; ready() }
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onJsConfirm(webView: WebView, url: String, message: String, result: JsResult): Boolean {
                if (url != PAGE || !active || destroyed) { result.cancel(); return true }
                AlertDialog.Builder(view.context).setTitle("Confirmar acción").setMessage(message.take(2000))
                    .setPositiveButton("Continuar") { _, _ -> result.confirm() }
                    .setNegativeButton("Cancelar") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
        }
        WebViewCompat.addWebMessageListener(view, "PuntoHost", setOf(ORIGIN)) { _, message, sourceOrigin, isMainFrame, _ ->
            if (!destroyed && isMainFrame && sourceOrigin.toString() == ORIGIN && view.url == PAGE) {
                runCatching { message.data?.takeIf { it.length <= 65536 }?.let { command(JSONObject(it)) } }
            }
        }
        view.loadUrl(PAGE)
        return true
    }

    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    fun allowTiles(enabled: Boolean) { requestedTiles = enabled && !BuildConfig.SIMULATION; tiles = active && requestedTiles }
    fun send(data: JSONObject) {
        if (!loaded || destroyed) return
        val text = data.toString()
        if (text.length <= 24000) view.postWebMessage(WebMessage(text), Uri.parse(ORIGIN))
        else {
            val post: (JSONObject) -> Unit = { view.postWebMessage(WebMessage(it.toString()), Uri.parse(ORIGIN)) }
            post(JSONObject().put("type", "frameBegin"))
            text.chunked(8000).forEach { post(JSONObject().put("type", "framePart").put("text", it)) }
            post(JSONObject().put("type", "frameFinish"))
        }
    }
    fun setActive(enabled: Boolean) {
        active = enabled
        tiles = active && requestedTiles
        if (active) view.onResume()
        send(JSONObject().put("type", "visibility").put("visible", active))
        if (!active) view.onPause()
    }
    fun destroy() { destroyed = true; view.stopLoading(); view.destroy() }
}
