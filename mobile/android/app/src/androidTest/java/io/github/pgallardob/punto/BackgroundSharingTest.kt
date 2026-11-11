package io.github.pgallardob.punto

import android.Manifest
import android.app.Activity
import android.app.Instrumentation
import android.app.NotificationManager
import android.content.Intent
import android.content.IntentFilter
import android.location.Criteria
import android.location.Location
import android.location.LocationManager
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.os.SystemClock
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.lifecycle.Lifecycle
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class BackgroundSharingTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val locations get() = context.getSystemService(LocationManager::class.java)!!
    private val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
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
    @Before fun setup() {
        assertTrue("Never run synthetic tests against production", BuildConfig.SIMULATION)
        shell("input keyevent KEYCODE_WAKEUP")
        shell("wm dismiss-keyguard")
        shell("cmd location set-location-enabled true")
        for (permission in listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)) {
            shell("pm grant ${context.packageName} $permission")
        }
        shell("appops set ${context.packageName} android:mock_location allow")
        providers.forEach { provider ->
            runCatching { locations.removeTestProvider(provider) }
            locations.addTestProvider(provider, false, false, false, false, true, true, true, Criteria.POWER_LOW, Criteria.ACCURACY_FINE)
            locations.setTestProviderEnabled(provider, true)
        }
        PersonalData.route.stop()
        PersonalData.route.clear()
    }
    @After fun cleanup() {
        shell("input keyevent KEYCODE_WAKEUP")
        context.stopService(android.content.Intent(context, SharingService::class.java))
        providers.forEach { runCatching { locations.removeTestProvider(it) } }
    }
    private fun position(value: Double) {
        providers.forEach { provider ->
            locations.setTestProviderLocation(provider, Location(provider).apply {
                latitude = value; longitude = 0.0; accuracy = 10f
                time = System.currentTimeMillis(); elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
            })
        }
    }
    private fun screenOff() {
        shell("input keyevent KEYCODE_HOME")
        shell("input keyevent KEYCODE_SLEEP")
        await("Screen must really be off") { !context.getSystemService(PowerManager::class.java)!!.isInteractive }
    }
    private fun notificationStop() {
        context.getSystemService(NotificationManager::class.java)!!.activeNotifications
            .first { it.id == SharingService.NOTIFICATION_ID }.notification.actions
            .first { it.title.toString() == "Detener" }.actionIntent.send()
        await("Foreground session did not stop") { !SessionStatus.current.active }
    }
    private fun javascript(scenario: ActivityScenario<MainActivity>, script: String): String {
        val latch = CountDownLatch(1)
        val value = AtomicReference("")
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.map).evaluateJavascript(script) { value.set(it); latch.countDown() }
        }
        assertTrue("Map readiness callback timed out", latch.await(3, TimeUnit.SECONDS))
        return value.get()
    }
    private fun mapHasRoute(scenario: ActivityScenario<MainActivity>) = javascript(scenario,
        "Boolean(window.PuntoNative && Number(document.getElementById('point-count').textContent) >= 2 && document.querySelector('#map .leaflet-interactive'))") == "true"

    private fun documentMonitor(action: String, mime: String): Instrumentation.ActivityMonitor {
        val filter = IntentFilter(action).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            addDataType(mime)
        }
        val expected = Intent(action).addCategory(Intent.CATEGORY_OPENABLE).setType(mime)
        assertTrue("The monitor must match the document intent including its MIME type and category",
            filter.match(context.contentResolver, expected, true, "PuntoTest") >= 0)
        return instrumentation.addMonitor(filter, Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null), true)
    }

    @Test fun a_personalMapTracksWithoutInvitationWithScreenOffAndNoRelayRequests() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity {
                assertEquals(View.VISIBLE, it.findViewById<View>(R.id.personal_panel).visibility)
                assertEquals(View.GONE, it.findViewById<View>(R.id.sharing_panel).visibility)
                assertEquals(0, it.findViewById<EditText>(R.id.invitation).text.length)
                assertFalse(SessionStatus.current.active)
            }
            await("Full packaged dashboard not ready") { javascript(scenario, "Boolean(window.PuntoNative && window.PuntoNative.ready && document.getElementById('waypoint-list') && document.getElementById('import-btn'))") == "true" }
            assertEquals("true", javascript(scenario, "document.documentElement.scrollWidth <= window.innerWidth"))
            javascript(scenario, "document.getElementById('locate-btn').click()")
            assertEquals("true", javascript(scenario, "document.getElementById('start-btn').disabled"))
            position(0.0)
            await("One-shot location did not reach the map") { PersonalData.current != null }
            assertFalse(SessionStatus.current.active)
            assertEquals(0, PersonalData.route.snapshot().count)
            await("One-shot controls did not recover") { javascript(scenario, "!document.getElementById('start-btn').disabled") == "true" }
            javascript(scenario, "document.getElementById('start-btn').click()")
            await("Personal location did not start") { SessionStatus.current.mode == SessionMode.PERSONAL && SessionStatus.current.active && PersonalData.route.snapshot().recording }
            position(0.0)
            await("No first local point") { PersonalData.route.snapshot().count >= 1 }
            Thread.sleep(5500)
            position(0.0001)
            await("No second local point") { PersonalData.route.snapshot().count >= 2 }
            await("Packaged map did not render native data") { mapHasRoute(scenario) }
            val before = PersonalData.route.snapshot().count
            screenOff()
            repeat(4) { index -> position((index + 2) / 10000.0); Thread.sleep(5000) }
            assertFalse(context.getSystemService(PowerManager::class.java)!!.isInteractive)
            assertTrue(PersonalData.route.snapshot().count > before)
            notificationStop()
            val stopped = PersonalData.route.snapshot().count
            assertFalse(PersonalData.route.snapshot().recording)
            position(0.01)
            Thread.sleep(11000)
            assertEquals(stopped, PersonalData.route.snapshot().count)
            assertEquals("FeatureCollection", JSONObject(PersonalData.route.geoJson(true)).getString("type"))
            shell("input keyevent KEYCODE_WAKEUP")
            shell("wm dismiss-keyguard")
            // Reopen the existing singleTask activity as a user would; lifecycle requests do not foreground a task.
            shell("am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${context.packageName}/io.github.pgallardob.punto.MainActivity")
            await("The launcher did not bring Punto back to the foreground") { scenario.state == Lifecycle.State.RESUMED }
            await("Screen-off points did not return to the full dashboard") {
                javascript(scenario, "Number(document.getElementById('point-count').textContent) === $stopped") == "true"
            }
            assertEquals("true", javascript(scenario, "!document.getElementById('start-btn').disabled"))
        }
        // Harness-only marker: host verification rejects any relay API request before this point.
        request("__personal_done", "POST")
    }

    @Test fun b_invitationSharingStillWorksWithScreenOffAndNotificationStop() {
        request("__reset", "POST")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity {
                it.findViewById<Button>(R.id.sharing_tab).performClick()
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
            await("Shared location did not start") { SessionStatus.current.mode == SessionMode.SHARED && SessionStatus.current.text.startsWith("Obteniendo ubicación.") }
            position(0.0)
            await("No initial publication") { request("v1/sessions/$id", token = viewer).optString("state") == "active" }
            screenOff()
            repeat(6) { index -> position((index + 1) / 10000.0); Thread.sleep(5000) }
            assertTrue(request("v1/sessions/$id", token = viewer).getJSONObject("point").getDouble("latitude") > 0.0)
            notificationStop()
            await("Stop did not revoke") { request("v1/sessions/$id", token = viewer).optString("state") == "stopped" }
            assertTrue(request("v1/sessions/$id", token = viewer).isNull("point"))
            assertEquals(0, PersonalData.route.snapshot().count)
            position(0.01)
            Thread.sleep(11000)
            assertTrue(request("v1/sessions/$id", token = viewer).isNull("point"))
        }
    }

    @Test fun c_dashboardToolsKeepTheirStyleAndDoNotStartGpsInDemo() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            await("Dashboard tools not ready") { javascript(scenario, "Boolean(window.PuntoNative && window.PuntoNative.ready && document.getElementById('demo-btn'))") == "true" }
            assertEquals("true", javascript(scenario, "getComputedStyle(document.body).backgroundColor === 'rgb(245, 248, 247)'"))
            javascript(scenario, "document.getElementById('demo-btn').click(); document.getElementById('stop-btn').click()")
            assertFalse(SessionStatus.current.active)
            assertEquals("true", javascript(scenario, "Number(document.getElementById('point-count').textContent) > 0 && !document.getElementById('demo-banner').hidden"))
            javascript(scenario, "document.getElementById('waypoint-name').value = 'Synthetic favorite'; document.getElementById('save-waypoint-btn').click()")
            assertEquals("1", javascript(scenario, "document.getElementById('waypoint-list').children.length"))
            javascript(scenario, "document.getElementById('copy-btn').click()")
            await("Native clipboard acknowledgement did not reach the dashboard") { javascript(scenario, "document.getElementById('action-feedback').textContent.includes('SIMULADAS copiadas')") == "true" }
            val exportMonitor = documentMonitor(Intent.ACTION_CREATE_DOCUMENT, "application/gpx+xml")
            try {
                javascript(scenario, "document.getElementById('export-format').value = 'gpx'; document.getElementById('export-btn').click()")
                await("GPX export did not reach the Android document picker") { exportMonitor.hits > 0 }
                await("Export cancellation was not reported") { javascript(scenario, "document.getElementById('action-feedback').textContent.includes('cancelada')") == "true" }
            } finally { instrumentation.removeMonitor(exportMonitor) }
            val importMonitor = documentMonitor(Intent.ACTION_OPEN_DOCUMENT, "*/*")
            try {
                javascript(scenario, "document.getElementById('import-btn').click()")
                await("Import did not reach the Android document picker") { importMonitor.hits > 0 }
                assertEquals("1", javascript(scenario, "document.getElementById('waypoint-list').children.length"))
            } finally { instrumentation.removeMonitor(importMonitor) }
            val confirmationFinished = CountDownLatch(1)
            scenario.onActivity { activity ->
                // confirm() suspends JavaScript; click the native dialog before waiting for evaluation to finish.
                activity.findViewById<WebView>(R.id.map).evaluateJavascript("document.getElementById('forget-btn').click()") { confirmationFinished.countDown() }
            }
            await("Native confirmation dialog not reachable") {
                instrumentation.uiAutomation.rootInActiveWindow?.findAccessibilityNodeInfosByText("Continuar")
                    ?.firstOrNull()?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            }
            assertTrue("JavaScript did not resume after the native confirmation", confirmationFinished.await(5, TimeUnit.SECONDS))
            await("Forget did not clear the dashboard") { PersonalData.current == null && javascript(scenario, "Number(document.getElementById('point-count').textContent) === 0 && document.getElementById('waypoint-list').children.length === 0") == "true" }
            assertFalse(SessionStatus.current.active)
            assertNull(PersonalData.current)
        }
    }
}
