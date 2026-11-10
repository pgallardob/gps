package io.github.pgallardob.punto

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

data class Snapshot(val active: Boolean, val text: String, val id: String? = null, val requiresNewInvitation: Boolean = false)

object SessionStatus {
    @Volatile var current = Snapshot(false, "Sin compartir ubicación.")
        private set
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    fun update(snapshot: Snapshot) {
        current = snapshot
        Handler(Looper.getMainLooper()).post { listeners.forEach { it() } }
    }
    fun observe(listener: () -> Unit) { listeners.add(listener); listener() }
    fun remove(listener: () -> Unit) { listeners.remove(listener) }
}

fun failureMessage(failure: ShareFailure): String {
    val reason = when (failure.code) {
        "invalid_invitation" -> "El enlace privado no es válido. Usa la invitación original."
        "permission" -> "Falta permiso de ubicación o notificaciones."
        "gps_unavailable" -> "No se obtuvo una ubicación reciente. Revisa el GPS y vuelve a intentarlo."
        "network_timeout" -> "El servicio no respondió a tiempo."
        "network_error" -> "No se pudo conectar con el servicio."
        "viewer_offline" -> "El mapa del propietario debe estar visible y conectado. Solicita una invitación nueva."
        "expired", "closed", "not_found", "invitation_used", "disconnected" -> "La sesión terminó. Solicita una invitación nueva."
        "unauthorized" -> "El servicio no autorizó esta invitación."
        else -> "No se pudo completar la solicitud. Solicita una invitación nueva."
    }
    val step = when (failure.step) {
        Step.PREVIEW -> "verificar invitación"
        Step.LOCATION -> "obtener ubicación"
        Step.ACCEPT -> "aceptar invitación"
        Step.PUBLISH -> "enviar posición"
        Step.STOP -> "detener sesión"
    }
    return "$reason Etapa: $step."
}
