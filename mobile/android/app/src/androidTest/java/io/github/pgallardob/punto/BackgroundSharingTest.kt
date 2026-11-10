package io.github.pgallardob.punto

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.location.Criteria
import android.location.Location
import android.location.LocationManager
import android.os.SystemClock
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL

@RunWith(AndroidJUnit4::class)
class BackgroundSharingTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val id = "r".repeat(22)
    private val invite = "t".repeat(43)
    private val viewer = "v".repeat(43)

    private fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes() }
    }
    private fun request(path: String, method: String = "GET", token: String? = null): JSONObject {
        val connection = URL("${BuildConfig.RELAY_BASE_URL}/$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 3000
            connection.readTimeout = 3000
            connection.setRequestProperty("Origin", RelayApi.ORIGIN)
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            assertEquals(200, connection.responseCode)
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    private fun await(message: String, timeout: Long = 15000, diagnostic: () -> String = { SessionStatus.current.text }, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeout
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition()) return
            Thread.sleep(100)
        }
        fail("$message. Status: ${diagnostic()}")
    }

    @Suppress("DEPRECATION")
    @Test fun foregroundLocationSurvivesScreenOffAndNotificationStopRevokesIt() {
        assertTrue("Never run this synthetic test against production", BuildConfig.SIMULATION)
        request("__reset", "POST")
        shell("input keyevent KEYCODE_WAKEUP")
        shell("wm dismiss-keyguard")
        shell("cmd location set-location-enabled true")
        for (permission in listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)) {
            shell("pm grant ${context.packageName} $permission")
        }
        shell("appops set ${context.packageName} android:mock_location allow")
        val locations = context.getSystemService(LocationManager::class.java)!!
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        for (provider in providers) {
            runCatching { locations.removeTestProvider(provider) }
            locations.addTestProvider(provider, false, false, false, false, true, true, true, Criteria.POWER_LOW, Criteria.ACCURACY_FINE)
            locations.setTestProviderEnabled(provider, true)
        }
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity {
                    it.findViewById<EditText>(R.id.invitation).setText("https://pgallardob.github.io/gps/share.html#invite=$id.$invite")
                    assertFalse(it.findViewById<Button>(R.id.start).isEnabled)
                    it.findViewById<Button>(R.id.verify).performClick()
                }
                var previewStatus = ""
                await("Invitation did not become ready", diagnostic = { previewStatus }) {
                    var enabled = false
                    scenario.onActivity {
                        it.findViewById<CheckBox>(R.id.consent).isChecked = true
                        enabled = it.findViewById<Button>(R.id.start).isEnabled
                        previewStatus = it.findViewById<TextView>(R.id.status).text.toString()
                    }
                    enabled
                }
                scenario.onActivity { it.findViewById<Button>(R.id.start).performClick() }
                await("Location listeners did not become ready") { SessionStatus.current.text.startsWith("Obteniendo ubicación.") }
                fun position(value: Double) {
                    providers.forEach { provider ->
                        val fix = Location(provider).apply {
                            latitude = value; longitude = 0.0; accuracy = 10f
                            time = System.currentTimeMillis(); elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
                        }
                        locations.setTestProviderLocation(provider, fix)
                    }
                }
                position(0.0)
                await("No initial synthetic publication") { request("v1/sessions/$id", token = viewer).optString("state") == "active" }
                shell("input keyevent KEYCODE_HOME")
                shell("input keyevent KEYCODE_SLEEP")
                await("The emulator screen must really be off") { !context.getSystemService(PowerManager::class.java)!!.isInteractive }
                repeat(6) { index -> position((index + 1) / 10000.0); Thread.sleep(5000) }
                assertFalse(context.getSystemService(PowerManager::class.java)!!.isInteractive)
                val point = request("v1/sessions/$id", token = viewer).getJSONObject("point")
                assertTrue("Fresh positions must arrive while the activity and screen are hidden", point.getDouble("latitude") > 0.0)
                val notification = context.getSystemService(NotificationManager::class.java)!!.activeNotifications
                    .first { it.id == SharingService.NOTIFICATION_ID }.notification
                notification.actions.first { it.title.toString() == "Detener" }.actionIntent.send()
                await("Stop action did not revoke") { request("v1/sessions/$id", token = viewer).optString("state") == "stopped" }
                assertTrue(request("v1/sessions/$id", token = viewer).isNull("point"))
                await("Foreground session did not stop") { !SessionStatus.current.active }
                position(0.01)
                Thread.sleep(11000)
                assertTrue(request("v1/sessions/$id", token = viewer).isNull("point"))
            }
        } finally {
            shell("input keyevent KEYCODE_WAKEUP")
            context.stopService(android.content.Intent(context, SharingService::class.java))
            providers.forEach { runCatching { locations.removeTestProvider(it) } }
        }
    }
}
