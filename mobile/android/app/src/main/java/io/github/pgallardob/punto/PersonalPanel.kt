package io.github.pgallardob.punto

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.Button
import android.widget.CheckBox
import android.widget.TextView
import android.webkit.WebView
import java.util.Locale
import java.util.concurrent.Executors

class PersonalPanel(private val activity: Activity) {
    private val map = NativeMap(activity.findViewById<WebView>(R.id.map))
    private val status = activity.findViewById<TextView>(R.id.personal_status)
    private val stats = activity.findViewById<TextView>(R.id.personal_stats)
    private val handler = Handler(Looper.getMainLooper())
    private val locations = requireNotNull(activity.getSystemService(LocationManager::class.java))
    private var resumed = false
    private var visible = true
    private var locating = false
    private var export: String? = null
    private var lastSession: Snapshot? = null
    private val exportWorker = Executors.newSingleThreadExecutor()
    private val refreshHandler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() { if (resumed) { render(); refreshHandler.postDelayed(this, 10000) } }
    }
    private val observer: () -> Unit = { render() }
    private val oneShot = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            if (!locating || !resumed) return
            val fix = Fix(location.latitude, location.longitude, location.accuracy.toDouble(), location.elapsedRealtimeNanos / 1000000)
            try { fix.validate(SystemClock.elapsedRealtime()) } catch (_: ShareFailure) { return }
            cancelLocate()
            PersonalData.accept(fix)
            status.text = "Ubicación actualizada. Inicia un recorrido solo si quieres registrarlo."
            map.render(center = true)
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Compatibility with older providers")
        override fun onStatusChanged(provider: String?, state: Int, extras: Bundle?) {}
    }

    init {
        map.initialize()
        val pause = activity.findViewById<CheckBox>(R.id.map_pause)
        pause.isChecked = !PersonalData.mapTilesEnabled
        pause.isEnabled = !BuildConfig.SIMULATION
        pause.setOnCheckedChangeListener { _, checked -> PersonalData.mapTilesEnabled = !checked; map.allowTiles(!checked) }
        map.allowTiles(!pause.isChecked)
        activity.findViewById<Button>(R.id.personal_locate).setOnClickListener { locate() }
        activity.findViewById<Button>(R.id.personal_start).setOnClickListener {
            if (resumed && !SessionStatus.current.active && activity.locationReady(true, true) { status.text = it }) {
                cancelLocate()
                runCatching { activity.startForegroundService(Intent(activity, SharingService::class.java).setAction(SharingService.START_PERSONAL)) }
                    .onFailure { status.text = "No se pudo iniciar el recorrido. Mantén Punto visible y revisa los permisos." }
            }
        }
        activity.findViewById<Button>(R.id.personal_stop).setOnClickListener {
            activity.startService(Intent(activity, SharingService::class.java).setAction(SharingService.STOP))
        }
        activity.findViewById<Button>(R.id.personal_export).setOnClickListener { exportRoute() }
        activity.findViewById<Button>(R.id.personal_clear).setOnClickListener {
            AlertDialog.Builder(activity).setTitle("Borrar recorrido")
                .setMessage("Se borrará el recorrido en memoria. Exporta primero si quieres conservarlo.")
                .setNegativeButton("Cancelar", null).setPositiveButton("Borrar") { _, _ ->
                    if (!SessionStatus.current.active) { PersonalData.route.clear(); PersonalData.changed() }
                }.show()
        }
    }

    fun start() { PersonalData.observe(observer); SessionStatus.observe(observer) }
    fun resume() { resumed = true; map.setActive(visible); refreshHandler.post(refresh); render() }
    fun pause() { resumed = false; refreshHandler.removeCallbacksAndMessages(null); cancelLocate(); map.setActive(false) }
    fun setVisible(value: Boolean) { visible = value; if (!visible) cancelLocate(); map.setActive(resumed && visible) }
    fun stop() { PersonalData.remove(observer); SessionStatus.remove(observer) }
    fun destroy() { refreshHandler.removeCallbacksAndMessages(null); cancelLocate(); exportWorker.shutdown(); map.destroy() }

    fun render() {
        val snapshot = PersonalData.route.snapshot()
        val session = SessionStatus.current
        val accuracy = PersonalData.current?.accuracy?.let { " · precisión ±${it.toInt()} m" }.orEmpty()
        val old = PersonalData.current?.let { SystemClock.elapsedRealtime() - it.elapsedMillis !in 0L..20000L } == true
        stats.text = String.format(Locale.getDefault(), "%d puntos · %.2f km", snapshot.count, snapshot.distanceMeters / 1000) + accuracy + if (old) " · ubicación anterior" else ""
        if (session !== lastSession) {
            if (session.mode == SessionMode.PERSONAL) status.text = session.text
            else if (session.active) status.text = "Compartiendo por invitación. El recorrido personal está detenido."
            lastSession = session
        }
        activity.findViewById<Button>(R.id.personal_start).isEnabled = resumed && !locating && !session.active && snapshot.count < 10000
        activity.findViewById<Button>(R.id.personal_stop).isEnabled = session.active && session.mode == SessionMode.PERSONAL
        activity.findViewById<Button>(R.id.personal_locate).isEnabled = resumed && !locating
        activity.findViewById<Button>(R.id.personal_export).isEnabled = snapshot.count > 0
        activity.findViewById<Button>(R.id.personal_clear).isEnabled = snapshot.count > 0 && !session.active
        map.render()
    }

    private fun locate() {
        if (!resumed || !visible) return
        if (SessionStatus.current.active) { map.render(center = true); status.text = "La sesión activa actualiza tu ubicación en el mapa."; return }
        if (!activity.locationReady(false, false) { status.text = it }) return
        try {
            val fine = activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val providers = locations.getProviders(true).filter { it == LocationManager.NETWORK_PROVIDER || fine && it == LocationManager.GPS_PROVIDER }
            if (providers.isEmpty()) { status.text = "Activa la ubicación del teléfono y vuelve a intentarlo."; return }
            locating = true
            status.text = "Obteniendo ubicación del teléfono. No se envía al servicio de compartir."
            providers.forEach { locations.requestLocationUpdates(it, 0L, 0f, oneShot, Looper.getMainLooper()) }
            handler.postDelayed({ if (locating) { cancelLocate(); status.text = "El GPS tardó demasiado. Revisa la ubicación y vuelve a intentarlo." } }, 30000)
            render()
        } catch (_: SecurityException) { cancelLocate(); status.text = "Permite la ubicación en los ajustes de Punto." }
        catch (_: RuntimeException) { cancelLocate(); status.text = "No se pudo obtener la ubicación. Vuelve a intentarlo." }
    }

    private fun cancelLocate() {
        locating = false
        handler.removeCallbacksAndMessages(null)
        runCatching { locations.removeUpdates(oneShot) }
        if (resumed) render()
    }

    private fun exportRoute() {
        if (PersonalData.route.snapshot().count == 0) return
        export = PersonalData.route.geoJson(BuildConfig.SIMULATION)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/geo+json").putExtra(Intent.EXTRA_TITLE, "punto-recorrido.geojson")
        activity.startActivityForResult(intent, 901)
    }
    fun result(request: Int, result: Int, data: Intent?) {
        if (request != 901) return
        val content = export
        export = null
        if (result != Activity.RESULT_OK || data?.data == null || content == null) { status.text = "Exportación cancelada."; return }
        val target = requireNotNull(data.data)
        exportWorker.execute {
            val saved = runCatching {
                requireNotNull(activity.contentResolver.openOutputStream(target)).use { it.write(content.toByteArray(Charsets.UTF_8)) }
            }.isSuccess
            activity.runOnUiThread {
                if (!activity.isDestroyed) status.text = if (saved) "Recorrido exportado. El archivo contiene datos de ubicación; mantenlo privado."
                    else "No se pudo guardar el recorrido. Los datos siguen en memoria."
            }
        }
    }
}
