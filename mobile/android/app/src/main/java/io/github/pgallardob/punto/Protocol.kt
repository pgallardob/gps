package io.github.pgallardob.punto

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

enum class Step { PREVIEW, LOCATION, ACCEPT, PUBLISH, STOP }
class ShareFailure(val code: String, val step: Step) : Exception(code)

@ConsistentCopyVisibility
data class Invitation private constructor(val id: String, val token: String) {
    override fun toString() = "Invitation([redacted])"
    companion object {
        private val idPattern = Regex("[A-Za-z0-9_-]{22}")
        private val tokenPattern = Regex("[A-Za-z0-9_-]{43,128}")
        fun parts(id: String, token: String): Invitation {
            if (!idPattern.matches(id) || !tokenPattern.matches(token)) throw ShareFailure("invalid_invitation", Step.PREVIEW)
            return Invitation(id, token)
        }
        fun parse(text: String): Invitation {
            try {
                if (text.length > 1024) throw IllegalArgumentException()
                val uri = URI(text.trim())
                if (uri.scheme != "https" || uri.host != "pgallardob.github.io" || uri.port !in listOf(-1, 443) ||
                    uri.userInfo != null || uri.rawQuery != null || uri.rawPath != "/gps/share.html") throw IllegalArgumentException()
                val match = Regex("invite=([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{43})").matchEntire(uri.rawFragment ?: "")
                    ?: throw IllegalArgumentException()
                return parts(match.groupValues[1], match.groupValues[2])
            } catch (_: Exception) { throw ShareFailure("invalid_invitation", Step.PREVIEW) }
        }
    }
}

data class Preview(val remainingSeconds: Int)
data class Acceptance(val token: String, val remainingSeconds: Int) {
    override fun toString() = "Acceptance([redacted])"
}
data class Fix(val latitude: Double, val longitude: Double, val accuracy: Double, val elapsedMillis: Long) {
    override fun toString() = "Fix([redacted])"
    fun coordinatesValid() = latitude.isFinite() && longitude.isFinite() && accuracy.isFinite() &&
        latitude in -90.0..90.0 && longitude in -180.0..180.0 && accuracy in 0.0..20000000.0
    fun validate(now: Long) {
        if (!coordinatesValid() || now - elapsedMillis !in 0L..20000L) throw ShareFailure("gps_unavailable", Step.LOCATION)
    }
}

class SafetyGate(private val now: () -> Long) {
    @Volatile var stopped = false
        private set
    @Volatile var acceptanceAttempted = false
    @Volatile private var deadline = Long.MAX_VALUE
    fun limitTo(seconds: Int) { deadline = minOf(deadline, now() + seconds * 1000L) }
    fun check() {
        if (stopped) throw ShareFailure("stopped", Step.STOP)
        if (now() >= deadline) throw ShareFailure("expired", Step.STOP)
    }
    fun stop() { stopped = true }
    fun remainingMillis() = (deadline - now()).coerceAtLeast(0)
}

