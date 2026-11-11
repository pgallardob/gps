package io.github.pgallardob.punto

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class SharingService : Service(), LocationListener {
    companion object {
        const val START = "io.github.pgallardob.punto.START"
        const val START_PERSONAL = "io.github.pgallardob.punto.START_PERSONAL"
        const val STOP = "io.github.pgallardob.punto.STOP"
        const val NOTIFICATION_ID = 1401
        private const val CHANNEL = "sharing-location"
    }
    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val gate = SafetyGate(SystemClock::elapsedRealtime)
    private val latest = AtomicReference<Fix?>()
    private val busy = AtomicBoolean(false)
    private val closing = AtomicBoolean(false)
    private var invitation: Invitation? = null
    private var mode = SessionMode.SHARED
    private var started = false
    private var renewWakeAt = 0L
    @Volatile private var publisher: String? = null
    private var finished = false
    @Volatile private var destroyed = false
    private var wakeLock: PowerManager.WakeLock? = null
    private val relay = lazy { RelayApi() }
    private val api get() = relay.value
    private val locations by lazy { requireNotNull(getSystemService(LocationManager::class.java)) }
    private val notifications by lazy { requireNotNull(getSystemService(NotificationManager::class.java)) }
    private val pulse = object : Runnable {
        override fun run() {
            if (gate.stopped) return
            if (mode == SessionMode.PERSONAL) {
                if (!notificationsAllowed()) { fail(ShareFailure("permission", Step.STOP)); return }
                if (SystemClock.elapsedRealtime() >= renewWakeAt) renewPersonalWakeLock()
                if (latest.get()?.let { SystemClock.elapsedRealtime() - it.elapsedMillis > 30000 } == true) {
                    PersonalData.route.gap()
                    update("Esperando una ubicación reciente. El recorrido local no se envía al servicio.")
                }
            } else if (publisher != null && busy.compareAndSet(false, true)) worker.execute { upload() }
            handler.postDelayed(this, 10000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { stopSharing(if (mode == SessionMode.PERSONAL) "Recorrido detenido." else "Ubicación detenida por el usuario.", true); return START_NOT_STICKY }
        if (intent?.action !in listOf(START, START_PERSONAL) || started) { if (!started) stopSelf(); return START_NOT_STICKY }
        val command = requireNotNull(intent)
        if (gate.stopped || closing.get()) { command.removeExtra("capability"); stopSelf(); return START_NOT_STICKY }
        mode = if (command.action == START_PERSONAL) SessionMode.PERSONAL else SessionMode.SHARED
        started = true
        val pending = if (mode == SessionMode.SHARED) {
            try { Invitation.parts(command.getStringExtra("id").orEmpty(), command.getStringExtra("capability").orEmpty()) }
            catch (_: ShareFailure) { stopSelf(); return START_NOT_STICKY }
        } else null
        command.removeExtra("capability")
        invitation = pending
        val locationAllowed = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val preciseAllowed = mode != SessionMode.PERSONAL || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val notificationAllowed = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!locationAllowed || !preciseAllowed || !notificationAllowed || !notifications.areNotificationsEnabled()) {
            invitation = null
            finished = true
            SessionStatus.update(Snapshot(false, "Permite ubicación y notificaciones antes de iniciar.", pending?.id, mode = mode))
            stopSelf()
            return START_NOT_STICKY
        }
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Ubicación activa", NotificationManager.IMPORTANCE_LOW))
        if (!notificationsAllowed()) {
            invitation = null
            finished = true
            SessionStatus.update(Snapshot(false, "Activa el canal de notificaciones de ubicación antes de iniciar.", pending?.id, mode = mode))
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            val notice = notification("Preparando ubicación. Puedes detenerla aquí.")
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else startForeground(NOTIFICATION_ID, notice)
        } catch (_: RuntimeException) { fail(ShareFailure("permission", Step.LOCATION)); return START_NOT_STICKY }
        if (mode == SessionMode.PERSONAL) {
            if (!PersonalData.route.begin()) { stopSharing("Se alcanzó el límite de 10.000 puntos. Exporta o borra el recorrido.", false); return START_NOT_STICKY }
            PersonalData.changed()
            beginLocations()
            return START_NOT_STICKY
        }
        val sharedInvitation = requireNotNull(pending)
        update("Verificando la invitación antes de solicitar ubicación.")
        worker.execute {
            try {
                gate.check()
                val preview = api.preview(sharedInvitation)
                gate.check()
                gate.limitTo(preview.remainingSeconds)
                handler.post { beginLocations() }
            } catch (failure: ShareFailure) { fail(failure) }
        }
        return START_NOT_STICKY
    }

    private fun notification(text: String): Notification {
        val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val stop = PendingIntent.getService(this, 1, Intent(this, SharingService::class.java).setAction(STOP), immutable)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), immutable)
        return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_location)
            .setContentTitle(if (mode == SessionMode.PERSONAL) "Punto: recorrido personal" else "Punto: ubicación compartida").setContentText(text).setContentIntent(open)
            .setOngoing(true).setCategory(Notification.CATEGORY_SERVICE)
            .addAction(Notification.Action.Builder(null, "Detener", stop).build()).build()
    }

    private fun notificationsAllowed(): Boolean {
        val channel = notifications.getNotificationChannel(CHANNEL) ?: return false
        return notifications.areNotificationsEnabled() && channel.importance != NotificationManager.IMPORTANCE_NONE &&
            (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    }

    private fun update(text: String) {
        if (closing.get() || destroyed) return
        SessionStatus.update(Snapshot(true, text, invitation?.id, mode = mode))
        notifications.notify(NOTIFICATION_ID, notification(text))
    }

    private fun beginLocations() {
        if (gate.stopped) return
        try {
            gate.check()
            PersonalData.allowGps()
            val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (!fine && !coarse) throw ShareFailure("permission", Step.LOCATION)
            val providers = locations.getProviders(true).filter {
                it == LocationManager.NETWORK_PROVIDER || fine && it == LocationManager.GPS_PROVIDER
            }
            if (providers.isEmpty()) throw ShareFailure("gps_unavailable", Step.LOCATION)
            wakeLock = requireNotNull(getSystemService(PowerManager::class.java)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Punto:Sharing").apply {
                setReferenceCounted(false)
                acquire(if (mode == SessionMode.PERSONAL) 1800000L else (gate.remainingMillis() + 30000).coerceAtMost(3630000))
            }
            renewWakeAt = SystemClock.elapsedRealtime() + 600000
            providers.forEach { locations.requestLocationUpdates(it, 5000L, 0f, this, Looper.getMainLooper()) }
            update("Obteniendo ubicación. Puedes apagar la pantalla; usa Detener en la notificación.")
            handler.postDelayed({ if (latest.get() == null) fail(ShareFailure("gps_unavailable", Step.LOCATION)) }, 30000)
            if (mode == SessionMode.SHARED) handler.postDelayed({ stopSharing("La autorización de compartir terminó.", true) }, gate.remainingMillis())
            handler.postDelayed(pulse, 10000)
        } catch (failure: ShareFailure) { fail(failure) }
        catch (_: SecurityException) { fail(ShareFailure("permission", Step.LOCATION)) }
        catch (_: RuntimeException) { fail(ShareFailure("gps_unavailable", Step.LOCATION)) }
    }

    override fun onLocationChanged(location: Location) {
        if (gate.stopped) return
        val fix = Fix(location.latitude, location.longitude, location.accuracy.toDouble(), location.elapsedRealtimeNanos / 1000000,
            location.speed.toDouble().takeIf { location.hasSpeed() && it.isFinite() && it in 0.0..1000.0 })
        try { fix.validate(SystemClock.elapsedRealtime()) } catch (_: ShareFailure) { return }
        latest.set(fix)
        PersonalData.accept(fix, record = mode == SessionMode.PERSONAL)
        if (mode == SessionMode.PERSONAL) {
            if (PersonalData.route.snapshot().count >= 10000) stopSharing("Se alcanzó el límite de 10.000 puntos.", false)
            else update(if (fix.accuracy <= 100) "Grabando recorrido personal. No se envía al servicio." else "Precisión baja: esperando un punto de menos de 100 m para registrar.")
            return
        }
        if (publisher == null && !gate.acceptanceAttempted && busy.compareAndSet(false, true)) worker.execute {
            val pending = invitation ?: return@execute
            try {
                gate.check()
                gate.acceptanceAttempted = true
                val acceptance = api.accept(pending)
                publisher = acceptance.token
                gate.limitTo(acceptance.remainingSeconds)
                gate.check()
                upload()
            } catch (failure: ShareFailure) { busy.set(false); fail(failure) }
        }
    }

    private fun upload() {
        if (mode != SessionMode.SHARED) return
        try {
            gate.check()
            if (!notificationsAllowed()) throw ShareFailure("permission", Step.STOP)
            val pending = invitation ?: throw ShareFailure("stopped", Step.STOP)
            val capability = publisher ?: throw ShareFailure("closed", Step.PUBLISH)
            val point = latest.get() ?: throw ShareFailure("gps_unavailable", Step.LOCATION)
            point.validate(SystemClock.elapsedRealtime())
            api.publish(pending, capability, point)
            gate.check()
            handler.post { update("Compartiendo ubicación. Detén la sesión desde la notificación cuando quieras.") }
        } catch (failure: ShareFailure) { fail(failure) }
        finally { busy.set(false) }
    }

    private fun fail(failure: ShareFailure) {
        gate.stop()
        if (!destroyed) handler.post { if (!destroyed) stopSharing(failureMessage(failure), gate.acceptanceAttempted) }
    }

    private fun stopLocal() {
        gate.stop()
        handler.removeCallbacksAndMessages(null)
        runCatching { locations.removeUpdates(this) }
        latest.set(null)
        wakeLock?.let { runCatching { if (it.isHeld) it.release() } }
        wakeLock = null
        if (mode == SessionMode.PERSONAL) { PersonalData.route.stop(); PersonalData.changed() }
        if (relay.isInitialized()) relay.value.cancelInFlight()
    }

    private fun stopSharing(message: String, revoke: Boolean) {
        if (destroyed) return
        if (!closing.compareAndSet(false, true)) return
        stopLocal()
        val pending = invitation
        val remoteRevoke = revoke && mode == SessionMode.SHARED
        SessionStatus.update(Snapshot(true, "$message Cerrando la sesión.", pending?.id, remoteRevoke, mode))
        worker.execute {
            var confirmed = !remoteRevoke
            if (pending != null && remoteRevoke) {
                try { api.revoke(pending, publisher ?: pending.token); confirmed = true } catch (_: ShareFailure) {}
            }
            publisher = null
            invitation = null
            handler.post {
                if (destroyed) return@post
                val ending = if (mode == SessionMode.PERSONAL) "$message El recorrido queda en memoria; expórtalo antes de cerrar la app."
                    else if (!remoteRevoke) "$message Puedes volver a verificar el enlace si sigue vigente."
                    else if (confirmed) "$message El servicio confirmó la revocación."
                    else "$message No se confirmó la revocación; el servicio vence por inactividad."
                finished = true
                SessionStatus.update(Snapshot(false, ending, pending?.id, remoteRevoke, mode))
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    override fun onProviderDisabled(provider: String) {
        if (locations.getProviders(true).none { it == LocationManager.GPS_PROVIDER || it == LocationManager.NETWORK_PROVIDER }) {
            fail(ShareFailure("gps_unavailable", Step.LOCATION))
        }
    }
    override fun onProviderEnabled(provider: String) {}
    private fun renewPersonalWakeLock() {
        if (mode != SessionMode.PERSONAL || gate.stopped) return
        try {
            wakeLock?.acquire(1800000L)
            renewWakeAt = SystemClock.elapsedRealtime() + 600000
        } catch (_: RuntimeException) { fail(ShareFailure("permission", Step.LOCATION)) }
    }
    @Deprecated("Required by older Android location providers")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onDestroy() {
        destroyed = true
        stopLocal()
        val pending = invitation
        if (!finished && mode == SessionMode.PERSONAL) {
            SessionStatus.update(Snapshot(false, "El sistema detuvo el recorrido. Exporta los datos en memoria antes de cerrar.", mode = mode))
        } else if (!finished && pending != null && !worker.isShutdown) {
            worker.execute { try { api.revoke(pending, publisher ?: pending.token) } catch (_: ShareFailure) {} }
            SessionStatus.update(Snapshot(false, "El sistema detuvo la sesión. Solicita una invitación nueva.", pending.id, true))
        }
        worker.shutdown()
        super.onDestroy()
    }
}
