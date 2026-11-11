package io.github.pgallardob.punto

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class RoutePoint(val fix: Fix, val timestampMillis: Long) {
    override fun toString() = "RoutePoint([redacted])"
}
data class RouteSnapshot(val segments: List<List<RoutePoint>>, val distanceMeters: Double, val count: Int, val recording: Boolean) {
    override fun toString() = "RouteSnapshot([redacted])"
}

/** A bounded, RAM-only personal route. It has no relay client or invitation. */
class PersonalRoute(private val limit: Int = 10000) {
    private val segments = mutableListOf<MutableList<RoutePoint>>()
    private var segment: MutableList<RoutePoint>? = null
    private var distance = 0.0
    private var count = 0
    private var recording = false
    private var lastElapsed: Long? = null

    @Synchronized fun begin(): Boolean {
        if (count >= limit) return false
        recording = true
        segment = null
        return true
    }
    @Synchronized fun stop() { recording = false; segment = null }
    @Synchronized fun gap() { segment = null }
    @Synchronized fun clear() {
        check(!recording) { "Stop the route before clearing it" }
        segments.clear(); segment = null; distance = 0.0; count = 0; lastElapsed = null
    }
    @Synchronized fun add(fix: Fix, timestampMillis: Long): Boolean {
        if (!recording || count >= limit || !fix.coordinatesValid() || fix.accuracy > 100 || timestampMillis <= 0) return false
        val previousElapsed = lastElapsed
        if (previousElapsed != null && fix.elapsedMillis <= previousElapsed) return false
        if (previousElapsed != null && fix.elapsedMillis - previousElapsed > 30000) segment = null
        lastElapsed = fix.elapsedMillis
        val last = segment?.lastOrNull()?.fix
        val movement = last?.let { meters(it, fix) } ?: 0.0
        if (last != null && movement < 5.0) return false
        if (segment == null) { segment = mutableListOf(); segments.add(requireNotNull(segment)) }
        requireNotNull(segment).add(RoutePoint(fix, timestampMillis))
        distance += movement
        count++
        return true
    }
    @Synchronized fun snapshot() = RouteSnapshot(segments.map { it.toList() }, distance, count, recording)

    @Synchronized fun geoJson(simulated: Boolean = false): String {
        val features = JSONArray()
        for (points in segments) {
            val coordinates = points.map { JSONArray().put(it.fix.longitude).put(it.fix.latitude) }
            val geometry = if (points.size == 1) JSONObject().put("type", "Point").put("coordinates", coordinates.single())
                else JSONObject().put("type", "LineString").put("coordinates", JSONArray(coordinates))
            val properties = JSONObject().put("kind", "route").put("source", if (simulated) "demo" else "gps")
                .put("timestamps", JSONArray(points.map { Instant.ofEpochMilli(it.timestampMillis).toString() }))
                .put("accuracyMeters", JSONArray(points.map { it.fix.accuracy }))
            features.put(JSONObject().put("type", "Feature").put("geometry", geometry).put("properties", properties))
        }
        val metadata = JSONObject().put("pointCount", count).put("distanceMeters", distance).put("simulated", simulated)
        return JSONObject().put("type", "FeatureCollection").put("metadata", metadata).put("features", features).toString()
    }

    companion object {
        fun meters(a: Fix, b: Fix): Double {
            val lat = Math.toRadians(b.latitude - a.latitude)
            val lng = Math.toRadians(b.longitude - a.longitude)
            val value = sin(lat / 2) * sin(lat / 2) + cos(Math.toRadians(a.latitude)) * cos(Math.toRadians(b.latitude)) * sin(lng / 2) * sin(lng / 2)
            return 6371000.0 * 2 * asin(sqrt(value.coerceIn(0.0, 1.0)))
        }
    }
}
