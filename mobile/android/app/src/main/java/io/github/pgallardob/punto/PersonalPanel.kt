package io.github.pgallardob.punto

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.webkit.WebView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.io.ByteArrayOutputStream

/** Closed device adapter for the packaged dashboard. It has no relay client. */
class PersonalPanel(private val activity: Activity) {
    private val map = NativeMap(activity.findViewById<WebView>(R.id.map), ::command, ::render)
    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val locations = requireNotNull(activity.getSystemService(LocationManager::class.java))
    private var resumed = false
    private var visible = true
    private var locateId: Int? = null
    private var watchId: Int? = null
    private var starting = false
    private var generation = 0
    private var export: StringBuilder? = null
    private var pendingExport: String? = null
    private var exportFormat = "geojson"
    private var saving = false
    private val freshness = Runnable { render() }
    private val observer: () -> Unit = {
        if (starting && SessionStatus.current.mode == SessionMode.PERSONAL) starting = false
        render()
    }
    private val oneShot = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val id = locateId ?: return
            val fix = Fix(location.latitude, location.longitude, location.accuracy.toDouble(), location.elapsedRealtimeNanos / 1000000)
            try { fix.validate(SystemClock.elapsedRealtime()) } catch (_: ShareFailure) { return }
            cancelLocate()
            PersonalData.accept(fix)
            map.send(JSONObject().put("type", "position").put("id", id).put("point", point(fix, System.currentTimeMillis())))
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Compatibility with older providers")
        override fun onStatusChanged(provider: String?, state: Int, extras: Bundle?) {}
    }
    init {
        map.allowTiles(PersonalData.mapTilesEnabled)
        if (!map.initialize()) activity.findViewById<TextView>(R.id.native_error).apply {
            text = "Actualiza Android System WebView para abrir Punto de forma segura."
            visibility = View.VISIBLE
        }
    }
    fun start() { PersonalData.observe(observer); SessionStatus.observe(observer) }
    fun resume() { resumed = true; map.setActive(visible); render() }
    fun pause() { resumed = false; cancelLocate(); map.setActive(false) }
    fun setVisible(value: Boolean) { visible = value; if (!value) cancelLocate(); map.setActive(resumed && visible); render() }
    fun stop() { PersonalData.remove(observer); SessionStatus.remove(observer) }
    fun destroy() { cancelLocate(); worker.shutdown(); map.destroy() }
    private fun notice(text: String) { map.send(JSONObject().put("type", "notice").put("text", text)) }
    private fun error(id: Int, code: Int) { map.send(JSONObject().put("type", "error").put("id", id).put("code", code)) }
    private fun point(fix: Fix, time: Long) = JSONArray().put(fix.latitude).put(fix.longitude).put(fix.accuracy).put(time).put(fix.speed ?: JSONObject.NULL).put(fix.elapsedMillis)
    fun render() {
        handler.removeCallbacks(freshness)
        if (!resumed || !visible) return
        val session = SessionStatus.current
        val snapshot = PersonalData.route.snapshot()
        val segments = JSONArray(snapshot.segments.map { segment -> JSONArray(segment.map { point(it.fix, it.timestampMillis) }) })
        val state = JSONObject().put("type", "state").put("segments", segments)
            .put("message", session.text)
            .put("active", session.active && session.mode == SessionMode.PERSONAL).put("pending", starting)
            .put("fresh", PersonalData.current?.let { SystemClock.elapsedRealtime() - it.elapsedMillis in 0L..20000L } == true)
            .put("visible", true).put("tiles", PersonalData.mapTilesEnabled)
        watchId?.let { state.put("watchId", it) }
        PersonalData.current?.let { state.put("point", point(it, System.currentTimeMillis() - (SystemClock.elapsedRealtime() - it.elapsedMillis).coerceAtLeast(0))) }
        map.send(state)
        PersonalData.current?.let {
            val remaining = 20001 - (SystemClock.elapsedRealtime() - it.elapsedMillis)
            if (remaining in 1L..20001L) handler.postDelayed(freshness, remaining)
        }
    }

    private fun command(data: JSONObject) {
        val type = data.optString("type")
        if (type in listOf("start", "stop", "locate", "clear", "forget")) generation++
        if (type == "stop") {
            PersonalData.route.stop()
            if (SessionStatus.current.active && SessionStatus.current.mode == SessionMode.PERSONAL) activity.startService(Intent(activity, SharingService::class.java).setAction(SharingService.STOP))
            cancelLocate(); render(); return
        }
        if (type == "cancelLocate") { cancelLocate(); render(); return }
        if (type == "clear") {
            PersonalData.route.clear(restartSegment = true)
            map.send(JSONObject().put("type", "cleared")); PersonalData.changed(); return
        }
        if (type == "forget") {
            cancelLocate(); PersonalData.forget()
            if (SessionStatus.current.active) activity.startService(Intent(activity, SharingService::class.java).setAction(SharingService.STOP))
            return
        }
        if (type == "tiles") {
            PersonalData.mapTilesEnabled = data.getBoolean("enabled") && !BuildConfig.SIMULATION
            map.allowTiles(PersonalData.mapTilesEnabled)
            map.send(JSONObject().put("type", "tileAccess").put("enabled", PersonalData.mapTilesEnabled))
            return
        }
        if (!resumed || !visible) {
            if (type in listOf("locate", "start")) { error(data.optInt("id", -1), 2); notice("Mantén Punto visible y vuelve a pulsar el botón.") }
            if (type == "copy") map.send(JSONObject().put("type", "copied").put("id", data.optInt("id", -1)).put("ok", false))
            return
        }
        when (type) {
            "ready" -> render()
            "locate" -> locate(data.getInt("id"))
            "start" -> {
                val id = data.getInt("id")
                val session = SessionStatus.current
                if (session.active) {
                    if (session.mode == SessionMode.PERSONAL) { watchId = id; render() }
                    else { notice("Detén la sesión de compartir antes de iniciar un recorrido."); error(id, 2) }
                } else if (activity.locationReady(true, true) { notice(it) }) {
                    cancelLocate(); watchId = id; starting = true
                    runCatching { activity.startForegroundService(Intent(activity, SharingService::class.java).setAction(SharingService.START_PERSONAL)) }
                        .onFailure { starting = false; error(id, 2) }
                } else error(id, 1)
            }
            "copy" -> {
                val text = data.getString("text")
                val ok = text.length <= 80 && Regex("-?[0-9.]+, -?[0-9.]+").matches(text) && runCatching {
                    requireNotNull(activity.getSystemService(ClipboardManager::class.java)).setPrimaryClip(ClipData.newPlainText("Punto", text))
                }.isSuccess
                map.send(JSONObject().put("type", "copied").put("id", data.getInt("id")).put("ok", ok))
            }
            "import" -> if (!saving) choose(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "application/geo+json", "application/octet-stream")), 902)
            "exportBegin" -> if (!saving && data.optString("format") in listOf("geojson", "gpx")) { exportFormat = data.getString("format"); export = StringBuilder() }
            "exportPart" -> export?.let { buffer -> val text = data.getString("text"); if (buffer.length + text.length <= 4 * 1024 * 1024) buffer.append(text) else { export = null; notice("El archivo supera el límite de 4 MB.") } }
            "exportFinish" -> export?.let {
                pendingExport = it.toString(); export = null
                choose(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(if (exportFormat == "gpx") "application/gpx+xml" else "application/geo+json")
                    .putExtra(Intent.EXTRA_TITLE, "punto-recorrido.$exportFormat"), 901)
            }
        }
    }

    private fun choose(intent: Intent, request: Int) {
        saving = true
        runCatching { activity.startActivityForResult(intent, request) }.onFailure {
            saving = false; export = null; pendingExport = null
            notice("No se pudo abrir el selector de archivos de Android.")
        }
    }

    private fun locate(id: Int) {
        cancelLocate()
        if (SessionStatus.current.active) {
            PersonalData.current?.takeIf { SystemClock.elapsedRealtime() - it.elapsedMillis in 0L..20000L }?.let {
                map.send(JSONObject().put("type", "position").put("id", id).put("point", point(it, System.currentTimeMillis())))
            } ?: error(id, 2)
            render()
            return
        }
        if (!activity.locationReady(false, false) { notice(it) }) { error(id, 1); return }
        try {
            val fine = activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val providers = locations.getProviders(true).filter { it == LocationManager.NETWORK_PROVIDER || fine && it == LocationManager.GPS_PROVIDER }
            if (providers.isEmpty()) { error(id, 2); return }
            locateId = id
            PersonalData.allowGps()
            providers.forEach { locations.requestLocationUpdates(it, 0L, 0f, oneShot, Looper.getMainLooper()) }
            handler.postDelayed({ if (locateId == id) { cancelLocate(); error(id, 3) } }, 30000)
            render()
        } catch (_: SecurityException) { cancelLocate(); error(id, 1) }
        catch (_: RuntimeException) { cancelLocate(); error(id, 2) }
    }
    private fun cancelLocate() { locateId = null; handler.removeCallbacksAndMessages(null); runCatching { locations.removeUpdates(oneShot) } }

    fun result(request: Int, result: Int, data: Intent?) {
        if (request !in listOf(901, 902)) return
        val content = if (request == 901) pendingExport else null
        val version = generation
        export = null; pendingExport = null; saving = false
        val uri = data?.data
        if (result != Activity.RESULT_OK || uri == null) { notice("Operación de archivo cancelada."); return }
        worker.execute {
            val outcome = runCatching {
                if (request == 901) {
                    val bytes = requireNotNull(content).toByteArray(Charsets.UTF_8)
                    require(bytes.size <= 4 * 1024 * 1024)
                    requireNotNull(activity.contentResolver.openOutputStream(uri)).use { it.write(bytes) }
                    null
                } else requireNotNull(activity.contentResolver.openInputStream(uri)).use { stream ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= 4 * 1024 * 1024)
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray().toString(Charsets.UTF_8)
                }
            }
            activity.runOnUiThread {
                if (activity.isDestroyed) return@runOnUiThread
                if (request == 902 && (generation != version || !resumed || !visible)) {
                    notice("La sesión cambió. Vuelve a seleccionar el archivo si quieres importarlo.")
                    return@runOnUiThread
                }
                outcome.onSuccess { text ->
                    if (text == null) notice("Recorrido exportado. El archivo contiene datos de ubicación; mantenlo privado.")
                    else {
                        map.send(JSONObject().put("type", "importBegin"))
                        text.chunked(8000).forEach { map.send(JSONObject().put("type", "importPart").put("text", it)) }
                        map.send(JSONObject().put("type", "importFinish"))
                    }
                }.onFailure { notice("No se pudo procesar el archivo (máximo 4 MB). La sesión se conserva.") }
            }
        }
    }
}