class RelayApi(
    private val base: String = BuildConfig.RELAY_BASE_URL,
    private val simulation: Boolean = BuildConfig.SIMULATION,
    private val timeoutMillis: Int = 15000
) {
    private val canceled = AtomicBoolean(false)
    private val inFlight = AtomicReference<HttpURLConnection?>()
    companion object {
        const val ORIGIN = "https://pgallardob.github.io"
        private val errors = setOf("unauthorized", "not_found", "closed", "expired", "disconnected", "invitation_used", "viewer_offline", "rate_limit", "consent_required", "invalid_position")
    }
    init {
        val uri = URI(base)
        val liveTarget = base == "https://gps-lj9l.onrender.com"
        val local = simulation && uri.scheme == "http" && uri.host in listOf("127.0.0.1", "10.0.2.2") &&
            uri.port > 0 && uri.path == "/relay" && uri.userInfo == null && uri.query == null && uri.fragment == null
        require(liveTarget || local) { "Invalid relay configuration" }
    }
    private fun seconds(data: JSONObject): Int {
        val value = data.get("remainingSeconds")
        if (value !is Int || value !in 1..3600) throw IllegalArgumentException()
        return value
    }
    private fun request(path: String, token: String, method: String, step: Step, body: JSONObject? = null, timeout: Int = timeoutMillis): JSONObject {
        if (!Regex("v1/(invitations|sessions)/[A-Za-z0-9_-]{22}(/accept|/position)?").matches(path)) throw ShareFailure("invalid_invitation", step)
        if (!Regex("[A-Za-z0-9_-]{43,128}").matches(token)) throw ShareFailure("unauthorized", step)
        if (canceled.get() && step != Step.STOP) throw ShareFailure("stopped", step)
        val connection = URI("$base/$path").toURL().openConnection() as HttpURLConnection
        inFlight.set(connection)
        try {
            if (canceled.get() && step != Step.STOP) throw ShareFailure("stopped", step)
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = timeout
            connection.readTimeout = timeout
            connection.requestMethod = method
            connection.setRequestProperty("Origin", ORIGIN)
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "PuntoAndroid/0.2")
            connection.setRequestProperty("Accept-Encoding", "identity")
            connection.setRequestProperty("Cache-Control", "no-store")
            if (body != null) {
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val code = connection.responseCode
            if (code in 300..399) throw ShareFailure("request_failed", step)
            if (!connection.contentType.orEmpty().substringBefore(';').trim().equals("application/json", true)) throw ShareFailure("invalid_response", step)
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use {
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(1024)
                while (true) {
                    val count = it.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 16384) throw ShareFailure("invalid_response", step)
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: throw ShareFailure("invalid_response", step)
            val data = JSONObject(bytes.toString(Charsets.UTF_8))
            if (code !in 200..299) {
                val error = data.optString("error")
                throw ShareFailure(if (error in errors) error else "request_failed", step)
            }
            return data
        } catch (failure: ShareFailure) { throw failure }
        catch (_: SocketTimeoutException) { throw ShareFailure("network_timeout", step) }
        catch (_: java.io.IOException) { throw ShareFailure("network_error", step) }
        catch (_: Exception) { throw ShareFailure("invalid_response", step) }
        finally { inFlight.compareAndSet(connection, null); runCatching { connection.disconnect() } }
    }
    fun cancelInFlight() { canceled.set(true); runCatching { inFlight.get()?.disconnect() } }
    fun preview(invitation: Invitation): Preview {
        try {
            val data = request("v1/invitations/${invitation.id}", invitation.token, "GET", Step.PREVIEW, timeout = maxOf(timeoutMillis, 90000))
            if (data.get("id") != invitation.id || data.get("state") != "pending") throw IllegalArgumentException()
            Instant.parse(data.getString("expiresAt"))
            return Preview(seconds(data))
        } catch (failure: ShareFailure) { throw failure }
        catch (_: Exception) { throw ShareFailure("invalid_response", Step.PREVIEW) }
    }
    fun accept(invitation: Invitation): Acceptance {
        try {
            val data = request("v1/invitations/${invitation.id}/accept", invitation.token, "POST", Step.ACCEPT, JSONObject().put("consent", true))
            val token = data.get("publisherToken") as? String ?: throw IllegalArgumentException()
            if (!Regex("[A-Za-z0-9_-]{43,128}").matches(token)) throw IllegalArgumentException()
            return Acceptance(token, seconds(data))
        } catch (failure: ShareFailure) { throw failure }
        catch (_: Exception) { throw ShareFailure("invalid_response", Step.ACCEPT) }
    }
    fun publish(invitation: Invitation, token: String, fix: Fix) {
        if (!fix.coordinatesValid()) throw ShareFailure("invalid_position", Step.PUBLISH)
        val body = JSONObject().put("latitude", fix.latitude).put("longitude", fix.longitude).put("accuracy", fix.accuracy)
        if (request("v1/sessions/${invitation.id}/position", token, "PUT", Step.PUBLISH, body).opt("accepted") != true) {
            throw ShareFailure("invalid_response", Step.PUBLISH)
        }
    }
    fun revoke(invitation: Invitation, token: String) {
        if (request("v1/sessions/${invitation.id}", token, "DELETE", Step.STOP).opt("stopped") != true) {
            throw ShareFailure("invalid_response", Step.STOP)
        }
    }
}
