package io.github.pgallardob.punto

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var link: EditText
    private lateinit var consent: CheckBox
    private lateinit var start: Button
    private lateinit var verify: Button
    private lateinit var status: TextView
    private var invitation: Invitation? = null
    private var deadline = 0L
    private var generation = 0
    private var busy = false
    private var resumed = false
    private val worker = Executors.newSingleThreadExecutor()
    private val observer: () -> Unit = { renderSession() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setContentView(R.layout.activity_main)
        link = findViewById(R.id.invitation)
        consent = findViewById(R.id.consent)
        start = findViewById(R.id.start)
        verify = findViewById(R.id.verify)
        status = findViewById(R.id.status)
        link.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, begin: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, begin: Int, before: Int, count: Int) {
                generation++
                invitation = null
                consent.isChecked = false
                renderButtons()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        verify.setOnClickListener { verifyInvitation() }
        consent.setOnCheckedChangeListener { _, _ -> renderButtons() }
        start.setOnClickListener { startSharing() }
        findViewById<Button>(R.id.stop).setOnClickListener {
            startService(Intent(this, SharingService::class.java).setAction(SharingService.STOP))
        }
        findViewById<Button>(R.id.battery).setOnClickListener {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
        receiveLink(intent)
    }

    override fun onStart() { super.onStart(); SessionStatus.observe(observer) }
    override fun onResume() { super.onResume(); resumed = true; renderButtons() }
    override fun onPause() { resumed = false; super.onPause() }
    override fun onStop() { SessionStatus.remove(observer); super.onStop() }
    override fun onDestroy() { generation++; worker.shutdownNow(); super.onDestroy() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); receiveLink(intent) }

    private fun receiveLink(source: Intent) {
        if (source.action == Intent.ACTION_SEND) {
            val text = source.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
            source.removeExtra(Intent.EXTRA_TEXT)
            if (SessionStatus.current.active) return
            val candidates = Regex("https://pgallardob\\.github\\.io/gps/share\\.html#invite=[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])")
                .findAll(text.take(4096)).map { it.value }.toList()
            link.setText(if (candidates.size == 1) candidates.single() else text.take(1024))
        }
    }

    private fun renderButtons() {
        val active = SessionStatus.current.active
        verify.isEnabled = !busy && !active
        link.isEnabled = !busy && !active
        consent.isEnabled = !active
        start.isEnabled = resumed && !busy && !active && consent.isChecked && invitation != null && SystemClock.elapsedRealtime() < deadline
        findViewById<Button>(R.id.stop).isEnabled = active
    }

    private fun renderSession() {
        val snapshot = SessionStatus.current
        val belongsToThisInvitation = snapshot.id != null && snapshot.id == invitation?.id
        if (snapshot.active || belongsToThisInvitation || invitation == null && !busy) status.text = snapshot.text
        if (snapshot.active) consent.isChecked = true
        if (snapshot.requiresNewInvitation && snapshot.id == invitation?.id) {
            invitation = null
            link.setText("")
            consent.isChecked = false
        }
        if (!snapshot.active && snapshot.requiresNewInvitation && invitation == null) consent.isChecked = false
        renderButtons()
    }

    private fun verifyInvitation() {
        val parsed = try { Invitation.parse(link.text.toString()) }
        catch (failure: ShareFailure) { status.text = failureMessage(failure); return }
        val version = generation
        busy = true
        status.text = "Verificando el enlace. El servicio gratuito puede tardar en iniciarse. Todavía no se solicita GPS."
        renderButtons()
        worker.execute {
            val result = runCatching { RelayApi().preview(parsed) }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                busy = false
                if (version != generation) { renderButtons(); return@runOnUiThread }
                result.onSuccess {
                    invitation = parsed
                    deadline = SystemClock.elapsedRealtime() + it.remainingSeconds * 1000L
                    status.text = "Invitación válida. Máximo ${(it.remainingSeconds + 59) / 60} minutos. Marca el consentimiento y acepta."
                }.onFailure {
                    status.text = failureMessage(it as? ShareFailure ?: ShareFailure("invalid_response", Step.PREVIEW))
                }
                renderButtons()
            }
        }
    }

    private fun startSharing() {
        val pending = invitation ?: return
        if (!resumed || !consent.isChecked || busy || SessionStatus.current.active || SystemClock.elapsedRealtime() >= deadline) return
        val locationGranted = listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
            .any { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        val notificationsGranted = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!locationGranted || !notificationsGranted) {
            val permissions = mutableListOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
            if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            requestPermissions(permissions.toTypedArray(), 42)
            status.text = "Concede ubicación y notificaciones; después vuelve a pulsar Aceptar y compartir."
            return
        }
        if (getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() != true) {
            status.text = "Activa las notificaciones de Punto para disponer del botón Detener."
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
            return
        }
        try {
            startForegroundService(Intent(this, SharingService::class.java).setAction(SharingService.START)
                .putExtra("id", pending.id).putExtra("capability", pending.token))
        } catch (_: RuntimeException) { status.text = "No se pudo iniciar la ubicación. Mantén la app visible y revisa los permisos." }
    }
}
