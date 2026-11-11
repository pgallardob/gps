package io.github.pgallardob.punto

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings

fun Activity.locationReady(ongoing: Boolean, precise: Boolean, report: (String) -> Unit): Boolean {
    val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val notify = !ongoing || Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    if ((!fine && !coarse) || precise && !fine || !notify) {
        val permissions = mutableListOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
        if (ongoing && Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        requestPermissions(permissions.toTypedArray(), 42)
        report(if (precise) "Permite ubicación precisa y notificaciones; después vuelve a pulsar Iniciar recorrido."
            else "Concede los permisos solicitados y vuelve a pulsar el botón. No se inicia GPS automáticamente.")
        return false
    }
    if (ongoing && getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() != true) {
        report("Activa las notificaciones de Punto para disponer del botón Detener.")
        startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        return false
    }
    return true
}
